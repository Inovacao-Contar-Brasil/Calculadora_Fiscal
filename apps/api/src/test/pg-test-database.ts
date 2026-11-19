import { randomBytes } from "node:crypto";

/**
 * Banco PostgreSQL exclusivo por harness de teste.
 *
 * Por que existe: o Vitest executa arquivos de teste em paralelo (a opção
 * `fileParallelism` não é aceita dentro de `projects` e é ignorada sem aviso).
 * A versão anterior do harness fazia `DROP SCHEMA public CASCADE` no banco
 * apontado por TEST_DATABASE_URL, então uma suíte destruía o schema enquanto
 * outra migrava — erros `schema "public" already exists`,
 * `drizzle.__drizzle_migrations does not exist` e `sessions does not exist`
 * no CI (run 43461045963).
 *
 * Agora TEST_DATABASE_URL é usado **apenas como conexão administrativa**:
 * cada harness cria um banco novo com nome aleatório e prefixo fixo, aplica as
 * migrações nele e o remove ao final. Nenhum objeto do banco administrativo
 * (nem de qualquer outro banco) é alterado ou removido. O usuário precisa do
 * privilégio CREATEDB.
 */
export const TEST_DATABASE_PREFIX = "cf_test_";

const NAME_PATTERN = /^cf_test_[a-z0-9_]{1,40}$/;

/** Bancos criados por este processo e ainda não removidos (diagnóstico e testes do harness). */
const active = new Set<string>();
export function activeTestDatabases(): string[] {
  return [...active];
}

export interface TestDatabase {
  /** Nome do banco exclusivo criado para este harness. */
  name: string;
  /** URL de conexão para o banco exclusivo. */
  url: string;
  /** Remove o banco exclusivo. Idempotente. */
  drop(): Promise<void>;
}

/** Gera um nome único e seguro (somente [a-z0-9_]) para o banco de teste. */
export function newTestDatabaseName(): string {
  const name = `${TEST_DATABASE_PREFIX}${process.pid}_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
  assertTestDatabaseName(name);
  return name;
}

/** Recusa qualquer nome fora do padrão — protege contra DROP de banco alheio. */
export function assertTestDatabaseName(name: string): void {
  if (!NAME_PATTERN.test(name)) throw new Error(`Nome de banco de teste inválido: ${name}`);
}

/** Troca o banco (path) de uma URL postgres preservando usuário, host e parâmetros. */
export function withDatabase(adminUrl: string, database: string): string {
  const url = new URL(adminUrl);
  url.pathname = "/" + database;
  return url.toString();
}

export async function createTestDatabase(adminUrl: string): Promise<TestDatabase> {
  const { Client } = await import("pg");
  const name = newTestDatabaseName();

  // Identificador já validado pelo padrão acima; DDL não aceita parâmetros.
  await withAdmin(Client, adminUrl, (client) => client.query(`create database "${name}"`));
  active.add(name);

  let dropped = false;
  return {
    name,
    url: withDatabase(adminUrl, name),
    async drop() {
      if (dropped) return;
      assertTestDatabaseName(name);
      await withAdmin(Client, adminUrl, async (client) => {
        // `pool.end()` do pg resolve quando os clientes saem da lista do pool, ANTES de
        // o socket fechar. Um DROP ... WITH (FORCE) imediato derruba essas conexões ainda
        // em encerramento (FATAL 57P01), o pool emite `error` sem ouvinte e o worker do
        // Vitest morre com exceção não tratada, deixando bancos `cf_test_*` órfãos
        // (CF-INTEG-01, reproduzido em 1 de 6 execuções da suíte integrada). Espera-se
        // até ~1 s pelas conexões do próprio teste; FORCE só para o que sobrar.
        for (let attempt = 0; attempt < 50; attempt++) {
          const { rows } = await client.query<{ n: number }>("select count(*)::int as n from pg_stat_activity where datname = $1", [name]);
          if (rows[0]!.n === 0) break;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        // WITH (FORCE) (PostgreSQL 13+) encerra conexões remanescentes do próprio teste.
        await client.query(`drop database if exists "${name}" with (force)`);
      });
      dropped = true;
      active.delete(name);
    },
  };
}

type ClientCtor = typeof import("pg").Client;

async function withAdmin<T>(Client: ClientCtor, adminUrl: string, fn: (client: InstanceType<ClientCtor>) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
