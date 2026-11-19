import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import type { Database } from "./client.ts";

/**
 * Guarda e reconciliação do histórico de migrações (CF-INTEG-01).
 *
 * O migrator do Drizzle (0.45) **não compara hashes nem nomes**: lê o
 * `created_at` do último registro de `drizzle.__drizzle_migrations` e aplica,
 * numa transação, todas as entradas do journal com `when` maior. Duas
 * consequências que nenhuma ferramenta do Drizzle detecta:
 *
 * 1. Journal com `when` fora de ordem faz um banco já migrado **pular em
 *    silêncio** a migração "mais antiga" que chegou depois. Era o caso do
 *    catálogo do PR #9 (`when` 1795005761201) integrado depois das migrações
 *    temporais do PR #10 (`when` até 1795094504588).
 * 2. Um banco que recebeu o histórico antigo do PR #9 (0001/0002 do catálogo)
 *    tentaria reaplicar o catálogo como 0003/0004 e falharia com "type ...
 *    already exists". A falha é segura, porque tudo é desfeito, mas o erro é
 *    críptico e não diz o que fazer.
 *
 * Por isso `migrate()` (client.ts) chama `assertMigrationHistory` antes do
 * Drizzle. O histórico gravado tem de ser um **prefixo exato** do journal
 * canônico, com os mesmos hash e `created_at`, e o journal tem de ser
 * estritamente crescente. Se não for, nada é aplicado e o erro explica o
 * procedimento. Bancos com o histórico do PR #9 são reconciliados por
 * `reconcileLegacyCatalogHistory` (CLI `npm run db:reconcile`, dry-run por
 * padrão), nunca por reescrita manual. Detalhes em docs/MIGRACOES.md.
 */

export interface JournalMigration {
  idx: number;
  tag: string;
  when: number;
  /** sha256 do arquivo SQL inteiro — o mesmo cálculo do Drizzle (`readMigrationFiles`). */
  hash: string;
  statements: string[];
}

export interface LedgerRow {
  id: number;
  hash: string;
  createdAt: number;
}

/**
 * Migrações do catálogo como o PR #9 as gravou antes da reconciliação. O SQL
 * da 0003/0004 é **byte a byte** igual ao das antigas 0001/0002 do PR #9, por
 * isso o hash é o mesmo e só muda o `created_at`. Um teste confere que os
 * arquivos canônicos continuam com estes hashes.
 */
export const LEGACY_PR9_CATALOG = [
  { legacyTag: "0001_catalogo_legal", legacyWhen: 1795005761201, canonicalTag: "0003_catalogo_legal", hash: "60727833cc23da83557dacc46d1339b36c85ff16425e9bd2e89f502f9a23351c" },
  { legacyTag: "0002_catalogo_legal_integridade", legacyWhen: 1795005766827, canonicalTag: "0004_catalogo_legal_integridade", hash: "152d8252748f828535ef8b873851339a7a35a67951e2452f0da9fb2db527dbbc" },
] as const;

/** Objetos que provam fisicamente que o catálogo (0003 + 0004) está aplicado. */
export const CATALOG_TABLES = ["legal_sources", "legal_source_snapshots", "legal_provisions", "tax_rules", "tax_rule_versions", "tax_rule_version_provisions", "tax_rule_approvals"] as const;
export const CATALOG_TRIGGERS = [
  "legal_sources_no_delete",
  "legal_sources_update",
  "legal_source_snapshots_no_delete",
  "legal_source_snapshots_no_update",
  "legal_provisions_no_delete",
  "legal_provisions_update",
  "tax_rules_no_delete",
  "tax_rules_no_update",
  "tax_rule_versions_no_delete",
  "tax_rule_versions_insert",
  "tax_rule_versions_update",
  "tax_rule_version_provisions_no_delete",
  "tax_rule_version_provisions_no_update",
  "tax_rule_version_provisions_insert",
  "tax_rule_approvals_no_delete",
  "tax_rule_approvals_no_update",
  "tax_rule_approvals_insert",
] as const;
/** Objetos físicos da 0001_temporal_pendencias. A 0002 é só de dados e idempotente. */
const TEMPORAL_0001 = { tag: "0001_temporal_pendencias", index: "nfe_items_review_item_idx", constraint: "review_items_vigencia_ordenada_chk" } as const;

/** Chave do advisory lock da reconciliação (constante arbitrária, só deste uso). */
const RECONCILE_LOCK_KEY = 734_002_104;

