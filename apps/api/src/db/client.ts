import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { assertMigrationHistory } from "./migration-history.ts";
import * as schema from "./schema.ts";

/** Tipo comum aos dois drivers (node-postgres e PGlite) e às transações. */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DatabaseHandle {
  db: Database;
  kind: "postgres" | "pglite";
  migrate(): Promise<void>;
  close(): Promise<void>;
}

export type DatabaseOptions =
  | { kind: "postgres"; url: string }
  | { kind: "pglite"; dataDir: string };

/** Pasta de migrações: `apps/api/drizzle`, alcançada a partir de src/db/ (tsx) ou de dist/ (bundle). */
function resolveMigrationsFolder(): string {
  if (process.env.MIGRATIONS_DIR) return path.resolve(process.env.MIGRATIONS_DIR);
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const candidate of ["../../drizzle", "../drizzle", "./drizzle"]) {
    const folder = path.resolve(here, candidate);
    if (existsSync(path.join(folder, "meta", "_journal.json"))) return folder;
  }
  throw new Error("Pasta de migrações não encontrada; defina MIGRATIONS_DIR.");
}
const migrationsFolder = resolveMigrationsFolder();
export { migrationsFolder };

/**
 * Cria a conexão. O mesmo esquema e as mesmas migrações SQL servem aos dois
 * motores; PGlite é PostgreSQL real compilado para WASM, usado quando não há
 * servidor disponível (desenvolvimento local e testes).
 */
export async function createDatabase(options: DatabaseOptions): Promise<DatabaseHandle> {
  if (options.kind === "postgres") {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: options.url, max: 10 });
    const db = drizzlePg(pool, { schema });
    return {
      db,
      kind: "postgres",
      // O guarda recusa histórico não canônico antes de o Drizzle tocar no banco
      // (migration-history.ts; o Drizzle decide só pelo created_at do último registro).
      migrate: async () => {
        await assertMigrationHistory(db, migrationsFolder);
        await migratePg(db, { migrationsFolder });
      },
      close: () => pool.end(),
    };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  ensurePgliteDataDir(options.dataDir);
  const client = await PGlite.create(options.dataDir);
  const db = drizzlePglite(client, { schema });
  return {
    db,
    kind: "pglite",
    migrate: async () => {
      await assertMigrationHistory(db, migrationsFolder);
      await migratePglite(db, { migrationsFolder });
    },
    close: () => client.close(),
  };
}

/**
 * O PGlite cria apenas o último nível do diretório de dados (mkdir não
 * recursivo): com o padrão `.data/pglite` e sem `.data`, o primeiro `npm run
 * db:seed`/`dev` falhava com ENOENT. Criamos a árvore antes, de forma
 * recursiva — no-op se já existe, então um banco existente nunca é tocado.
 * Destinos não-disco (`memory://`, `idb://`, `opfs-ahp://`) são ignorados.
 * Retorna o caminho absoluto criado/garantido, ou null quando não é disco.
 */
export function ensurePgliteDataDir(dataDir: string): string | null {
  let target = dataDir;
  if (target.startsWith("file://")) target = fileURLToPath(target);
  else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) return null;
  const resolved = path.resolve(target);
  mkdirSync(resolved, { recursive: true });
  return resolved;
}

export function databaseOptionsFromEnv(env: { DATABASE_URL?: string; PGLITE_DIR: string }): DatabaseOptions {
  return env.DATABASE_URL ? { kind: "postgres", url: env.DATABASE_URL } : { kind: "pglite", dataDir: env.PGLITE_DIR };
}
