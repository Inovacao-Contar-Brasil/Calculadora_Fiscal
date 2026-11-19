import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import type { Database, DatabaseHandle } from "../db/client.ts";
import { assertMigrationHistory, LEGACY_PR9_CATALOG } from "../db/migration-history.ts";
import * as schema from "../db/schema.ts";
import { createTestDatabase } from "./pg-test-database.ts";

/**
 * Apoio aos testes de histórico de migrações (CF-INTEG-01). Bancos
 * descartáveis PERSISTENTES — PostgreSQL exclusivo `cf_test_*` com
 * TEST_DATABASE_URL, ou PGlite em diretório temporário — que podem ser
 * fechados e reabertos, como um banco real entre duas versões da aplicação.
 * Pastas de migração derivadas são cópias temporárias; o repositório nunca é
 * alterado. Dados sempre sintéticos.
 */

export const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle");

interface JournalFile {
  version: string;
  dialect: string;
  entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[];
}

const readJournalFile = (folder: string) => JSON.parse(readFileSync(path.join(folder, "meta", "_journal.json"), "utf8")) as JournalFile;

const tempDirs = new Set<string>();
function copyMigrations(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "cf-migr-"));
  cpSync(MIGRATIONS, dir, { recursive: true });
  tempDirs.add(dir);
  return dir;
}
function writeJournal(dir: string, journal: JournalFile): void {
  writeFileSync(path.join(dir, "meta", "_journal.json"), JSON.stringify(journal, null, 2));
}
export function cleanupMigrationFolders(): void {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs.clear();
}

/** As N primeiras entradas do journal canônico (banco parado numa versão anterior). */
export function canonicalPrefix(count: number): string {
  const dir = copyMigrations();
  const journal = readJournalFile(dir);
  journal.entries = journal.entries.slice(0, count);
  writeJournal(dir, journal);
  return dir;
}

/**
 * Pasta de migrações **exatamente como a do PR #9** (HEAD 31e272d): 0000 +
 * 0001_catalogo_legal + 0002_catalogo_legal_integridade, com os `when`
 * originais. O SQL vem dos arquivos canônicos 0003/0004, byte a byte iguais
 * aos do PR #9, então o histórico gravado (hash + created_at) é o mesmo que
 * a branch do PR #9 grava.
 */
export function legacyPr9Folder(): string {
  const dir = copyMigrations();
  const journal = readJournalFile(dir);
  const foundation = journal.entries[0]!;
  const entries = [foundation];
  LEGACY_PR9_CATALOG.forEach((legacy, i) => {
    cpSync(path.join(dir, legacy.canonicalTag + ".sql"), path.join(dir, legacy.legacyTag + ".sql"));
    entries.push({ idx: i + 1, version: foundation.version, when: legacy.legacyWhen, tag: legacy.legacyTag, breakpoints: true });
  });
  writeJournal(dir, { ...journal, entries });
  return dir;
}

/**
 * O erro que a reconciliação evita: renomear para 0003/0004 mantendo o `when`
 * original do PR #9. O journal fica fora de ordem.
 */
export function naiveRenumberFolder(): string {
  const dir = copyMigrations();
  const journal = readJournalFile(dir);
  for (const legacy of LEGACY_PR9_CATALOG) journal.entries.find((e) => e.tag === legacy.canonicalTag)!.when = legacy.legacyWhen;
  writeJournal(dir, journal);
  return dir;
}

/** Histórico canônico + uma migração 0005 que falha no meio (falha parcial). */
export function failingAfterCatalogFolder(): string {
  const dir = copyMigrations();
  const journal = readJournalFile(dir);
  const last = journal.entries.at(-1)!;
  const tag = "0005_falha_simulada";
  writeFileSync(path.join(dir, tag + ".sql"), "CREATE TABLE cf_falha_simulada (id int);\n--> statement-breakpoint\nSELECT 1 / 0;");
  journal.entries.push({ idx: last.idx + 1, version: last.version, when: last.when + 1000, tag, breakpoints: true });
  writeJournal(dir, journal);
  return dir;
}

