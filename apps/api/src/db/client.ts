import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
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
      migrate: () => migratePg(db, { migrationsFolder }),
      close: () => pool.end(),
    };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const client = await PGlite.create(options.dataDir);
  const db = drizzlePglite(client, { schema });
  return {
    db,
    kind: "pglite",
    migrate: () => migratePglite(db, { migrationsFolder }),
    close: () => client.close(),
  };
}

export function databaseOptionsFromEnv(env: { DATABASE_URL?: string; PGLITE_DIR: string }): DatabaseOptions {
  return env.DATABASE_URL ? { kind: "postgres", url: env.DATABASE_URL } : { kind: "pglite", dataDir: env.PGLITE_DIR };
}
