import { defineConfig } from "drizzle-kit";

// `drizzle-kit generate` lê o esquema TypeScript e grava migrações SQL
// versionadas em ./drizzle. Não precisa de banco para gerar.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  strict: true,
  verbose: true,
});