export type MigrationHistoryState =
  | { kind: "CANONICAL"; applied: string[]; pending: string[] }
  | { kind: "LEGACY_PR9_CATALOG"; applied: string[]; missing: string[]; legacyRows: (LedgerRow & { canonicalTag: string })[] }
  | { kind: "DIVERGENT"; reason: string };

export class MigrationHistoryError extends Error {
  constructor(
    public readonly code: "JOURNAL_FORA_DE_ORDEM" | "HISTORICO_LEGADO_PR9" | "HISTORICO_DIVERGENTE",
    message: string,
  ) {
    super(message);
    this.name = "MigrationHistoryError";
  }
}

export function readJournal(migrationsFolder: string): JournalMigration[] {
  const journal = JSON.parse(readFileSync(path.join(migrationsFolder, "meta", "_journal.json"), "utf8")) as { entries: { idx: number; tag: string; when: number }[] };
  return journal.entries.map((entry) => {
    const query = readFileSync(path.join(migrationsFolder, entry.tag + ".sql"), "utf8");
    return { idx: entry.idx, tag: entry.tag, when: entry.when, hash: createHash("sha256").update(query).digest("hex"), statements: query.split("--> statement-breakpoint") };
  });
}

/** `when` estritamente crescente: sem isso o Drizzle pula migrações em bancos já migrados. */
export function assertJournalIsMonotonic(journal: JournalMigration[]): void {
  for (let i = 1; i < journal.length; i++) {
    if (!(journal[i]!.when > journal[i - 1]!.when)) {
      throw new MigrationHistoryError(
        "JOURNAL_FORA_DE_ORDEM",
        `Journal de migrações fora de ordem: ${journal[i]!.tag} (when ${journal[i]!.when}) não é posterior a ${journal[i - 1]!.tag} (when ${journal[i - 1]!.when}). ` +
          "O migrator do Drizzle pularia essa migração em bancos já migrados. Gere a migração de novo (npm run db:generate) sobre o histórico atual.",
      );
    }
  }
}

/** Classifica o histórico gravado contra o journal canônico. Função pura. */
export function classifyHistory(ledger: LedgerRow[], journal: JournalMigration[]): MigrationHistoryState {
  const rows = [...ledger].sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);
  const canonicalTags: string[] = [];
  const legacyRows: (LedgerRow & { canonicalTag: string })[] = [];
  for (const row of rows) {
    const canonical = journal.find((j) => j.hash === row.hash && j.when === row.createdAt);
    if (canonical) {
      canonicalTags.push(canonical.tag);
      continue;
    }
    const legacy = LEGACY_PR9_CATALOG.find((l) => l.hash === row.hash && l.legacyWhen === row.createdAt);
    if (legacy && journal.some((j) => j.tag === legacy.canonicalTag && j.hash === legacy.hash)) {
      legacyRows.push({ ...row, canonicalTag: legacy.canonicalTag });
      continue;
    }
    return { kind: "DIVERGENT", reason: `registro ${row.id} (hash ${row.hash.slice(0, 12)}…, created_at ${row.createdAt}) não corresponde a nenhuma migração conhecida desta versão` };
  }
  if (new Set(canonicalTags).size !== canonicalTags.length || new Set(legacyRows.map((r) => r.canonicalTag)).size !== legacyRows.length) {
    return { kind: "DIVERGENT", reason: "migração registrada mais de uma vez" };
  }
  const journalTags = journal.map((j) => j.tag);
  if (legacyRows.length === 0) {
    const isPrefix = canonicalTags.every((tag, i) => journalTags[i] === tag);
    if (!isPrefix) return { kind: "DIVERGENT", reason: `histórico com lacuna ou fora de ordem: [${canonicalTags.join(", ")}] não é prefixo de [${journalTags.join(", ")}]` };
    return { kind: "CANONICAL", applied: canonicalTags, pending: journalTags.slice(canonicalTags.length) };
  }
  // Histórico do PR #9: as duas migrações do catálogo, com o `created_at` antigo, mais
  // um prefixo das migrações canônicas anteriores ao catálogo (0000 e, se o banco
  // também passou pela branch do PR #10, 0001/0002 temporais).
  if (legacyRows.length !== LEGACY_PR9_CATALOG.length) return { kind: "DIVERGENT", reason: "histórico do PR #9 incompleto (só uma das migrações do catálogo)" };
  const firstCatalog = journalTags.indexOf(LEGACY_PR9_CATALOG[0].canonicalTag);
  const beforeCatalog = journalTags.slice(0, firstCatalog);
  const isPrefix = canonicalTags.length >= 1 && canonicalTags.every((tag, i) => beforeCatalog[i] === tag);
  if (!isPrefix) return { kind: "DIVERGENT", reason: `histórico do PR #9 com migrações canônicas inesperadas: [${canonicalTags.join(", ")}]` };
  return { kind: "LEGACY_PR9_CATALOG", applied: canonicalTags, missing: beforeCatalog.slice(canonicalTags.length), legacyRows };
}

