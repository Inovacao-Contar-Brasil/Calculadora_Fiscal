import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, sql } from "drizzle-orm";
import { RULE_VERSION_STATUSES, RULE_WORKFLOW_ACTIONS } from "@calculadora-fiscal/domain";
import type { Database } from "./client.ts";
import * as schema from "./schema.ts";
import {
  companies,
  companyFiscalProfiles,
  legalProvisions,
  legalSources,
  legalSourceSnapshots,
  organizations,
  ruleVersionStatusEnum,
  ruleWorkflowActionEnum,
  taxRuleApprovals,
  taxRules,
  taxRuleVersionProvisions,
  taxRuleVersions,
  users,
} from "./schema.ts";
import { createHarness, type Harness } from "../test/harness.ts";
import { createTestDatabase } from "../test/pg-test-database.ts";
import { syntheticCnpj } from "../test/fixtures.ts";

/**
 * Persistência do catálogo legal (2A.1): instalação do zero, upgrade a partir
 * do banco da Sprint 1 preservando dados, reexecução idempotente, restrições,
 * integridade entre organizações e imutabilidade garantida pelo banco.
 * Roda em PGlite e, com TEST_DATABASE_URL, em PostgreSQL real.
 */

const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle");
const CATALOG_TABLES = [
  "legal_sources",
  "legal_source_snapshots",
  "legal_provisions",
  "tax_rules",
  "tax_rule_versions",
  "tax_rule_version_provisions",
  "tax_rule_approvals",
];
const SHA = "a".repeat(64);

/** Junta as mensagens da cadeia de erros (Drizzle embrulha o erro do driver em `cause`). */
async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const parts: string[] = [];
    let current: unknown = error;
    while (current instanceof Error) {
      parts.push(current.message);
      current = (current as { cause?: unknown }).cause;
    }
    return parts.join(" | ");
  }
  throw new Error("era esperado que a operação falhasse");
}

