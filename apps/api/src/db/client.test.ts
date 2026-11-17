import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { organizations } from "./schema.ts";
import { createDatabase, ensurePgliteDataDir } from "./client.ts";

/** Primeiro uso do PGlite em disco (Issue #5: ENOENT quando `.data` não existia). */
describe("PGlite em disco: criação do diretório de dados", () => {
  const roots: string[] = [];
  const newRoot = () => {
    const root = mkdtempSync(path.join(tmpdir(), "cf-pglite-"));
    roots.push(root);
    return root;
  };
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("cria a árvore inexistente no primeiro uso e preserva os dados ao reabrir", async () => {
    const dataDir = path.join(newRoot(), ".data", "aninhado", "pglite");
    expect(existsSync(path.dirname(dataDir))).toBe(false);

    const first = await createDatabase({ kind: "pglite", dataDir });
    try {
      await first.migrate();
      await first.db.insert(organizations).values({ name: "Primeiro uso", slug: "primeiro-uso" });
    } finally {
      await first.close();
    }
    expect(existsSync(dataDir)).toBe(true);

    // Reabrir o mesmo diretório não recria nem apaga o banco existente.
    const second = await createDatabase({ kind: "pglite", dataDir });
    try {
      await second.migrate();
      const rows = await second.db.select().from(organizations);
      expect(rows.map((row) => row.slug)).toEqual(["primeiro-uso"]);
    } finally {
      await second.close();
    }
  });

  it("não cria diretórios para destinos que não são disco", () => {
    const cwdBefore = existsSync(path.resolve("memory:"));
    expect(ensurePgliteDataDir("memory://")).toBeNull();
    expect(ensurePgliteDataDir("idb://calculadora")).toBeNull();
    expect(existsSync(path.resolve("memory:"))).toBe(cwdBefore);
  });

  it("aceita caminho relativo e file:// e é idempotente", () => {
    const root = newRoot();
    const viaUrl = path.join(root, "a", "b");
    expect(ensurePgliteDataDir(pathToFileURL(viaUrl).href)).toBe(viaUrl);
    expect(ensurePgliteDataDir(viaUrl)).toBe(viaUrl);
    expect(existsSync(viaUrl)).toBe(true);
  });
});
