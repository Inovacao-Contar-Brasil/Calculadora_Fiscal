import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./test/harness.ts";

describe("API servindo o frontend no mesmo origin", () => {
  let h: Harness;
  beforeAll(async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cf-web-"));
    writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>Calculadora Fiscal</title>");
    h = await createHarness({ WEB_DIST_DIR: dir });
  });
  afterAll(() => h.close());

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

  it("health responde sem autenticação", async () => {
    const health = await h.request({ method: "GET", url: "/api/health" });
    expect(health.status).toBe(200);
    expect(health.body.ok).toBe(true);
  });
});