/** Pasta de migrações contendo apenas as N primeiras entradas do journal. */
function partialMigrations(count: number): string {
  const dir = mkdtempSync(path.join(tmpdir(), "cf-migr-"));
  cpSync(MIGRATIONS, dir, { recursive: true });
  const journalPath = path.join(dir, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: unknown[] };
  journal.entries = journal.entries.slice(0, count);
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

async function tableNames(db: Database): Promise<string[]> {
  const result = (await db.execute(sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`)) as unknown as { rows: { table_name: string }[] };
  return result.rows.map((r) => r.table_name);
}

type Opened = { db: Database; migrate(folder: string): Promise<void>; close(): Promise<void> };

/** Abre um banco descartável PERSISTENTE (PGlite em disco ou PostgreSQL exclusivo). */
async function openDisposable(): Promise<{ open(): Promise<Opened>; dispose(): Promise<void> }> {
  const adminUrl = process.env.TEST_DATABASE_URL;
  if (adminUrl) {
    const testDb = await createTestDatabase(adminUrl);
    return {
      async open() {
        const { Pool } = await import("pg");
        const { drizzle } = await import("drizzle-orm/node-postgres");
        const { migrate } = await import("drizzle-orm/node-postgres/migrator");
        const pool = new Pool({ connectionString: testDb.url, max: 2 });
        const db = drizzle(pool, { schema }) as unknown as Database;
        return { db, migrate: (folder) => migrate(db as never, { migrationsFolder: folder }), close: () => pool.end() };
      },
      dispose: () => testDb.drop(),
    };
  }
  const dataDir = mkdtempSync(path.join(tmpdir(), "cf-pglite-upgrade-"));
  return {
    async open() {
      const { PGlite } = await import("@electric-sql/pglite");
      const { drizzle } = await import("drizzle-orm/pglite");
      const { migrate } = await import("drizzle-orm/pglite/migrator");
      const client = await PGlite.create(dataDir);
      const db = drizzle(client, { schema }) as unknown as Database;
      return { db, migrate: (folder) => migrate(db as never, { migrationsFolder: folder }), close: () => client.close() };
    },
    dispose: async () => rmSync(dataDir, { recursive: true, force: true }),
  };
}

describe("migrações do catálogo legal", () => {
  it("enums do banco são idênticos aos do domínio (workflow único)", () => {
    expect([...ruleVersionStatusEnum.enumValues]).toEqual([...RULE_VERSION_STATUSES]);
    expect([...ruleWorkflowActionEnum.enumValues]).toEqual([...RULE_WORKFLOW_ACTIONS]);
  });

  it("upgrade de um banco persistente da Sprint 1 preserva os dados e é idempotente", async () => {
    const disposable = await openDisposable();
    const onlyFoundation = partialMigrations(1);
    try {
      // 1) Banco no estado da fundação (só 0000), com dados sintéticos.
      let conn = await disposable.open();
      await conn.migrate(onlyFoundation);
      expect(await tableNames(conn.db)).not.toContain("tax_rules");
      const [org] = await conn.db.insert(organizations).values({ name: "Org Upgrade", slug: "org-upgrade" }).returning();
      const [user] = await conn.db.insert(users).values({ email: "u@upgrade.local", name: "U", passwordHash: "x" }).returning();
      const [company] = await conn.db.insert(companies).values({ organizationId: org!.id, cnpj: syntheticCnpj("880000000001"), legalName: "Upgrade Sintética", uf: "MG" }).returning();
      await conn.db.insert(companyFiscalProfiles).values({ companyId: company!.id, version: 1, regime: "LUCRO_REAL", cnaes: ["4530703"], contribuinteIcms: true, source: "teste", validFrom: "2099-01-01", createdBy: user!.id });
      await conn.close();

      // 2) Reabre o MESMO banco e aplica as migrações completas.
      conn = await disposable.open();
      await conn.migrate(MIGRATIONS);
      const tables = await tableNames(conn.db);
      for (const table of CATALOG_TABLES) expect(tables).toContain(table);
      expect((await conn.db.select().from(companies)).map((c) => c.legalName)).toEqual(["Upgrade Sintética"]);
      expect(await conn.db.select().from(companyFiscalProfiles)).toHaveLength(1);

      // 3) Reexecução: no-op, sem duplicar nem falhar.
      await conn.migrate(MIGRATIONS);
      await conn.migrate(MIGRATIONS);
      const applied = (await conn.db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`)) as unknown as { rows: { n: number }[] };
      // Histórico canônico integrado: 0000 fundação, 0001/0002 temporais, 0003/0004 catálogo.
      const journalEntries = (JSON.parse(readFileSync(path.join(MIGRATIONS, "meta", "_journal.json"), "utf8")) as { entries: unknown[] }).entries.length;
      expect(journalEntries).toBe(5);
      expect(applied.rows[0]!.n).toBe(journalEntries);
      expect(await conn.db.select().from(organizations)).toHaveLength(1);
      await conn.close();
    } finally {
      rmSync(onlyFoundation, { recursive: true, force: true });
      await disposable.dispose();
    }
  });
});

