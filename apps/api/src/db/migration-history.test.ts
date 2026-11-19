import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { and, eq, sql } from "drizzle-orm";
import {
  assertJournalIsMonotonic,
  CATALOG_TABLES,
  CATALOG_TRIGGERS,
  classifyHistory,
  inspectMigrationHistory,
  LEGACY_PR9_CATALOG,
  MigrationHistoryError,
  readJournal,
  reconcileLegacyCatalogHistory,
  type JournalMigration,
} from "./migration-history.ts";
import { auditEvents, legalSources, nfeDocuments, nfeItems, reviewItems, taxRuleVersions } from "./schema.ts";
import { createHarnessOnDatabase, TEST_PASSWORD, type Harness } from "../test/harness.ts";
import { syntheticCnpj, syntheticNfe, type SyntheticItem } from "../test/fixtures.ts";
import { ACTIVATE, APPROVE, createSyntheticNorm, createSyntheticRule, op } from "../test/catalog-fixtures.ts";
import {
  canonicalPrefix,
  cleanupMigrationFolders,
  failingAfterCatalogFolder,
  failureOf,
  ledgerRows,
  legacyPr9Folder,
  MIGRATIONS,
  naiveRenumberFolder,
  openDisposable,
  publicTables,
  schemaFingerprint,
  tableChecksums,
  type OpenedDatabase,
} from "../test/migration-fixtures.ts";

/**
 * CF-INTEG-01 — reconciliação do histórico de migrações da fundação (PR #7),
 * da correção temporal (PR #10) e do catálogo legal (PR #9).
 *
 * Sequência canônica: 0000 fundação · 0001 pendências temporais · 0002 rejeição
 * fora da vigência · 0003 catálogo legal · 0004 integridade do catálogo.
 * Os bancos são persistentes e descartáveis (PGlite em disco ou PostgreSQL
 * exclusivo `cf_test_*`), fechados e reabertos entre "versões", com dados
 * sintéticos inseridos pela própria API.
 */

const CANONICAL = ["0000_fundacao", "0001_temporal_pendencias", "0002_rejeicao_fora_da_vigencia", "0003_catalogo_legal", "0004_catalogo_legal_integridade"];
/** sha256 dos arquivos nas HEADs originais: 0000 em 70c5c17 (PR #7), 0001/0002 em 20d7d33 (PR #10). */
const CANONICAL_BASE_HASHES = {
  "0000_fundacao": "a92feef3fb6d80ac4da1bc5049bdf45b34af46952d8f4d079d28d442c231d763",
  "0001_temporal_pendencias": "bf33b62cbd0b8a2b7e515d908bb2cba6a6e1b3e0dbeedd157f8b902e81973bfd",
  "0002_rejeicao_fora_da_vigencia": "ae605851a3a9e183012eccfd941eb25dc4af1b0b2121799996e9e2be1e101400",
};

