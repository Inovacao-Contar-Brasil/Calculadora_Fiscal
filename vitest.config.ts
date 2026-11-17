import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    projects: [
      {
        test: {
          name: "domain",
          environment: "node",
          include: ["packages/domain/src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "web",
          // Componentes React e fronteiras do Design System (apps/web/test).
          environment: "jsdom",
          include: ["apps/web/test/**/*.test.{ts,tsx}"],
          setupFiles: ["apps/web/test/setup.ts"],
        },
      },
      {
        test: {
          name: "api",
          environment: "node",
          include: ["apps/api/src/**/*.test.ts"],
          // Os arquivos rodam em PARALELO. `fileParallelism` não é aceito dentro de
          // `projects` (o Vitest ignora sem aviso), por isso cada harness tem banco
          // próprio: PGlite em memória ou, com TEST_DATABASE_URL, um banco PostgreSQL
          // exclusivo criado e removido pelo harness (apps/api/src/test/pg-test-database.ts).
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