describe("restrições e imutabilidade do catálogo (banco)", () => {
  let h: Harness;
  let orgA: string;
  let orgB: string;
  let author: string;
  let reviewer: string;
  let sourceA: string;
  let snapshotA: string;
  let provisionA: string;
  let sourceB: string;
  let snapshotB: string;
  let provisionB: string;

  const conditions = { schemaVersion: 1, layer: "CLASSIFICACAO", ncm: { include: ["87083090"] }, cest: { include: ["0100100"] }, segment: "SEGMENTO_TESTE_AUTOPECAS" };

  const newSource = (organizationId: string, number: string) =>
    h.db
      .insert(legalSources)
      .values({ organizationId, kind: "DECRETO", jurisdiction: "UF", uf: "MG", issuer: "Assembleia Sintética", number, title: "Norma Sintética nº " + number + "/2099", publishedAt: "2099-01-02", officialUrl: "https://normas.example.invalid/" + number, normative: true, licenseStatus: "OFICIAL_PUBLICO", createdBy: author })
      .returning()
      .then((r) => r[0]!.id);
  const newSnapshot = (organizationId: string, sourceId: string, hash = SHA) =>
    h.db.insert(legalSourceSnapshots).values({ organizationId, sourceId, retrievedAt: new Date(), retrievedBy: author, method: "MANUAL", contentSha256: hash }).returning().then((r) => r[0]!.id);
  const newProvision = (organizationId: string, sourceId: string, snapshotId: string, reference = "art. 1º") =>
    h.db.insert(legalProvisions).values({ organizationId, sourceId, snapshotId, reference, publishedAt: "2099-01-02", effectsFrom: "2099-02-01", createdBy: author }).returning().then((r) => r[0]!.id);

  /** Cria regra + versão + vínculo numa transação (como a API faz). */
  const newVersion = async (organizationId: string, code: string, provisionId: string) =>
    h.db.transaction(async (tx) => {
      const [rule] = await tx.insert(taxRules).values({ organizationId, layer: "CLASSIFICACAO", kind: "SEGMENTO_ST", code, title: "Regra sintética", createdBy: author }).returning();
      const [version] = await tx
        .insert(taxRuleVersions)
        .values({ organizationId, ruleId: rule!.id, version: 1, conditionsSchemaVersion: 1, conditions, contentSha256: SHA, effectsFrom: "2099-02-01", changeReason: "Versão inicial sintética", authorId: author })
        .returning();
      await tx.insert(taxRuleVersionProvisions).values({ organizationId, ruleVersionId: version!.id, provisionId, role: "FUNDAMENTO" });
      return version!;
    });

  /** Transição feita corretamente: trilha + status na mesma transação. */
  const transition = (version: { id: string; organizationId: string; authorId: string }, action: (typeof RULE_WORKFLOW_ACTIONS)[number], from: (typeof RULE_VERSION_STATUSES)[number], to: (typeof RULE_VERSION_STATUSES)[number], decidedBy: string) =>
    h.db.transaction(async (tx) => {
      await tx.insert(taxRuleApprovals).values({ organizationId: version.organizationId, ruleVersionId: version.id, versionAuthorId: version.authorId, action, fromStatus: from, toStatus: to, decidedBy, justification: "Justificativa sintética", authorizationReference: action === "ATIVA" || action === "REATIVA" ? "Ata sintética nº 1" : null });
      await tx.update(taxRuleVersions).set({ status: to, statusChangedAt: new Date() }).where(eq(taxRuleVersions.id, version.id));
    });

  beforeAll(async () => {
    h = await createHarness();
    orgA = (await h.createOrg("Org Catálogo A")).id;
    orgB = (await h.createOrg("Org Catálogo B")).id;
    author = (await h.createUser({ email: "autor@cat.local", orgId: orgA, role: "fiscal" })).id;
    reviewer = (await h.createUser({ email: "revisor@cat.local", orgId: orgA, role: "fiscal" })).id;
    sourceA = await newSource(orgA, "1");
    snapshotA = await newSnapshot(orgA, sourceA);
    provisionA = await newProvision(orgA, sourceA, snapshotA);
    sourceB = await newSource(orgB, "1");
    snapshotB = await newSnapshot(orgB, sourceB);
    provisionB = await newProvision(orgB, sourceB, snapshotB);
  });
  afterAll(() => h?.close());

  it("instalação do zero cria tabelas e triggers do catálogo", async () => {
    const tables = await tableNames(h.db);
    for (const table of CATALOG_TABLES) expect(tables).toContain(table);
    const triggers = (await h.db.execute(sql`select tgname from pg_trigger where not tgisinternal order by tgname`)) as unknown as { rows: { tgname: string }[] };
    expect(triggers.rows.map((r) => r.tgname)).toEqual(expect.arrayContaining(["tax_rule_versions_update", "tax_rule_approvals_no_update", "legal_sources_no_delete"]));
  });

  it("fonte: espécie × normatividade, licença e jurisdição são coerentes", async () => {
    const base = { organizationId: orgA, jurisdiction: "FEDERAL" as const, issuer: "Órgão Sintético", title: "Fonte sintética", publishedAt: "2099-01-01", createdBy: author };
    expect(await failure(h.db.insert(legalSources).values({ ...base, kind: "FERRAMENTA_CONFRONTO", normative: true, licenseStatus: "OFICIAL_PUBLICO", officialUrl: "https://x.example.invalid" }))).toMatch(/legal_sources_normative_ck/);
    expect(await failure(h.db.insert(legalSources).values({ ...base, kind: "BASE_LICENCIADA", normative: false, licenseStatus: "LICENCIADO_CONFIRMADO" }))).toMatch(/legal_sources_license_ref_ck/);
    expect(await failure(h.db.insert(legalSources).values({ ...base, kind: "BASE_LICENCIADA", normative: false, licenseStatus: "OFICIAL_PUBLICO" }))).toMatch(/legal_sources_licenciada_ck/);
    expect(await failure(h.db.insert(legalSources).values({ ...base, kind: "INTERPRETACAO_ESCRITORIO", normative: false, licenseStatus: "OFICIAL_PUBLICO" }))).toMatch(/legal_sources_interno_ck/);
    expect(await failure(h.db.insert(legalSources).values({ ...base, kind: "LEI", normative: true, licenseStatus: "OFICIAL_PUBLICO" }))).toMatch(/legal_sources_url_ck/);
    expect(await failure(h.db.insert(legalSources).values({ ...base, kind: "LEI", normative: true, licenseStatus: "OFICIAL_PUBLICO", officialUrl: "https://x.example.invalid", jurisdiction: "UF" }))).toMatch(/legal_sources_uf_ck/);
  });

  it("referências entre organizações são impossíveis (FKs compostas)", async () => {
    // Snapshot que se diz da organização B apontando para fonte da A.
    expect(await failure(newSnapshot(orgB, sourceA, "b".repeat(64)))).toMatch(/legal_source_snapshots_source_fk/);
    // Dispositivo citando snapshot de outra fonte.
    expect(await failure(newProvision(orgA, sourceA, snapshotB, "art. 99"))).toMatch(/legal_provisions_snapshot_fk/);
    // Versão da organização A citando dispositivo da organização B.
    expect(await failure(newVersion(orgA, "CROSS-ORG", provisionB))).toMatch(/tax_rule_version_provisions_provision_fk/);
    expect(await h.db.select().from(taxRules).where(eq(taxRules.code, "CROSS-ORG"))).toHaveLength(0);
  });

  it("unicidade: código da regra por organização; snapshot por hash; dispositivo por referência e início", async () => {
    await newVersion(orgA, "UNICO-1", provisionA);
    expect(await failure(newVersion(orgA, "UNICO-1", provisionA))).toMatch(/tax_rules_org_code_idx/);
    await newVersion(orgB, "UNICO-1", provisionB); // outra organização pode usar o mesmo código
    expect(await failure(newSnapshot(orgA, sourceA))).toMatch(/legal_source_snapshots_hash_idx/);
    expect(await failure(newProvision(orgA, sourceA, snapshotA))).toMatch(/legal_provisions_identity_idx/);
    expect(await failure(h.db.insert(taxRules).values({ organizationId: orgA, layer: "CLASSIFICACAO", kind: "INCIDENCIA_ST", code: "CAMADA-ERRADA", title: "x", createdBy: author }))).toMatch(/tax_rules_layer_kind_ck/);
    expect(await failure(h.db.insert(taxRules).values({ organizationId: orgA, layer: "INCIDENCIA", kind: "OUTRO", code: "minusculo", title: "x", createdBy: author }))).toMatch(/tax_rules_code_ck/);
  });

  it("conteúdo de versão é imutável e nada é apagado, nem com SQL direto", async () => {
    const version = await newVersion(orgA, "IMUTAVEL-1", provisionA);
    expect(await failure(h.db.update(taxRuleVersions).set({ conditions: { ...conditions, segment: "OUTRO_SEGMENTO" } }).where(eq(taxRuleVersions.id, version.id)))).toMatch(/catalogo: conteúdo de versão/);
    expect(await failure(h.db.update(taxRuleVersions).set({ effectsFrom: "2099-03-01" }).where(eq(taxRuleVersions.id, version.id)))).toMatch(/catalogo: conteúdo de versão/);
    expect(await failure(h.db.delete(taxRuleVersions).where(eq(taxRuleVersions.id, version.id)))).toMatch(/catalogo: exclusão proibida/);
    expect(await failure(h.db.delete(legalSources).where(eq(legalSources.id, sourceA)))).toMatch(/catalogo: exclusão proibida/);
    expect(await failure(h.db.update(legalSources).set({ title: "Outro título" }).where(eq(legalSources.id, sourceA)))).toMatch(/situação de licença/);
    expect(await failure(h.db.update(legalSourceSnapshots).set({ notes: "x" }).where(eq(legalSourceSnapshots.id, snapshotA)))).toMatch(/alteração proibida/);
    expect(await failure(h.db.update(legalProvisions).set({ reference: "art. 2º" }).where(eq(legalProvisions.id, provisionA)))).toMatch(/dispositivo legal é imutável/);
    // Vínculo de dispositivo depois da transação de criação.
    expect(await failure(h.db.insert(taxRuleVersionProvisions).values({ organizationId: orgA, ruleVersionId: version.id, provisionId: provisionA, role: "EXCECAO" }))).toMatch(/criação da versão|duplicate key/);
    const [other] = await h.db.insert(legalProvisions).values({ organizationId: orgA, sourceId: sourceA, snapshotId: snapshotA, reference: "art. 7º", publishedAt: "2099-01-02", effectsFrom: "2099-02-01", createdBy: author }).returning();
    expect(await failure(h.db.insert(taxRuleVersionProvisions).values({ organizationId: orgA, ruleVersionId: version.id, provisionId: other!.id, role: "EXCECAO" }))).toMatch(/criação da versão/);
  });

  it("status só muda com registro na trilha na mesma transação; versão nasce RASCUNHO", async () => {
    const version = await newVersion(orgA, "TRILHA-1", provisionA);
    expect(await failure(h.db.update(taxRuleVersions).set({ status: "APROVADA" }).where(eq(taxRuleVersions.id, version.id)))).toMatch(/sem registro na trilha/);
    // Trilha inconsistente com o status atual.
    expect(await failure(h.db.insert(taxRuleApprovals).values({ organizationId: orgA, ruleVersionId: version.id, versionAuthorId: author, action: "APROVA", fromStatus: "EM_REVISAO_TECNICA", toStatus: "APROVADA", decidedBy: reviewer, justification: "ok sintético" }))).toMatch(/trilha parte de/);
    // Transição fora da tabela.
    expect(await failure(h.db.insert(taxRuleApprovals).values({ organizationId: orgA, ruleVersionId: version.id, versionAuthorId: author, action: "ATIVA", fromStatus: "RASCUNHO", toStatus: "ATIVA", decidedBy: reviewer, justification: "x sintético", authorizationReference: "Ata 1" }))).toMatch(/tax_rule_approvals_transition_ck/);
    const [rule] = await h.db.insert(taxRules).values({ organizationId: orgA, layer: "CLASSIFICACAO", kind: "SEGMENTO_ST", code: "NASCE-ATIVA", title: "x", createdBy: author }).returning();
    expect(await failure(h.db.insert(taxRuleVersions).values({ organizationId: orgA, ruleId: rule!.id, version: 1, status: "ATIVA", conditionsSchemaVersion: 1, conditions, contentSha256: SHA, effectsFrom: "2099-02-01", changeReason: "burlar", authorId: author }))).toMatch(/nasce como RASCUNHO/);
  });

  it("quatro olhos no banco: autor não aprova; autor declarado na trilha precisa ser o real", async () => {
    const version = await newVersion(orgA, "QUATRO-OLHOS", provisionA);
    await transition(version, "SUBMETE", "RASCUNHO", "EM_REVISAO_TECNICA", author);
    expect(await failure(transition(version, "APROVA", "EM_REVISAO_TECNICA", "APROVADA", author))).toMatch(/tax_rule_approvals_four_eyes_ck/);
    // Forjar o autor na trilha (para escapar do CHECK) viola a FK composta.
    expect(await failure(h.db.insert(taxRuleApprovals).values({ organizationId: orgA, ruleVersionId: version.id, versionAuthorId: reviewer, action: "APROVA", fromStatus: "EM_REVISAO_TECNICA", toStatus: "APROVADA", decidedBy: author, justification: "forjado" }))).toMatch(/tax_rule_approvals_version_fk/);
    await transition(version, "APROVA", "EM_REVISAO_TECNICA", "APROVADA", reviewer);
    const [row] = await h.db.select().from(taxRuleVersions).where(eq(taxRuleVersions.id, version.id));
    expect(row!.status).toBe("APROVADA");
    expect(await failure(h.db.update(taxRuleApprovals).set({ justification: "reescrita" }).where(eq(taxRuleApprovals.ruleVersionId, version.id)))).toMatch(/alteração proibida/);
    expect(await failure(h.db.delete(taxRuleApprovals).where(eq(taxRuleApprovals.ruleVersionId, version.id)))).toMatch(/exclusão proibida/);
  });

  it("uma única versão ATIVA por regra", async () => {
    const v1 = await newVersion(orgA, "UMA-ATIVA", provisionA);
    const [v2] = await h.db.transaction(async (tx) => {
      const rows = await tx.insert(taxRuleVersions).values({ organizationId: orgA, ruleId: v1.ruleId, version: 2, conditionsSchemaVersion: 1, conditions, contentSha256: SHA, effectsFrom: "2099-03-01", changeReason: "Segunda versão", authorId: author }).returning();
      await tx.insert(taxRuleVersionProvisions).values({ organizationId: orgA, ruleVersionId: rows[0]!.id, provisionId: provisionA, role: "FUNDAMENTO" });
      return rows;
    });
    for (const v of [v1, v2!]) {
      // Só uma versão por vez em revisão técnica: aprova a primeira antes de submeter a segunda.
      await transition(v, "SUBMETE", "RASCUNHO", "EM_REVISAO_TECNICA", author);
      await transition(v, "APROVA", "EM_REVISAO_TECNICA", "APROVADA", reviewer);
    }
    await transition(v1, "ATIVA", "APROVADA", "ATIVA", reviewer);
    expect(await failure(transition(v2!, "ATIVA", "APROVADA", "ATIVA", reviewer))).toMatch(/tax_rule_versions_one_active_idx/);
    const active = await h.db.select().from(taxRuleVersions).where(and(eq(taxRuleVersions.ruleId, v1.ruleId), eq(taxRuleVersions.status, "ATIVA")));
    expect(active.map((v) => v.version)).toEqual([1]);
    // A falha não deixou trilha órfã: a transação inteira foi desfeita.
    expect(await h.db.select().from(taxRuleApprovals).where(and(eq(taxRuleApprovals.ruleVersionId, v2!.id), eq(taxRuleApprovals.action, "ATIVA")))).toHaveLength(0);
  });

  it("encerramento de efeitos de dispositivo: uma vez, sem ampliar vigência", async () => {
    const id = await newProvision(orgA, sourceA, snapshotA, "art. 50");
    expect(await failure(h.db.update(legalProvisions).set({ effectsTo: "2099-12-31" }).where(eq(legalProvisions.id, id)))).toMatch(/encerramento de efeitos/);
    await h.db.update(legalProvisions).set({ effectsTo: "2099-12-31", effectsClosedAt: new Date(), effectsClosedBy: author, effectsClosedReason: "teste" }).where(eq(legalProvisions.id, id));
    expect(await failure(h.db.update(legalProvisions).set({ effectsTo: "2100-01-31", effectsClosedAt: new Date(), effectsClosedBy: author }).where(eq(legalProvisions.id, id)))).toMatch(/encerramento de efeitos/);
  });
});
