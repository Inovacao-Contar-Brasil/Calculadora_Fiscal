import { describe, expect, it } from "vitest";
import { count, eq, sql } from "drizzle-orm";
import { organizations } from "../db/schema.ts";
import { createHarness } from "./harness.ts";
import { activeTestDatabases, assertTestDatabaseName, withDatabase } from "./pg-test-database.ts";

/**
 * Garante o isolamento do próprio harness — regressão do CI 43461045963, em que
 * suítes paralelas apagavam o schema umas das outras no PostgreSQL real.
 * Roda nos dois motores; as verificações de pg_database só com TEST_DATABASE_URL.
 */
const adminUrl = process.env.TEST_DATABASE_URL;

async function databaseExists(name: string): Promise<boolean> {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const result = await client.query("select 1 from pg_database where datname = $1", [name]);
    return result.rowCount === 1;
  } finally {
    await client.end();
  }
}

describe("harness de teste: isolamento e ciclo de vida do banco", () => {
  it("harnesses criados em paralelo não enxergam os dados uns dos outros", async () => {
    const harnesses = await Promise.all([createHarness(), createHarness(), createHarness()]);
    try {
      await Promise.all(
        harnesses.map((h, index) => h.db.insert(organizations).values({ name: "Org corrida", slug: `org-corrida-${index}` })),
      );
      for (const [index, h] of harnesses.entries()) {
        const rows = await h.db.select().from(organizations);
        expect(rows).toHaveLength(1);
        expect(rows[0]!.slug).toBe(`org-corrida-${index}`);
      }
      // O mesmo slug (único) pode existir em cada banco: prova que não há banco compartilhado.
      await Promise.all(harnesses.map((h) => h.db.insert(organizations).values({ name: "Mesmo slug", slug: "slug-repetido" })));
    } finally {
      await Promise.all(harnesses.map((h) => h.close()));
    }
  });

  it("reaplicar as migrações é no-op (bootstrap idempotente)", async () => {
    const h = await createHarness();
    try {
      await h.db.insert(organizations).values({ name: "Persistente", slug: "persistente" });
      await h.migrate();
      await h.migrate();
      const [row] = await h.db.select({ total: count() }).from(organizations).where(eq(organizations.slug, "persistente"));
      expect(row!.total).toBe(1);
    } finally {
      await h.close();
    }
  });

  it("falha no setup libera conexões e remove o banco exclusivo", async () => {
    const before = activeTestDatabases();
    // Configuração inválida faz o setup falhar depois de o banco ter sido criado e migrado.
    await expect(createHarness({ LOG_LEVEL: "invalido" })).rejects.toThrow(/Configuração inválida/);
    expect(activeTestDatabases()).toEqual(before);
  });

  it.runIf(!!adminUrl)("PostgreSQL: usa banco exclusivo, remove-o no close e preserva o banco administrativo", async () => {
    const h = await createHarness();
    expect(h.kind).toBe("postgres");
    // Tipo de retorno de execute() difere entre drivers; no node-postgres é QueryResult.
    const result = (await h.db.execute(sql`select current_database() as db`)) as unknown as { rows: { db: string }[] };
    const name = result.rows[0]!.db;
    assertTestDatabaseName(name);
    expect(activeTestDatabases()).toContain(name);
    expect(new URL(adminUrl!).pathname.slice(1)).not.toBe(name);
    expect(await databaseExists(name)).toBe(true);

    await h.close();
    await h.close(); // idempotente
    expect(await databaseExists(name)).toBe(false);
    expect(activeTestDatabases()).not.toContain(name);
    // O banco administrativo continua existindo e acessível.
    expect(await databaseExists(new URL(adminUrl!).pathname.slice(1))).toBe(true);
  });

  it("withDatabase troca apenas o nome do banco na URL", () => {
    expect(withDatabase("postgres://u:p@h:5432/base?sslmode=disable", "cf_test_x")).toBe("postgres://u:p@h:5432/cf_test_x?sslmode=disable");
    expect(() => assertTestDatabaseName("postgres")).toThrow();
    expect(() => assertTestDatabaseName('cf_test_x"; drop database postgres; --')).toThrow();
  });
});
