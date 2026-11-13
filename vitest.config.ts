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
          name: "api",
          environment: "node",
          include: ["apps/api/src/**/*.test.ts"],
          // Cada arquivo de teste sobe seu próprio PGlite em memória; manter em série
          // evita disputa de CPU com o WASM e deixa a saída legível.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