type Executor = Pick<Database, "execute">;

async function rowsOf<T>(db: Executor, query: ReturnType<typeof sql>): Promise<T[]> {
  return ((await db.execute(query)) as unknown as { rows: T[] }).rows;
}

/** Histórico gravado, ou vazio se a tabela do Drizzle ainda não existe. */
export async function readLedger(db: Executor, options: { forUpdate?: boolean } = {}): Promise<LedgerRow[]> {
  const [exists] = await rowsOf<{ t: string | null }>(db, sql`select to_regclass('drizzle.__drizzle_migrations')::text as t`);
  if (!exists?.t) return [];
  const rows = await rowsOf<{ id: number | string; hash: string; created_at: number | string | bigint }>(
    db,
    options.forUpdate
      ? sql`select id, hash, created_at from drizzle.__drizzle_migrations order by created_at, id for update`
      : sql`select id, hash, created_at from drizzle.__drizzle_migrations order by created_at, id`,
  );
  return rows.map((r) => ({ id: Number(r.id), hash: r.hash, createdAt: Number(r.created_at) }));
}

export async function inspectMigrationHistory(db: Executor, migrationsFolder: string): Promise<{ journal: JournalMigration[]; ledger: LedgerRow[]; state: MigrationHistoryState }> {
  const journal = readJournal(migrationsFolder);
  assertJournalIsMonotonic(journal);
  const ledger = await readLedger(db);
  return { journal, ledger, state: classifyHistory(ledger, journal) };
}

/**
 * Pré-condição de `migrate()`: só deixa o Drizzle rodar sobre um histórico
 * canônico. Não escreve nada no banco.
 */
export async function assertMigrationHistory(db: Executor, migrationsFolder: string): Promise<MigrationHistoryState> {
  const { state } = await inspectMigrationHistory(db, migrationsFolder);
  if (state.kind === "LEGACY_PR9_CATALOG") {
    throw new MigrationHistoryError(
      "HISTORICO_LEGADO_PR9",
      "Este banco recebeu as migrações do catálogo legal com a numeração antiga do PR #9 (0001/0002). " +
        `Nada foi aplicado. Faltam: [${state.missing.join(", ") || "nenhuma"}]. ` +
        "Faça backup e siga docs/MIGRACOES.md: `npm run db:reconcile` (dry-run) e depois `npm run db:reconcile -- --apply --confirm-database=<nome>`.",
    );
  }
  if (state.kind === "DIVERGENT") {
    throw new MigrationHistoryError("HISTORICO_DIVERGENTE", "Histórico de migrações do banco não confere com o desta versão: " + state.reason + ". Nada foi aplicado. Veja docs/MIGRACOES.md.");
  }
  return state;
}

export interface ReconciliationPlan {
  state: MigrationHistoryState;
  /** Migrações canônicas cujo SQL a reconciliação executa (ausentes no banco). */
  apply: string[];
  /** Registros do histórico que só trocam de `created_at` (hash idêntico). */
  retime: { id: number; canonicalTag: string; from: number; to: number }[];
}

export function planReconciliation(state: MigrationHistoryState, journal: JournalMigration[]): ReconciliationPlan {
  if (state.kind !== "LEGACY_PR9_CATALOG") return { state, apply: [], retime: [] };
  return {
    state,
    apply: state.missing,
    retime: state.legacyRows.map((r) => ({ id: r.id, canonicalTag: r.canonicalTag, from: r.createdAt, to: journal.find((j) => j.tag === r.canonicalTag)!.when })),
  };
}

async function objectExists(db: Executor, kind: "table" | "index" | "constraint" | "trigger", name: string): Promise<boolean> {
  const query =
    kind === "table" || kind === "index"
      ? sql`select to_regclass(${"public." + name})::text as found`
      : kind === "constraint"
        ? sql`select conname as found from pg_constraint where conname = ${name} and connamespace = 'public'::regnamespace`
        : sql`select t.tgname as found from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and t.tgname = ${name} and c.relnamespace = 'public'::regnamespace`;
  const [row] = await rowsOf<{ found: string | null }>(db, query);
  return !!row?.found;
}