describe("journal canônico integrado", () => {
  const journal = readJournal(MIGRATIONS);

  it("sequência exata, when estritamente crescente e hashes iguais aos do Drizzle", () => {
    expect(journal.map((j) => j.tag)).toEqual(CANONICAL);
    expect(() => assertJournalIsMonotonic(journal)).not.toThrow();
    const drizzle = readMigrationFiles({ migrationsFolder: MIGRATIONS });
    expect(drizzle.map((m) => [m.hash, m.folderMillis])).toEqual(journal.map((j) => [j.hash, j.when]));
  });

  it("SQL das migrações já canônicas não mudou e o catálogo é byte a byte o do PR #9", () => {
    for (const [tag, hash] of Object.entries(CANONICAL_BASE_HASHES)) expect(journal.find((j) => j.tag === tag)!.hash, tag).toBe(hash);
    for (const legacy of LEGACY_PR9_CATALOG) expect(journal.find((j) => j.tag === legacy.canonicalTag)!.hash, legacy.canonicalTag).toBe(legacy.hash);
    // O catálogo vem depois de TODAS as temporais: um banco em 0002 não pode pulá-lo.
    const when = (tag: string) => journal.find((j) => j.tag === tag)!.when;
    for (const legacy of LEGACY_PR9_CATALOG) expect(when(legacy.canonicalTag)).toBeGreaterThan(when("0002_rejeicao_fora_da_vigencia"));
  });

  it("classifica históricos: prefixo canônico, legado do PR #9, misto PR #9→#10 e divergências", () => {
    const row = (tag: string, id: number) => ({ id, hash: journal.find((j) => j.tag === tag)!.hash, createdAt: journal.find((j) => j.tag === tag)!.when });
    const legacy = LEGACY_PR9_CATALOG.map((l, i) => ({ id: 10 + i, hash: l.hash, createdAt: l.legacyWhen }));
    expect(classifyHistory([], journal)).toEqual({ kind: "CANONICAL", applied: [], pending: CANONICAL });
    expect(classifyHistory([row(CANONICAL[0]!, 1), row(CANONICAL[1]!, 2), row(CANONICAL[2]!, 3)], journal)).toEqual({ kind: "CANONICAL", applied: CANONICAL.slice(0, 3), pending: CANONICAL.slice(3) });
    expect(classifyHistory([row(CANONICAL[0]!, 1), ...legacy], journal)).toMatchObject({ kind: "LEGACY_PR9_CATALOG", applied: ["0000_fundacao"], missing: ["0001_temporal_pendencias", "0002_rejeicao_fora_da_vigencia"] });
    expect(classifyHistory([row(CANONICAL[0]!, 1), ...legacy, row(CANONICAL[1]!, 4), row(CANONICAL[2]!, 5)], journal)).toMatchObject({ kind: "LEGACY_PR9_CATALOG", missing: [] });
    // Lacuna: 0002 sem 0001 — o Drizzle nunca aplicaria a 0001.
    expect(classifyHistory([row(CANONICAL[0]!, 1), row(CANONICAL[2]!, 2)], journal)).toMatchObject({ kind: "DIVERGENT" });
    expect(classifyHistory([row(CANONICAL[0]!, 1), legacy[0]!], journal)).toMatchObject({ kind: "DIVERGENT", reason: expect.stringContaining("incompleto") });
    expect(classifyHistory([row(CANONICAL[0]!, 1), { id: 2, hash: "f".repeat(64), createdAt: 1 }], journal)).toMatchObject({ kind: "DIVERGENT" });
    // Mesmo SQL com created_at errado também é divergente (não é canônico nem o legado conhecido).
    expect(classifyHistory([row(CANONICAL[0]!, 1), { ...row(CANONICAL[3]!, 2), createdAt: 123 }], journal)).toMatchObject({ kind: "DIVERGENT" });
    const unordered: JournalMigration[] = journal.map((j) => (j.tag === "0003_catalogo_legal" ? { ...j, when: LEGACY_PR9_CATALOG[0].legacyWhen } : j));
    expect(() => assertJournalIsMonotonic(unordered)).toThrow(MigrationHistoryError);
  });
});

