/**
 * Reconciliação do histórico de migrações (CF-INTEG-01, docs/MIGRACOES.md).
 *
 * Uso (lê apps/api/.env, como o seed):
 *   npm run db:reconcile                                   # diagnóstico, não escreve nada
 *   npm run db:reconcile -- --apply --confirm-database=X   # aplica, se o banco for X
 *
 * Só atua em bancos com o histórico antigo do PR #9 (catálogo como 0001/0002).
 * Faça backup antes (pg_dump). A operação é transacional: em falha, nada muda.
 * Não executa as migrações pendentes normais: depois dela, suba a API ou rode
 * o seed, que chamam `migrate()`.
 */
import { sql } from "drizzle-orm";
import { loadConfig } from "../config.ts";
import { createDatabase, databaseOptionsFromEnv, migrationsFolder } from "./client.ts";
import { inspectMigrationHistory, MigrationHistoryError, reconcileLegacyCatalogHistory } from "./migration-history.ts";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const confirm = args.find((a) => a.startsWith("--confirm-database="))?.split("=")[1];

const config = loadConfig();
const database = await createDatabase(databaseOptionsFromEnv(config));
let exitCode = 0;
try {
  const [{ name }] = ((await database.db.execute(sql`select current_database() as name`)) as unknown as { rows: { name: string }[] }).rows as [{ name: string }];
  const { state, ledger } = await inspectMigrationHistory(database.db, migrationsFolder);
  console.log(`Banco: ${name} (${database.kind}); registros no histórico: ${ledger.length}; estado: ${state.kind}`);
  if (state.kind === "CANONICAL") {
    console.log(`Histórico canônico. Aplicadas: [${state.applied.join(", ")}]. Pendentes (aplicadas por migrate()): [${state.pending.join(", ")}]. Nada a reconciliar.`);
  } else if (state.kind === "DIVERGENT") {
    console.error("Histórico divergente: " + state.reason + ". Não há reconciliação automática; investigue (docs/MIGRACOES.md).");
    exitCode = 2;
  } else {
    const result = await reconcileLegacyCatalogHistory(database.db, migrationsFolder, { apply: false });
    console.log(`Plano: executar [${result.plan.apply.join(", ") || "nenhuma"}]; re-datar ${result.plan.retime.map((r) => `${r.canonicalTag} (${r.from} → ${r.to})`).join(", ")}.`);
    if (!apply) {
      console.log("Diagnóstico apenas. Para aplicar: npm run db:reconcile -- --apply --confirm-database=" + name);
    } else if (confirm !== name) {
      console.error(`Recusado: --confirm-database=${confirm ?? "(ausente)"} não confere com o banco atual (${name}).`);
      exitCode = 3;
    } else {
      const done = await reconcileLegacyCatalogHistory(database.db, migrationsFolder, { apply: true });
      console.log(`Reconciliado: ${done.after.length} registros canônicos. Auditoria: MIGRATION_HISTORY_RECONCILED.`);
    }
  }
} catch (error) {
  console.error(error instanceof MigrationHistoryError ? `${error.code}: ${error.message}` : error);
  exitCode = 1;
} finally {
  await database.close();
}
process.exit(exitCode);