/** O banco tem fisicamente o que o histórico diz? Recusa se não tiver (ex.: DDL manual). */
async function assertPhysicalState(db: Executor, state: Extract<MigrationHistoryState, { kind: "LEGACY_PR9_CATALOG" }>): Promise<void> {
  for (const table of CATALOG_TABLES) if (!(await objectExists(db, "table", table))) throw new MigrationHistoryError("HISTORICO_DIVERGENTE", `histórico diz que o catálogo foi aplicado, mas a tabela ${table} não existe`);
  for (const trigger of CATALOG_TRIGGERS) if (!(await objectExists(db, "trigger", trigger))) throw new MigrationHistoryError("HISTORICO_DIVERGENTE", `histórico diz que a integridade do catálogo foi aplicada, mas o trigger ${trigger} não existe`);
  const temporalRecorded = state.applied.includes(TEMPORAL_0001.tag);
  const temporalPresent = (await objectExists(db, "index", TEMPORAL_0001.index)) || (await objectExists(db, "constraint", TEMPORAL_0001.constraint));
  if (temporalRecorded !== temporalPresent) {
    throw new MigrationHistoryError("HISTORICO_DIVERGENTE", `objetos da ${TEMPORAL_0001.tag} ${temporalPresent ? "existem sem registro no histórico" : "faltam apesar do registro no histórico"} (alteração manual?)`);
  }
}

export interface ReconciliationResult {
  plan: ReconciliationPlan;
  applied: boolean;
  before: LedgerRow[];
  after: LedgerRow[];
}

/**
 * Reconcilia um banco com o histórico antigo do PR #9 para a sequência canônica.
 *
 * Sem `apply` é só diagnóstico, sem escrita. Com `apply` tudo acontece numa
 * única transação, sob advisory lock e com releitura do histórico depois do
 * lock:
 * 1. confere que o banco tem fisicamente o que o histórico diz;
 * 2. executa o SQL **sem alteração** das migrações canônicas ausentes (as
 *    temporais), na ordem do journal, e as registra com hash e `when`
 *    canônicos. São independentes do catálogo: não tocam nenhuma tabela dele;
 * 3. troca só o `created_at` dos registros do catálogo (o hash já é o canônico);
 * 4. grava `MIGRATION_HISTORY_RECONCILED` em audit_events com o histórico
 *    antes e depois.
 * Qualquer falha desfaz tudo, e o banco continua no estado legado.
 */
export async function reconcileLegacyCatalogHistory(db: Database, migrationsFolder: string, options: { apply: boolean }): Promise<ReconciliationResult> {
  const inspected = await inspectMigrationHistory(db, migrationsFolder);
  const plan = planReconciliation(inspected.state, inspected.journal);
  if (!options.apply || inspected.state.kind !== "LEGACY_PR9_CATALOG") return { plan, applied: false, before: inspected.ledger, after: inspected.ledger };

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${RECONCILE_LOCK_KEY})`);
    const before = await readLedger(tx, { forUpdate: true });
    const state = classifyHistory(before, inspected.journal);
    if (state.kind !== "LEGACY_PR9_CATALOG") throw new MigrationHistoryError("HISTORICO_DIVERGENTE", "o histórico mudou durante a reconciliação; nada foi alterado");
    const current = planReconciliation(state, inspected.journal);
    await assertPhysicalState(tx, state);
    for (const tag of current.apply) {
      const migration = inspected.journal.find((j) => j.tag === tag)!;
      for (const statement of migration.statements) await tx.execute(sql.raw(statement));
      await tx.execute(sql`insert into drizzle.__drizzle_migrations ("hash", "created_at") values (${migration.hash}, ${migration.when})`);
    }
    for (const row of current.retime) {
      await tx.execute(sql`update drizzle.__drizzle_migrations set created_at = ${row.to} where id = ${row.id} and created_at = ${row.from}`);
    }
    const after = await readLedger(tx);
    const final = classifyHistory(after, inspected.journal);
    if (final.kind !== "CANONICAL") throw new MigrationHistoryError("HISTORICO_DIVERGENTE", "reconciliação não produziu histórico canônico; nada foi alterado");
    await tx.execute(
      sql`insert into audit_events (action, entity_type, entity_id, metadata) values ('MIGRATION_HISTORY_RECONCILED', 'database', current_database(), ${JSON.stringify({
        procedure: "CF-INTEG-01 reconcileLegacyCatalogHistory",
        from: "LEGACY_PR9_CATALOG",
        appliedMigrations: current.apply,
        retimed: current.retime,
        before,
        after,
      })}::jsonb)`,
    );
    return { plan: current, applied: true, before, after };
  });
}