export interface OpenedDatabase {
  handle: DatabaseHandle;
  db: Database;
  /** Migrator do Drizzle puro, sem o guarda (para demonstrar o risco). */
  migrateRaw(folder: string): Promise<void>;
  /** Guarda + Drizzle, como `migrate()` da aplicação, sobre a pasta indicada. */
  migrateGuarded(folder: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * Banco descartável persistente que pode ser fechado e reaberto.
 *
 * `dispose()` fecha antes as conexões que um teste com falha deixou abertas e
 * só então remove o banco. Erros de conexão de pool ociosa são absorvidos:
 * sem isso, o `DROP DATABASE ... WITH (FORCE)` derruba a conexão, o pool emite
 * `error` sem ouvinte, o worker morre e os bancos seguintes ficam órfãos.
 */
export async function openDisposable(): Promise<{ name: string; open(): Promise<OpenedDatabase>; dispose(): Promise<void> }> {
  const adminUrl = process.env.TEST_DATABASE_URL;
  const opened = new Set<OpenedDatabase>();
  const track = (conn: OpenedDatabase): OpenedDatabase => {
    const close = conn.close;
    let closed = false;
    const tracked: OpenedDatabase = {
      ...conn,
      close: async () => {
        if (closed) return;
        closed = true;
        opened.delete(tracked);
        await close();
      },
    };
    tracked.handle = { ...conn.handle, close: tracked.close };
    opened.add(tracked);
    return tracked;
  };
  const closeAll = async () => {
    for (const conn of [...opened]) await conn.close().catch(() => undefined);
  };
  if (adminUrl) {
    const testDb = await createTestDatabase(adminUrl);
    return {
      name: testDb.name,
      async open() {
        const { Pool } = await import("pg");
        const { drizzle } = await import("drizzle-orm/node-postgres");
        const { migrate } = await import("drizzle-orm/node-postgres/migrator");
        const pool = new Pool({ connectionString: testDb.url, max: 4 });
        pool.on("error", () => undefined);
        const db = drizzle(pool, { schema }) as unknown as Database;
        const migrateRaw = (folder: string) => migrate(db as never, { migrationsFolder: folder });
        const close = () => pool.end();
        const handle: DatabaseHandle = { db, kind: "postgres", migrate: () => Promise.reject(new Error("use migrateGuarded")), close };
        return track({ handle, db, migrateRaw, migrateGuarded: async (folder) => (await assertMigrationHistory(db, folder), migrateRaw(folder)), close });
      },
      dispose: async () => {
        await closeAll();
        await testDb.drop();
      },
    };
  }
  const dataDir = mkdtempSync(path.join(tmpdir(), "cf-pglite-migr-"));
  return {
    name: dataDir,
    async open() {
      const { PGlite } = await import("@electric-sql/pglite");
      const { drizzle } = await import("drizzle-orm/pglite");
      const { migrate } = await import("drizzle-orm/pglite/migrator");
      const client = await PGlite.create(dataDir);
      const db = drizzle(client, { schema }) as unknown as Database;
      const migrateRaw = (folder: string) => migrate(db as never, { migrationsFolder: folder });
      const close = () => client.close();
      const handle: DatabaseHandle = { db, kind: "pglite", migrate: () => Promise.reject(new Error("use migrateGuarded")), close };
      return track({ handle, db, migrateRaw, migrateGuarded: async (folder) => (await assertMigrationHistory(db, folder), migrateRaw(folder)), close });
    },
    dispose: async () => {
      await closeAll();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

const rows = async <T>(db: Database, query: ReturnType<typeof sql>) => ((await db.execute(query)) as unknown as { rows: T[] }).rows;

/**
 * Impressão digital do esquema `public`: tabelas, colunas, restrições,
 * índices, triggers, funções e enums. Dois bancos com a mesma impressão têm
 * o mesmo esquema. Usada para provar que upgrade e reconciliação chegam ao
 * mesmo resultado da instalação do zero.
 */
export async function schemaFingerprint(db: Database): Promise<string[]> {
  const result = await rows<{ entry: string }>(
    db,
    sql`
      select 'table ' || table_name as entry from information_schema.tables where table_schema = 'public'
      union all
      select 'column ' || table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '') || ' #' || ordinal_position
        from information_schema.columns where table_schema = 'public'
      union all
      select 'constraint ' || conrelid::regclass::text || '.' || conname || ' ' || pg_get_constraintdef(oid) from pg_constraint where connamespace = 'public'::regnamespace
      union all
      select 'index ' || indexname || ' ' || indexdef from pg_indexes where schemaname = 'public'
      union all
      select 'trigger ' || c.relname || '.' || t.tgname || ' ' || pg_get_triggerdef(t.oid)
        from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and c.relnamespace = 'public'::regnamespace
      union all
      select 'function ' || proname || ' ' || md5(prosrc) from pg_proc where pronamespace = 'public'::regnamespace
      union all
      select 'enum ' || t.typname || ' ' || string_agg(e.enumlabel, ',' order by e.enumsortorder)
        from pg_type t join pg_enum e on e.enumtypid = t.oid where t.typnamespace = 'public'::regnamespace group by t.typname
      order by 1`,
  );
  return result.map((r) => r.entry);
}

/** Contagem e md5 do conteúdo de cada tabela `public` (preservação de dados). */
export async function tableChecksums(db: Database): Promise<Record<string, { rows: number; md5: string }>> {
  const tables = await rows<{ table_name: string }>(db, sql`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`);
  const out: Record<string, { rows: number; md5: string }> = {};
  for (const { table_name } of tables) {
    const ident = sql.identifier(table_name);
    const [row] = await rows<{ n: number | string; h: string }>(db, sql`select count(*) as n, md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as h from ${ident} x`);
    out[table_name] = { rows: Number(row!.n), md5: row!.h };
  }
  return out;
}

export async function ledgerRows(db: Database): Promise<{ hash: string; createdAt: number }[]> {
  const [exists] = await rows<{ t: string | null }>(db, sql`select to_regclass('drizzle.__drizzle_migrations')::text as t`);
  if (!exists?.t) return [];
  return (await rows<{ hash: string; created_at: string | number }>(db, sql`select hash, created_at from drizzle.__drizzle_migrations order by created_at, id`)).map((r) => ({ hash: r.hash, createdAt: Number(r.created_at) }));
}

export async function publicTables(db: Database): Promise<string[]> {
  return (await rows<{ table_name: string }>(db, sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`)).map((r) => r.table_name);
}

/** Mensagens da cadeia de erros (o Drizzle embrulha o erro do driver em `cause`). */
export async function failureOf(promise: Promise<unknown>): Promise<string> {
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