describe("upgrade, reconciliação e falhas em banco persistente", () => {
  const disposables: Awaited<ReturnType<typeof openDisposable>>[] = [];
  let freshFingerprint: string[];
  let freshLedger: { hash: string; createdAt: number }[];

  const newDatabase = async () => {
    const d = await openDisposable();
    disposables.push(d);
    return d;
  };

  beforeAll(async () => {
    // Referência: instalação do zero 0000 → 0004 pelo caminho da aplicação (guarda + Drizzle).
    const d = await newDatabase();
    const conn = await d.open();
    try {
      await conn.migrateGuarded(MIGRATIONS);
      freshFingerprint = await schemaFingerprint(conn.db);
      freshLedger = await ledgerRows(conn.db);
    } finally {
      await conn.close();
    }
  });

  afterAll(async () => {
    const errors: unknown[] = [];
    for (const d of disposables) await d.dispose().catch((e) => errors.push(e));
    cleanupMigrationFolders();
    // Nenhum banco de teste deste arquivo sobrevive (PostgreSQL) ou diretório PGlite.
    if (process.env.TEST_DATABASE_URL) {
      const { Client } = await import("pg");
      const admin = new Client({ connectionString: process.env.TEST_DATABASE_URL });
      await admin.connect();
      try {
        const names = disposables.map((d) => d.name);
        const left = await admin.query("select datname from pg_database where datname = any($1::text[])", [names]);
        expect(left.rows).toEqual([]);
      } finally {
        await admin.end();
      }
    }
    if (errors.length) throw errors[0];
  });

  /** Popula pela API: escritório, empresas, NF-e, homologação e rejeição com vigência e uma pendência resolvida. */
  async function seedTemporalData(conn: OpenedDatabase) {
    const h = await createHarnessOnDatabase(conn.handle);
    try {
      const org = await h.createOrg("Org Upgrade Integrado");
      const company = await h.createCompany(org.id, { cnpj: syntheticCnpj("910000000001"), legalName: "Upgrade Integrado A" });
      const companyB = await h.createCompany(org.id, { cnpj: syntheticCnpj("910000000002"), legalName: "Upgrade Integrado B" });
      const cliente = await h.createUser({ email: "cliente@upgrade.local", orgId: org.id, role: "cliente" });
      await h.createUser({ email: "fiscal@upgrade.local", orgId: org.id, role: "fiscal" });
      await h.createUser({ email: "fiscal2@upgrade.local", orgId: org.id, role: "fiscal" });
      await h.createUser({ email: "admin@upgrade.local", orgId: org.id, role: "admin" });
      await h.grantAccess(company.id, cliente.id);
      await h.grantAccess(companyB.id, cliente.id);
      const clienteCookie = await h.login("cliente@upgrade.local", TEST_PASSWORD);
      const fiscal = await h.login("fiscal@upgrade.local", TEST_PASSWORD);
      const importNote = async (number: string, issuedAt: string, item: SyntheticItem, target = company) => {
        const r = await h.request({ method: "POST", url: "/api/companies/" + target.id + "/documents", cookie: clienteCookie, headers: { "content-type": "application/xml" }, payload: syntheticNfe({ number, issuedAt, recipientCnpj: target.cnpj, items: [item] }) });
        expect(r.status, r.raw).toBe(201);
        return r.body.document.id as string;
      };
      const reviewOf = async (documentId: string) => (await h.request({ method: "GET", url: "/api/documents/" + documentId, cookie: clienteCookie })).body.items[0].reviewItemId as string;
      const pneu: SyntheticItem = { code: "UP-01", description: "PNEU SINTETICO UPGRADE", ncm: "40111000", productCents: 1000 };
      const bateria: SyntheticItem = { code: "UP-02", description: "BATERIA SINTETICA UPGRADE", ncm: "85071000", productCents: 2500 };
      const octPneu = await importNote("5001", "2026-10-10T10:00:00-03:00", pneu);
      const homolog = await h.request({ method: "PATCH", url: "/api/review-items/" + (await reviewOf(octPneu)), cookie: fiscal, payload: { status: "HOMOLOGADO", justification: "Homologação sintética.", decision: { enquadramento: "Enquadramento sintético", fundamentoLegal: "Norma Sintética nº 1/2099" }, validFrom: "2026-11-01" } });
      expect(homolog.status, homolog.raw).toBe(200);
      await importNote("5002", "2026-11-05T10:00:00-03:00", pneu);
      const octBateria = await importNote("5003", "2026-10-12T10:00:00-03:00", bateria, companyB);
      const reject = await h.request({ method: "PATCH", url: "/api/review-items/" + (await reviewOf(octBateria)), cookie: fiscal, payload: { status: "REJEITADO", justification: "Rejeição sintética a partir de novembro", validFrom: "2026-11-01" } });
      expect(reject.status, reject.raw).toBe(200);
      const pendencies = await h.request({ method: "GET", url: "/api/temporal-pendencies", cookie: fiscal });
      expect(pendencies.status).toBe(200);
      expect(pendencies.body.items).toHaveLength(2);
      // Resolve a do pneu (outubro homologado como decisão do período); a da bateria fica aberta.
      const pneuPendency = pendencies.body.items.find((p: { product: { description: string } }) => p.product.description === pneu.description);
      const resolved = await h.request({ method: "POST", url: "/api/temporal-pendencies/" + pneuPendency.id + "/resolve", cookie: fiscal, payload: { status: "HOMOLOGADO", validFrom: "2026-10-01", validTo: "2026-10-31", justification: "Período anterior conferido (sintético).", decision: { enquadramento: "Enquadramento sintético anterior", fundamentoLegal: "Norma Sintética nº 0/2098" } } });
      expect(resolved.status, resolved.raw).toBe(201);
      const remaining = await h.request({ method: "GET", url: "/api/temporal-pendencies", cookie: fiscal });
      return { orgId: org.id, pendencies: remaining.body };
    } finally {
      await h.close();
    }
  }

  /** Fluxo completo do catálogo pela API, com quatro olhos, num banco já migrado. */
  async function catalogFlow(conn: OpenedDatabase, orgId: string, code: string) {
    const h = await createHarnessOnDatabase(conn.handle);
    try {
      const autor = await h.login("fiscal@upgrade.local", TEST_PASSWORD);
      const revisor = await h.login("fiscal2@upgrade.local", TEST_PASSWORD);
      const admin = await h.login("admin@upgrade.local", TEST_PASSWORD);
      const norm = await createSyntheticNorm(h, autor, orgId, { number: code.length.toString() + code.slice(-1) });
      const { versionId } = await createSyntheticRule(h, autor, orgId, code, norm.provisionId);
      expect((await op(h, autor, versionId, "submit", { expectedStatus: "RASCUNHO" })).status).toBe(200);
      const self = await op(h, autor, versionId, "approve", APPROVE);
      expect(self.status).toBe(403);
      expect(self.body.error.code).toBe("FOUR_EYES");
      expect((await op(h, revisor, versionId, "approve", APPROVE)).status).toBe(200);
      const activated = await op(h, admin, versionId, "activate", ACTIVATE);
      expect(activated.status, activated.raw).toBe(200);
      expect(activated.body.version.status).toBe("ATIVA");
      return versionId;
    } finally {
      await h.close();
    }
  }

  /** Imutabilidade do catálogo garantida pelos triggers no banco migrado. */
  async function assertCatalogTriggers(conn: OpenedDatabase, versionId: string) {
    expect(await failureOf(conn.db.update(taxRuleVersions).set({ changeReason: "reescrita direta" }).where(eq(taxRuleVersions.id, versionId)))).toMatch(/catalogo: conteúdo de versão/);
    expect(await failureOf(conn.db.delete(taxRuleVersions).where(eq(taxRuleVersions.id, versionId)))).toMatch(/catalogo: exclusão proibida/);
    expect(await failureOf(conn.db.update(taxRuleVersions).set({ status: "SUSPENSA" }).where(eq(taxRuleVersions.id, versionId)))).toMatch(/sem registro na trilha/);
    expect(await failureOf(conn.db.delete(legalSources))).toMatch(/catalogo: exclusão proibida/);
  }

  it("1. instalação do zero 0000→0004: histórico canônico, catálogo e garantias temporais presentes", async () => {
    expect(freshLedger.map((r) => r.createdAt)).toEqual(readJournal(MIGRATIONS).map((j) => j.when));
    for (const table of CATALOG_TABLES) expect(freshFingerprint).toContain("table " + table);
    for (const trigger of CATALOG_TRIGGERS) expect(freshFingerprint.some((e) => e.startsWith("trigger ") && e.includes("." + trigger + " "))).toBe(true);
    expect(freshFingerprint.some((e) => e.startsWith("index nfe_items_review_item_idx "))).toBe(true);
    expect(freshFingerprint.some((e) => e.includes("review_items_vigencia_ordenada_chk"))).toBe(true);
    expect(freshFingerprint.some((e) => e.includes("tax_rule_approvals_four_eyes_ck"))).toBe(true);
  });

  it("2–5. banco da correção temporal (0000–0002) com dados → 0004: dados preservados, garantias íntegras, reexecução idempotente", async () => {
    const d = await newDatabase();
    let conn = await d.open();
    await conn.migrateRaw(canonicalPrefix(3)); // exatamente o journal do PR #10 @ 20d7d33
    expect(await publicTables(conn.db)).not.toContain("tax_rules");
    const seeded = await seedTemporalData(conn);
    const before = await tableChecksums(conn.db);
    expect(before.nfe_documents!.rows).toBe(3);
    expect(before.review_items!.rows).toBeGreaterThanOrEqual(3);
    await conn.close();

    // Nova versão da aplicação sobre o MESMO banco.
    conn = await d.open();
    await conn.migrateGuarded(MIGRATIONS);
    const after = await tableChecksums(conn.db);
    for (const [table, checksum] of Object.entries(before)) expect(after[table], table).toEqual(checksum);
    for (const table of CATALOG_TABLES) expect(after[table], table).toEqual({ rows: 0, md5: expect.any(String) });
    expect(await schemaFingerprint(conn.db)).toEqual(freshFingerprint);
    expect(await ledgerRows(conn.db)).toEqual(freshLedger);

    // Idempotência: reaplicar não muda histórico nem dados.
    await conn.migrateGuarded(MIGRATIONS);
    await conn.migrateGuarded(MIGRATIONS);
    expect(await ledgerRows(conn.db)).toEqual(freshLedger);
    expect(await tableChecksums(conn.db)).toEqual(after);
    expect((await reconcileLegacyCatalogHistory(conn.db, MIGRATIONS, { apply: true })).applied).toBe(false);

    // A aplicação integrada funciona sobre o banco atualizado: pendência intacta e catálogo operante.
    const h = await createHarnessOnDatabase(conn.handle);
    try {
      const fiscal = await h.login("fiscal@upgrade.local", TEST_PASSWORD);
      expect((await h.request({ method: "GET", url: "/api/temporal-pendencies", cookie: fiscal })).body).toEqual(seeded.pendencies);
    } finally {
      await h.close();
    }
    const versionId = await catalogFlow(conn, seeded.orgId, "CLS-UPGRADE-TEMPORAL");
    await assertCatalogTriggers(conn, versionId);
    // Linha do tempo temporal continua protegida pelo CHECK da 0001.
    const [anyReview] = await conn.db.select().from(reviewItems).limit(1);
    expect(await failureOf(conn.db.update(reviewItems).set({ validFrom: "2030-01-02", validTo: "2030-01-01" }).where(eq(reviewItems.id, anyReview!.id)))).toMatch(/review_items_vigencia_ordenada_chk/);
    await conn.close();
  });

  it("renumerar sem refazer o journal: o Drizzle PULA o catálogo em silêncio; o guarda recusa", async () => {
    const d = await newDatabase();
    const conn = await d.open();
    try {
      await conn.migrateRaw(canonicalPrefix(3));
      const naive = naiveRenumberFolder();
      await conn.migrateRaw(naive); // "sucesso"...
      expect(await publicTables(conn.db)).not.toContain("tax_rules"); // ...sem catálogo
      expect(await ledgerRows(conn.db)).toHaveLength(3);
      const error = await failureOf(conn.migrateGuarded(naive));
      expect(error).toMatch(/fora de ordem/);
    } finally {
      await conn.close();
    }
  });

  it("6. falha parcial no upgrade normal: transação desfeita, banco intacto, recuperação reexecutando", async () => {
    const d = await newDatabase();
    const conn = await d.open();
    try {
      await conn.migrateRaw(canonicalPrefix(3));
      await seedTemporalData(conn);
      const before = await tableChecksums(conn.db);
      expect(await failureOf(conn.migrateGuarded(failingAfterCatalogFolder()))).toMatch(/division by zero/);
      // Nada de 0003, 0004 ou 0005 ficou: nem tabelas, nem triggers, nem registro no histórico.
      const tables = await publicTables(conn.db);
      expect(tables).not.toContain("tax_rules");
      expect(tables).not.toContain("cf_falha_simulada");
      expect(await ledgerRows(conn.db)).toEqual(freshLedger.slice(0, 3));
      expect(await tableChecksums(conn.db)).toEqual(before);
      // Recuperação operacional: corrigida a causa, a mesma operação conclui.
      await conn.migrateGuarded(MIGRATIONS);
      expect(await ledgerRows(conn.db)).toEqual(freshLedger);
      expect(await schemaFingerprint(conn.db)).toEqual(freshFingerprint);
    } finally {
      await conn.close();
    }
  });

  it("banco com o histórico antigo do PR #9: guarda recusa sem tocar em nada; reconciliação leva ao estado canônico", async () => {
    const d = await newDatabase();
    let conn = await d.open();
    await conn.migrateRaw(legacyPr9Folder()); // exatamente o journal do PR #9 @ 31e272d
    expect((await inspectMigrationHistory(conn.db, MIGRATIONS)).state).toMatchObject({ kind: "LEGACY_PR9_CATALOG", missing: ["0001_temporal_pendencias", "0002_rejeicao_fora_da_vigencia"] });
    const seeded = await seedLegacyData(conn);
    const before = await tableChecksums(conn.db);
    const ledgerBefore = await ledgerRows(conn.db);
    await conn.close();

    conn = await d.open();
    // Sem guarda: o Drizzle tenta reaplicar o catálogo e falha (seguro, mas críptico)...
    expect(await failureOf(conn.migrateRaw(MIGRATIONS))).toMatch(/already exists/);
    // ...com o guarda: erro explicativo antes de qualquer escrita.
    const guarded = await failureOf(conn.migrateGuarded(MIGRATIONS));
    expect(guarded).toMatch(/numeração antiga do PR #9/);
    expect(guarded).toMatch(/db:reconcile/);
    expect(await ledgerRows(conn.db)).toEqual(ledgerBefore);
    expect(await tableChecksums(conn.db)).toEqual(before);

    // Diagnóstico (padrão): plano sem escrita.
    const dry = await reconcileLegacyCatalogHistory(conn.db, MIGRATIONS, { apply: false });
    expect(dry.applied).toBe(false);
    expect(dry.plan.apply).toEqual(["0001_temporal_pendencias", "0002_rejeicao_fora_da_vigencia"]);
    expect(dry.plan.retime.map((r) => r.canonicalTag)).toEqual(["0003_catalogo_legal", "0004_catalogo_legal_integridade"]);
    expect(await ledgerRows(conn.db)).toEqual(ledgerBefore);

    const done = await reconcileLegacyCatalogHistory(conn.db, MIGRATIONS, { apply: true });
    expect(done.applied).toBe(true);
    expect(await ledgerRows(conn.db)).toEqual(freshLedger);
    expect(await schemaFingerprint(conn.db)).toEqual(freshFingerprint);

    // Dados: catálogo e cadastros intactos; só a nota rejeitada fora da vigência (regra antiga)
    // passou a PENDENTE pela 0002, com auditoria; a reconciliação também ficou auditada.
    const after = await tableChecksums(conn.db);
    for (const table of Object.keys(before).filter((t) => !["nfe_items", "audit_events"].includes(t))) expect(after[table], table).toEqual(before[table]);
    expect(after.nfe_items!.rows).toBe(before.nfe_items!.rows);
    const [reclassified] = await conn.db.select().from(nfeItems).where(eq(nfeItems.id, seeded.legacyRejectedItemId));
    expect(reclassified!.classificationStatus).toBe("PENDENTE_REVISAO");
    const events = await conn.db.select().from(auditEvents).where(sql`${auditEvents.action} in ('MIGRATION_REJECTION_OUT_OF_VALIDITY_RECLASSIFIED', 'MIGRATION_HISTORY_RECONCILED')`);
    expect(events.map((e) => e.action).sort()).toEqual(["MIGRATION_HISTORY_RECONCILED", "MIGRATION_REJECTION_OUT_OF_VALIDITY_RECLASSIFIED"]);
    expect(events.find((e) => e.action === "MIGRATION_HISTORY_RECONCILED")!.metadata).toMatchObject({ appliedMigrations: ["0001_temporal_pendencias", "0002_rejeicao_fora_da_vigencia"], from: "LEGACY_PR9_CATALOG" });

    // Depois da reconciliação: migrate() é no-op, reconciliar de novo não faz nada.
    await conn.migrateGuarded(MIGRATIONS);
    expect(await ledgerRows(conn.db)).toEqual(freshLedger);
    expect((await reconcileLegacyCatalogHistory(conn.db, MIGRATIONS, { apply: true })).applied).toBe(false);

    // Aplicação integrada: a nota antiga virou pendência temporal acionável; catálogo legado operante.
    const h = await createHarnessOnDatabase(conn.handle);
    try {
      const fiscal = await h.login("fiscal@upgrade.local", TEST_PASSWORD);
      const list = await h.request({ method: "GET", url: "/api/temporal-pendencies", cookie: fiscal });
      expect(list.body.items).toHaveLength(1);
      expect(list.body.items[0]).toMatchObject({ decision: { status: "REJEITADO", validFrom: "2026-11-01" }, origin: { items: 1, firstIssueDate: "2026-10-10" } });
      const legacyVersion = await h.request({ method: "GET", url: "/api/tax-rule-versions/" + seeded.legacyVersionId, cookie: fiscal });
      expect(legacyVersion.status).toBe(200);
      expect(legacyVersion.body.version.status).toBe("ATIVA");
    } finally {
      await h.close();
    }
    await assertCatalogTriggers(conn, seeded.legacyVersionId);
    await catalogFlow(conn, seeded.orgId, "CLS-POS-RECONCILIACAO");
    await conn.close();
  });

  it("banco que passou pelo PR #9 e depois pelo PR #10: reconciliação só re-data o catálogo", async () => {
    const d = await newDatabase();
    const conn = await d.open();
    try {
      await conn.migrateRaw(legacyPr9Folder());
      await conn.migrateRaw(canonicalPrefix(3)); // o Drizzle aplica 0001/0002 temporais por cima
      expect((await ledgerRows(conn.db)).length).toBe(5);
      expect(await failureOf(conn.migrateGuarded(MIGRATIONS))).toMatch(/numeração antiga do PR #9/);
      const done = await reconcileLegacyCatalogHistory(conn.db, MIGRATIONS, { apply: true });
      expect(done.plan.apply).toEqual([]);
      expect(done.plan.retime).toHaveLength(2);
      expect(await ledgerRows(conn.db)).toEqual(freshLedger);
      expect(await schemaFingerprint(conn.db)).toEqual(freshFingerprint);
    } finally {
      await conn.close();
    }
  });

  it("falha parcial na reconciliação (dado legado viola o CHECK da 0001): tudo desfeito; corrigido o dado, conclui", async () => {
    const d = await newDatabase();
    const conn = await d.open();
    try {
      await conn.migrateRaw(legacyPr9Folder());
      await seedLegacyData(conn);
      // Sem o CHECK da 0001, a branch do PR #9 aceitava vigência invertida.
      const [inverted] = await conn.db.select().from(reviewItems).where(eq(reviewItems.status, "REJEITADO")).limit(1);
      await conn.db.update(reviewItems).set({ validFrom: "2026-12-01", validTo: "2026-11-30" }).where(eq(reviewItems.id, inverted!.id));
      const ledgerBefore = await ledgerRows(conn.db);
      const before = await tableChecksums(conn.db);
      expect(await failureOf(reconcileLegacyCatalogHistory(conn.db, MIGRATIONS, { apply: true }))).toMatch(/review_items_vigencia_ordenada_chk/);
      expect(await ledgerRows(conn.db)).toEqual(ledgerBefore);
      expect(await tableChecksums(conn.db)).toEqual(before);
      expect(await schemaFingerprint(conn.db)).not.toContainEqual(expect.stringMatching(/^index nfe_items_review_item_idx /));
      // Recuperação: o operador corrige o dado (decisão do Fiscal, fora do escopo daqui) e repete.
      await conn.db.update(reviewItems).set({ validFrom: "2026-11-01", validTo: null }).where(eq(reviewItems.id, inverted!.id));
      expect((await reconcileLegacyCatalogHistory(conn.db, MIGRATIONS, { apply: true })).applied).toBe(true);
      expect(await ledgerRows(conn.db)).toEqual(freshLedger);
    } finally {
      await conn.close();
    }
  });

  it("histórico que não confere com o banco físico (DDL manual) não é reconciliado", async () => {
    const d = await newDatabase();
    const conn = await d.open();
    try {
      await conn.migrateRaw(legacyPr9Folder());
      await conn.db.execute(sql`create index "nfe_items_review_item_idx" on "nfe_items" ("review_item_id")`);
      const ledgerBefore = await ledgerRows(conn.db);
      expect(await failureOf(reconcileLegacyCatalogHistory(conn.db, MIGRATIONS, { apply: true }))).toMatch(/existem sem registro no histórico/);
      expect(await ledgerRows(conn.db)).toEqual(ledgerBefore);
    } finally {
      await conn.close();
    }
  });

  /**
   * Dados como a branch do PR #9 os deixaria: cadastros, NF-e, rejeição com
   * vigência e uma regra do catálogo ATIVA. A nota de outubro é gravada
   * REJEITADO fora da vigência, como fazia a regra antiga (antes da R2).
   */
  async function seedLegacyData(conn: OpenedDatabase) {
    const h = await createHarnessOnDatabase(conn.handle);
    try {
      const org = await h.createOrg("Org Legado PR9");
      const company = await h.createCompany(org.id, { cnpj: syntheticCnpj("920000000001"), legalName: "Legado PR9 Sintética" });
      const cliente = await h.createUser({ email: "cliente@upgrade.local", orgId: org.id, role: "cliente" });
      await h.createUser({ email: "fiscal@upgrade.local", orgId: org.id, role: "fiscal" });
      await h.createUser({ email: "fiscal2@upgrade.local", orgId: org.id, role: "fiscal" });
      await h.createUser({ email: "admin@upgrade.local", orgId: org.id, role: "admin" });
      await h.grantAccess(company.id, cliente.id);
      const clienteCookie = await h.login("cliente@upgrade.local", TEST_PASSWORD);
      const fiscal = await h.login("fiscal@upgrade.local", TEST_PASSWORD);
      const item: SyntheticItem = { code: "LG-01", description: "FILTRO SINTETICO LEGADO", ncm: "84212300", productCents: 1500 };
      const r = await h.request({ method: "POST", url: "/api/companies/" + company.id + "/documents", cookie: clienteCookie, headers: { "content-type": "application/xml" }, payload: syntheticNfe({ number: "7001", issuedAt: "2026-10-10T10:00:00-03:00", recipientCnpj: company.cnpj, items: [item] }) });
      expect(r.status, r.raw).toBe(201);
      const [legacyItem] = await h.db.select().from(nfeItems).where(eq(nfeItems.documentId, r.body.document.id));
      const reject = await h.request({ method: "PATCH", url: "/api/review-items/" + legacyItem!.reviewItemId, cookie: fiscal, payload: { status: "REJEITADO", justification: "Rejeição sintética a partir de novembro", validFrom: "2026-11-01" } });
      expect(reject.status, reject.raw).toBe(200);
      // Regra antiga (PR #9 = fundação antes da R2): REJEITADO valia para qualquer data.
      await h.db.update(nfeItems).set({ classificationStatus: "REJEITADO" }).where(and(eq(nfeItems.id, legacyItem!.id), eq(nfeItems.classificationStatus, "PENDENTE_REVISAO")));
      await h.db.update(nfeDocuments).set({ status: "COM_PENDENCIAS" }).where(eq(nfeDocuments.id, r.body.document.id));
      const legacyVersionId = await catalogFlowWith(h, org.id, "CLS-LEGADO-PR9");
      return { orgId: org.id, legacyRejectedItemId: legacyItem!.id, legacyVersionId };
    } finally {
      await h.close();
    }
  }

  async function catalogFlowWith(h: Harness, orgId: string, code: string) {
    const autor = await h.login("fiscal@upgrade.local", TEST_PASSWORD);
    const revisor = await h.login("fiscal2@upgrade.local", TEST_PASSWORD);
    const admin = await h.login("admin@upgrade.local", TEST_PASSWORD);
    const norm = await createSyntheticNorm(h, autor, orgId, { number: "9" });
    const { versionId } = await createSyntheticRule(h, autor, orgId, code, norm.provisionId);
    expect((await op(h, autor, versionId, "submit", { expectedStatus: "RASCUNHO" })).status).toBe(200);
    expect((await op(h, revisor, versionId, "approve", APPROVE)).status).toBe(200);
    expect((await op(h, admin, versionId, "activate", ACTIVATE)).status).toBe(200);
    return versionId;
  }
});
