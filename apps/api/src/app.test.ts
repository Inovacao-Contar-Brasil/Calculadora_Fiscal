import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./test/harness.ts";

describe("API servindo o frontend no mesmo origin", () => {
  let h: Harness;
  beforeAll(async () => {
    // Estrutura: <base>/web (raiz servida) e <base>/segredo.txt (fora da raiz, nunca pode vazar).
    const base = mkdtempSync(path.join(tmpdir(), "cf-web-"));
    const dir = path.join(base, "web");
    mkdirSync(path.join(dir, "assets"), { recursive: true });
    writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>Calculadora Fiscal</title>");
    writeFileSync(path.join(dir, "assets", "app.js"), "console.log('app')");
    writeFileSync(path.join(base, "segredo.txt"), "NAO-DEVE-VAZAR");
    h = await createHarness({ WEB_DIST_DIR: dir });
  });
  afterAll(() => h?.close());

  it("entrega index.html para rotas da SPA e 404 JSON para API inexistente", async () => {
    const root = await h.request({ method: "GET", url: "/" });
    expect(root.status).toBe(200);
    expect(root.raw).toContain("Calculadora Fiscal");
    const spa = await h.request({ method: "GET", url: "/empresas/abc" });
    expect(spa.status).toBe(200);
    expect(spa.raw).toContain("Calculadora Fiscal");
    const api = await h.request({ method: "GET", url: "/api/nao-existe" });
    expect(api.status).toBe(404);
    expect(api.body.error.code).toBe("NOT_FOUND");
    const post = await h.request({ method: "POST", url: "/qualquer", payload: {} });
    expect(post.status).toBe(404);
  });

  it("serve arquivos estáticos da raiz", async () => {
    const asset = await h.request({ method: "GET", url: "/assets/app.js" });
    expect(asset.status).toBe(200);
    expect(asset.raw).toContain("console.log");
  });

  it("não expõe arquivos fora da raiz nem lista diretórios (travessia e separadores codificados)", async () => {
    const attempts = [
      "/../segredo.txt",
      "/%2e%2e/segredo.txt",
      "/%2e%2e%2fsegredo.txt",
      "/assets/..%2f..%2fsegredo.txt",
      "/assets%2f..%2f..%2fsegredo.txt",
      "/..%5csegredo.txt",
      "/assets/",
    ];
    for (const url of attempts) {
      const response = await h.request({ method: "GET", url });
      expect(response.raw, url).not.toContain("NAO-DEVE-VAZAR");
      expect(response.raw, url).not.toContain("app.js\"");
    }
    // Rotas de API nunca caem no fallback da SPA, mesmo com codificação.
    const encodedApi = await h.request({ method: "GET", url: "/api%2fdocuments" });
    expect(encodedApi.raw).not.toContain("NAO-DEVE-VAZAR");
  });

  it("health responde sem autenticação", async () => {
    const health = await h.request({ method: "GET", url: "/api/health" });
    expect(health.status).toBe(200);
    expect(health.body.ok).toBe(true);
  });
});
