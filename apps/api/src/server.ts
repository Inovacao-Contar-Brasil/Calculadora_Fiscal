import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createDatabase, databaseOptionsFromEnv } from "./db/client.ts";

const config = loadConfig();
const database = await createDatabase(databaseOptionsFromEnv(config));
await database.migrate();

const app = await buildApp({ db: database.db, config });
app.log.info({ database: database.kind, env: config.NODE_ENV }, "banco pronto; migrações aplicadas");

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "encerrando");
  await app.close();
  await database.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: config.HOST, port: config.PORT });
