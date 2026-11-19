import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { auditEvents, nfeItems } from "../db/schema.ts";
import { createHarness, TEST_PASSWORD, type Harness } from "../test/harness.ts";
import { syntheticCnpj, syntheticNfe, type SyntheticItem } from "../test/fixtures.ts";
import { ACTIVATE, APPROVE, createSyntheticNorm, createSyntheticRule, op } from "../test/catalog-fixtures.ts";
import { tableChecksums } from "../test/migration-fixtures.ts";
import { CATALOG_TABLES } from "../db/migration-history.ts";

/**
 * CF-INTEG-01 — regressões de COEXISTÊNCIA da correção temporal (PR #10) com
 * o catálogo legal (PR #9) sobre a fundação (PR #7), no mesmo servidor e no
 * mesmo banco. Cada módulo tem testes próprios; aqui o que se prova é que
 * eles não colidem: rotas, escopo/papel, CSRF, auditoria, concorrência e,
 * principalmente, que um não altera o estado do outro. Uma regra ATIVA não
 * classifica NF-e (ADR-007) e resolver uma pendência temporal não toca o
 * catálogo. Dados sintéticos.
 */
describe("coexistência: pendência temporal × catálogo legal", () => {
  let h: Harness;
  let orgA: string;
  let orgB: string;
  let company: { id: string; cnpj: string };
  let cliente: string;
  let fiscal: string;
  let fiscal2: string;
  let admin: string;
  let fiscalB: string;
  let pendencyId: string;
  let sourceId: string;
  let versionId: string;

  const TEMPORAL_ROUTES = [
    ["GET", "/api/temporal-pendencies"],
    ["GET", "/api/temporal-pendencies/:id"],
    ["POST", "/api/temporal-pendencies/:id/resolve"],
  ] as const;
  const CATALOG_ROUTES = [
    ["GET", "/api/organizations/:id/legal-sources"],
    ["POST", "/api/organizations/:id/legal-sources"],
    ["GET", "/api/legal-sources/:id"],
    ["PATCH", "/api/legal-sources/:id/license"],
    ["POST", "/api/legal-sources/:id/snapshots"],
    ["POST", "/api/legal-sources/:id/provisions"],
    ["POST", "/api/legal-provisions/:id/close-effects"],
    ["GET", "/api/organizations/:id/legal-provisions"],
    ["GET", "/api/organizations/:id/tax-rules"],
    ["POST", "/api/organizations/:id/tax-rules"],
    ["GET", "/api/tax-rules/:id"],
    ["POST", "/api/tax-rules/:id/versions"],
    ["GET", "/api/tax-rule-versions/:id"],
    ...["submit", "approve", "return", "activate", "suspend", "reactivate", "revoke"].map((p) => ["POST", "/api/tax-rule-versions/:id/" + p] as const),
  ] as const;
  const REVIEW_ROUTES = [
    ["GET", "/api/review-items/:id"],
    ["PATCH", "/api/review-items/:id"],
    ["POST", "/api/review-items/:id/reopen"],
  ] as const;

  /** Produto com o mesmo NCM/CEST das condições da regra de classificação sintética. */
  const autopeca: SyntheticItem = { code: "CX-01", description: "PECA SINTETICA COEXISTENCIA", ncm: "87083090", cest: "0100100", productCents: 4200 };
  const importNote = async (number: string, issuedAt: string, item: SyntheticItem) => {
    const r = await h.request({ method: "POST", url: "/api/companies/" + company.id + "/documents", cookie: cliente, headers: { "content-type": "application/xml" }, payload: syntheticNfe({ number, issuedAt, recipientCnpj: company.cnpj, items: [item] }) });
    expect(r.status, r.raw).toBe(201);
    return r.body.document.id as string;
  };
  const reviewTables = ["nfe_items", "nfe_documents", "review_items"] as const;
  const pick = (all: Record<string, { rows: number; md5: string }>, tables: readonly string[]) => Object.fromEntries(tables.map((t) => [t, all[t]]));
  const auditActions = async (actions: string[]) =>
    (await h.db.select({ action: auditEvents.action }).from(auditEvents).where(inArray(auditEvents.action, actions))).map((e) => e.action).sort();

  beforeAll(async () => {
    h = await createHarness();
    orgA = (await h.createOrg("Org Coexistência A")).id;
    orgB = (await h.createOrg("Org Coexistência B")).id;
    company = await h.createCompany(orgA, { cnpj: syntheticCnpj("940000000001"), legalName: "Coexistência Sintética" });
    const c = await h.createUser({ email: "cliente@coex.local", orgId: orgA, role: "cliente" });
    await h.createUser({ email: "fiscal@coex.local", orgId: orgA, role: "fiscal" });
    await h.createUser({ email: "fiscal2@coex.local", orgId: orgA, role: "fiscal" });
    await h.createUser({ email: "admin@coex.local", orgId: orgA, role: "admin" });
    await h.createUser({ email: "fiscal@coex-b.local", orgId: orgB, role: "fiscal" });
    await h.grantAccess(company.id, c.id);
    cliente = await h.login("cliente@coex.local", TEST_PASSWORD);
    fiscal = await h.login("fiscal@coex.local", TEST_PASSWORD);
    fiscal2 = await h.login("fiscal2@coex.local", TEST_PASSWORD);
    admin = await h.login("admin@coex.local", TEST_PASSWORD);
    fiscalB = await h.login("fiscal@coex-b.local", TEST_PASSWORD);

    // Pendência temporal: nota de outubro sob homologação a partir de novembro.
    const october = await importNote("8001", "2026-10-10T10:00:00-03:00", autopeca);
    const reviewId = (await h.request({ method: "GET", url: "/api/documents/" + october, cookie: cliente })).body.items[0].reviewItemId as string;
    const homolog = await h.request({ method: "PATCH", url: "/api/review-items/" + reviewId, cookie: fiscal, payload: { status: "HOMOLOGADO", justification: "Homologação sintética.", decision: { enquadramento: "Enquadramento sintético", fundamentoLegal: "Norma Sintética nº 1/2099" }, validFrom: "2026-11-01" } });
    expect(homolog.status, homolog.raw).toBe(200);
    pendencyId = reviewId;

    // Catálogo: norma, dispositivo e regra cujas condições casam com o produto acima.
    const norm = await createSyntheticNorm(h, fiscal, orgA, { number: "1" });
    sourceId = norm.sourceId;
    versionId = (await createSyntheticRule(h, fiscal, orgA, "CLS-COEXISTENCIA", norm.provisionId)).versionId;
  });
  afterAll(() => h?.close());

  it("rotas dos dois módulos e da revisão estão registradas no mesmo servidor, sem colisão", () => {
    for (const [method, url] of [...TEMPORAL_ROUTES, ...CATALOG_ROUTES, ...REVIEW_ROUTES]) expect(h.app.hasRoute({ method, url }), method + " " + url).toBe(true);
    // Prefixos disjuntos: nenhuma rota de um módulo cai no espaço do outro.
    for (const [, url] of CATALOG_ROUTES) expect(url.startsWith("/api/temporal-pendencies")).toBe(false);
  });

  it("sem sessão: 401 nas duas famílias; cliente com acesso: 403 nas coleções das duas", async () => {
    for (const url of ["/api/temporal-pendencies", "/api/temporal-pendencies/" + pendencyId, "/api/organizations/" + orgA + "/legal-sources", "/api/tax-rule-versions/" + versionId]) {
      expect((await h.request({ method: "GET", url })).status, url).toBe(401);
    }
    expect((await h.request({ method: "GET", url: "/api/temporal-pendencies", cookie: cliente })).status).toBe(403);
    expect((await h.request({ method: "GET", url: "/api/temporal-pendencies/" + pendencyId, cookie: cliente })).status).toBe(403);
    expect((await h.request({ method: "GET", url: "/api/organizations/" + orgA + "/legal-sources", cookie: cliente })).status).toBe(403);
    expect((await h.request({ method: "GET", url: "/api/organizations/" + orgA + "/tax-rules", cookie: cliente })).status).toBe(403);
  });

  it("outra organização: 404 com o MESMO corpo de inexistente nas duas famílias", async () => {
    const ghost = "00000000-0000-4000-8000-000000000000";
    const pairs = [
      ["/api/temporal-pendencies/" + pendencyId, "/api/temporal-pendencies/" + ghost],
      ["/api/legal-sources/" + sourceId, "/api/legal-sources/" + ghost],
      ["/api/tax-rule-versions/" + versionId, "/api/tax-rule-versions/" + ghost],
    ];
    for (const [real, missing] of pairs) {
      const a = await h.request({ method: "GET", url: real!, cookie: fiscalB });
      const b = await h.request({ method: "GET", url: missing!, cookie: fiscalB });
      expect(a.status, real).toBe(404);
      expect(a.raw, real).toBe(b.raw);
    }
    // A listagem temporal de B não vê a pendência de A; o catálogo de A não é listável por B.
    expect((await h.request({ method: "GET", url: "/api/temporal-pendencies", cookie: fiscalB })).body.items).toEqual([]);
    expect((await h.request({ method: "GET", url: "/api/organizations/" + orgA + "/legal-sources", cookie: fiscalB })).status).toBe(404);
  });

  it("CSRF vale igual para as mutações das duas famílias", async () => {
    const evil = { origin: "https://atacante.example.invalid" };
    const resolve = await h.request({ method: "POST", url: "/api/temporal-pendencies/" + pendencyId + "/resolve", cookie: fiscal, headers: evil, payload: { status: "HOMOLOGADO", validFrom: "2026-10-01", justification: "tentativa cruzada" } });
    const source = await h.request({ method: "POST", url: "/api/organizations/" + orgA + "/legal-sources", cookie: fiscal, headers: evil, payload: {} });
    const submit = await h.request({ method: "POST", url: "/api/tax-rule-versions/" + versionId + "/submit", cookie: fiscal, headers: { "sec-fetch-site": "cross-site" }, payload: {} });
    for (const r of [resolve, source, submit]) {
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe("FORBIDDEN_ORIGIN");
    }
  });

  it("ativar uma regra que casa com o produto NÃO classifica a NF-e nem mexe na pendência temporal (ADR-007)", async () => {
    const before = await tableChecksums(h.db);
    const pendencyBefore = (await h.request({ method: "GET", url: "/api/temporal-pendencies/" + pendencyId, cookie: fiscal })).body;
    expect((await op(h, fiscal, versionId, "submit", { expectedStatus: "RASCUNHO" })).status).toBe(200);
    expect((await op(h, fiscal2, versionId, "approve", APPROVE)).status).toBe(200);
    const activated = await op(h, admin, versionId, "activate", ACTIVATE);
    expect(activated.status, activated.raw).toBe(200);
    expect(activated.body.version.status).toBe("ATIVA");

    const after = await tableChecksums(h.db);
    expect(pick(after, reviewTables)).toEqual(pick(before, reviewTables));
    expect((await h.request({ method: "GET", url: "/api/temporal-pendencies/" + pendencyId, cookie: fiscal })).body).toEqual(pendencyBefore);
    const items = await h.db.select().from(nfeItems).where(and(eq(nfeItems.companyId, company.id), eq(nfeItems.ncm, autopeca.ncm)));
    expect(items.map((i) => i.classificationStatus)).toEqual(["PENDENTE_REVISAO"]);
  });

  it("resolver a pendência temporal NÃO toca nenhuma tabela do catálogo", async () => {
    const before = pick(await tableChecksums(h.db), CATALOG_TABLES);
    const resolved = await h.request({
      method: "POST",
      url: "/api/temporal-pendencies/" + pendencyId + "/resolve",
      cookie: fiscal,
      payload: { status: "HOMOLOGADO", validFrom: "2026-10-01", validTo: "2026-10-31", justification: "Período anterior conferido (sintético).", decision: { enquadramento: "Enquadramento sintético anterior", fundamentoLegal: "Norma Sintética nº 0/2098" } },
    });
    expect(resolved.status, resolved.raw).toBe(201);
    expect(pick(await tableChecksums(h.db), CATALOG_TABLES)).toEqual(before);
    expect((await h.request({ method: "GET", url: "/api/temporal-pendencies", cookie: fiscal })).body.items).toEqual([]);
  });

  it("auditoria: cada família grava a própria ação; tentativas recusadas não gravam nada", async () => {
    const actions = ["TEMPORAL_PENDENCY_RESOLVED", "RULE_VERSION_SUBMITTED", "RULE_VERSION_APPROVED", "RULE_VERSION_ACTIVATED"];
    expect(await auditActions(actions)).toEqual(["RULE_VERSION_ACTIVATED", "RULE_VERSION_APPROVED", "RULE_VERSION_SUBMITTED", "TEMPORAL_PENDENCY_RESOLVED"]);
    // Recusas das duas famílias: período já decidido (409) e quatro olhos (403).
    const again = await h.request({ method: "POST", url: "/api/temporal-pendencies/" + pendencyId + "/resolve", cookie: fiscal, payload: { status: "REJEITADO", validFrom: "2026-10-01", validTo: "2026-10-31", justification: "Repetição sintética" } });
    expect(again.status, again.raw).toBe(409);
    const norm = await createSyntheticNorm(h, fiscal, orgA, { number: "2" });
    const { versionId: v2 } = await createSyntheticRule(h, fiscal, orgA, "CLS-COEX-RECUSA", norm.provisionId);
    expect((await op(h, fiscal, v2, "submit")).status).toBe(200);
    const self = await op(h, fiscal, v2, "approve", APPROVE);
    expect(self.status).toBe(403);
    expect(self.body.error.code).toBe("FOUR_EYES");
    expect(await auditActions(["TEMPORAL_PENDENCY_RESOLVED", "RULE_VERSION_APPROVED"])).toEqual(["RULE_VERSION_APPROVED", "TEMPORAL_PENDENCY_RESOLVED"]);
  });

  it("operações simultâneas nas duas famílias e na importação concluem sem bloqueio nem interferência", async () => {
    // Nova pendência temporal (outro produto) e nova versão aguardando aprovação.
    const filtro: SyntheticItem = { code: "CX-02", description: "FILTRO SINTETICO COEXISTENCIA", ncm: "84212300", productCents: 900 };
    const october = await importNote("8101", "2026-10-15T10:00:00-03:00", filtro);
    const reviewId = (await h.request({ method: "GET", url: "/api/documents/" + october, cookie: cliente })).body.items[0].reviewItemId as string;
    expect((await h.request({ method: "PATCH", url: "/api/review-items/" + reviewId, cookie: fiscal, payload: { status: "REJEITADO", justification: "Rejeição sintética a partir de novembro", validFrom: "2026-11-01" } })).status).toBe(200);
    const norm = await createSyntheticNorm(h, fiscal, orgA, { number: "3" });
    const { versionId: v3 } = await createSyntheticRule(h, fiscal, orgA, "CLS-COEX-PARALELO", norm.provisionId);
    expect((await op(h, fiscal, v3, "submit")).status).toBe(200);

    const [resolve, approve, imported] = await Promise.all([
      h.request({ method: "POST", url: "/api/temporal-pendencies/" + reviewId + "/resolve", cookie: fiscal, payload: { status: "HOMOLOGADO", validFrom: "2026-10-01", validTo: "2026-10-31", justification: "Período anterior conferido (sintético).", decision: { enquadramento: "Enquadramento sintético", fundamentoLegal: "Norma Sintética nº 3/2099" } } }),
      op(h, fiscal2, v3, "approve", APPROVE),
      h.request({ method: "POST", url: "/api/companies/" + company.id + "/documents", cookie: cliente, headers: { "content-type": "application/xml" }, payload: syntheticNfe({ number: "8102", issuedAt: "2026-11-20T10:00:00-03:00", recipientCnpj: company.cnpj, items: [filtro] }) }),
    ]);
    expect([resolve.status, approve.status, imported.status], [resolve.raw, approve.raw, imported.raw].join("\n")).toEqual([201, 200, 201]);
    // Outubro ficou com a decisão do período; novembro, com a rejeição vigente; regra aprovada.
    const statuses = await h.db.select({ status: nfeItems.classificationStatus }).from(nfeItems).where(and(eq(nfeItems.companyId, company.id), eq(nfeItems.description, filtro.description)));
    expect(statuses.map((s) => s.status).sort()).toEqual(["HOMOLOGADO", "REJEITADO"]);
    expect((await h.request({ method: "GET", url: "/api/tax-rule-versions/" + v3, cookie: fiscal })).body.version.status).toBe("APROVADA");
    expect((await h.request({ method: "GET", url: "/api/temporal-pendencies", cookie: fiscal })).body.items).toEqual([]);
  });
});
