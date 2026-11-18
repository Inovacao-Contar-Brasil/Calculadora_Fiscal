import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, TEST_PASSWORD, type Harness } from "../test/harness.ts";
import { eq } from "drizzle-orm";
import { auditEvents, nfeDocuments } from "../db/schema.ts";
import { ITEM_PASTILHA, syntheticCnpj, syntheticNfe } from "../test/fixtures.ts";
import { ACTIVATE, APPROVE, CLASSIFICATION_CONDITIONS, createSyntheticNorm, createSyntheticRule, op } from "../test/catalog-fixtures.ts";

/**
 * Isolamento multitenant: cliente A nunca vê dados do cliente B, nem por
 * listagem nem por acesso direto a ID; organizações distintas não se enxergam.
 */
describe("isolamento entre empresas e organizações", () => {
  let h: Harness;
  let org1: string;
  let org2: string;
  let companyA: { id: string; cnpj: string };
  let companyB: { id: string; cnpj: string };
  let companyC: { id: string; cnpj: string };
  let cookieA: string;
  let cookieB: string;
  let cookieFiscal1: string;
  let cookieFiscal2: string;
  let cookieAdmin1: string;
  let documentA: string;
  let xmlA: string;

  beforeAll(async () => {
    h = await createHarness();
    org1 = (await h.createOrg("Org Um")).id;
    org2 = (await h.createOrg("Org Dois")).id;
    companyA = await h.createCompany(org1, { cnpj: syntheticCnpj("100000000001"), legalName: "Empresa A" });
    companyB = await h.createCompany(org1, { cnpj: syntheticCnpj("200000000001"), legalName: "Empresa B" });
    companyC = await h.createCompany(org2, { cnpj: syntheticCnpj("300000000001"), legalName: "Empresa C" });
    const clienteA = await h.createUser({ email: "a@org1.local", orgId: org1, role: "cliente" });
    const clienteB = await h.createUser({ email: "b@org1.local", orgId: org1, role: "cliente" });
    await h.createUser({ email: "fiscal@org1.local", orgId: org1, role: "fiscal" });
    await h.createUser({ email: "admin@org1.local", orgId: org1, role: "admin" });
    await h.createUser({ email: "fiscal@org2.local", orgId: org2, role: "fiscal" });
    await h.grantAccess(companyA.id, clienteA.id);
    await h.grantAccess(companyB.id, clienteB.id);
    cookieA = await h.login("a@org1.local", TEST_PASSWORD);
    cookieB = await h.login("b@org1.local", TEST_PASSWORD);
    cookieFiscal1 = await h.login("fiscal@org1.local", TEST_PASSWORD);
    cookieFiscal2 = await h.login("fiscal@org2.local", TEST_PASSWORD);
    cookieAdmin1 = await h.login("admin@org1.local", TEST_PASSWORD);

    xmlA = syntheticNfe({ number: "1001", recipientCnpj: companyA.cnpj, items: [ITEM_PASTILHA] });
    const imported = await h.request({
      method: "POST",
      url: "/api/companies/" + companyA.id + "/documents",
      cookie: cookieA,
      headers: { "content-type": "application/xml" },
      payload: xmlA,
    });
    expect(imported.status).toBe(201);
    documentA = imported.body.document.id;
  });
  afterAll(() => h?.close());

  it("cliente lista apenas as empresas concedidas; staff lista as da própria organização", async () => {
    const a = await h.request({ method: "GET", url: "/api/companies", cookie: cookieA });
    expect(a.body.companies.map((c: { id: string }) => c.id)).toEqual([companyA.id]);
    const f1 = await h.request({ method: "GET", url: "/api/companies", cookie: cookieFiscal1 });
    expect(f1.body.companies.map((c: { id: string }) => c.id).sort()).toEqual([companyA.id, companyB.id].sort());
    const f2 = await h.request({ method: "GET", url: "/api/companies", cookie: cookieFiscal2 });
    expect(f2.body.companies.map((c: { id: string }) => c.id)).toEqual([companyC.id]);
  });

  it("acesso direto por ID fora do escopo responde 404, sem revelar existência", async () => {
    expect((await h.request({ method: "GET", url: "/api/companies/" + companyB.id, cookie: cookieA })).status).toBe(404);
    expect((await h.request({ method: "GET", url: "/api/companies/" + companyC.id, cookie: cookieA })).status).toBe(404);
    expect((await h.request({ method: "GET", url: "/api/companies/" + companyC.id, cookie: cookieFiscal1 })).status).toBe(404);
    expect((await h.request({ method: "GET", url: "/api/companies/" + companyA.id, cookie: cookieFiscal2 })).status).toBe(404);
    expect((await h.request({ method: "GET", url: "/api/companies/" + companyA.id + "/documents", cookie: cookieB })).status).toBe(404);
    expect((await h.request({ method: "GET", url: "/api/companies/" + companyA.id + "/fiscal-profiles", cookie: cookieB })).status).toBe(404);
  });

  it("documento de A é invisível para B e para outra organização, inclusive o XML", async () => {
    expect((await h.request({ method: "GET", url: "/api/documents/" + documentA, cookie: cookieA })).status).toBe(200);
    expect((await h.request({ method: "GET", url: "/api/documents/" + documentA, cookie: cookieFiscal1 })).status).toBe(200);
    expect((await h.request({ method: "GET", url: "/api/documents/" + documentA, cookie: cookieB })).status).toBe(404);
    expect((await h.request({ method: "GET", url: "/api/documents/" + documentA, cookie: cookieFiscal2 })).status).toBe(404);
    expect((await h.request({ method: "GET", url: "/api/documents/" + documentA + "/xml", cookie: cookieB })).status).toBe(404);
    expect((await h.request({ method: "GET", url: "/api/documents/" + documentA + "/xml", cookie: cookieFiscal2 })).status).toBe(404);
    expect((await h.request({ method: "GET", url: "/api/documents/00000000-0000-4000-8000-000000000000", cookie: cookieA })).status).toBe(404);
  });

  it("cliente não importa para empresa alheia nem staff de outra organização", async () => {
    const xml = syntheticNfe({ number: "1002", recipientCnpj: companyB.cnpj, items: [ITEM_PASTILHA] });
    const asA = await h.request({ method: "POST", url: "/api/companies/" + companyB.id + "/documents", cookie: cookieA, headers: { "content-type": "application/xml" }, payload: xml });
    expect(asA.status).toBe(404);
    const asF2 = await h.request({ method: "POST", url: "/api/companies/" + companyB.id + "/documents", cookie: cookieFiscal2, headers: { "content-type": "application/xml" }, payload: xml });
    expect(asF2.status).toBe(404);
  });

  it("cliente não altera cadastro fiscal, empresas ou usuários", async () => {
    const profile = { regime: "SIMPLES_NACIONAL", cnaes: ["4530703"], contribuinteIcms: true, source: "teste", validFrom: "2026-01-01" };
    expect((await h.request({ method: "POST", url: "/api/companies/" + companyA.id + "/fiscal-profiles", cookie: cookieA, payload: profile })).status).toBe(403);
    expect((await h.request({ method: "POST", url: "/api/organizations/" + org1 + "/companies", cookie: cookieA, payload: { cnpj: syntheticCnpj("400000000001"), legalName: "Nova", uf: "MG" } })).status).toBe(403);
    expect((await h.request({ method: "GET", url: "/api/organizations/" + org1 + "/users", cookie: cookieA })).status).toBe(403);
    expect((await h.request({ method: "POST", url: "/api/companies/" + companyA.id + "/access", cookie: cookieA, payload: { userId: "00000000-0000-4000-8000-000000000000" } })).status).toBe(403);
    // Cliente consulta o próprio cadastro fiscal (somente leitura).
    expect((await h.request({ method: "GET", url: "/api/companies/" + companyA.id + "/fiscal-profiles", cookie: cookieA })).status).toBe(200);
  });

  it("fila de revisão respeita o escopo e cliente não decide", async () => {
    // O cliente acompanha apenas o status de seus documentos, nunca o workflow interno.
    const listA = await h.request({ method: "GET", url: "/api/review-items", cookie: cookieA });
    expect(listA.status).toBe(403);
    const listFiscal = await h.request({ method: "GET", url: "/api/review-items", cookie: cookieFiscal1 });
    expect(listFiscal.status).toBe(200);
    expect(listFiscal.body.items).toHaveLength(1);
    const reviewId = listFiscal.body.items[0].id;
    const listB = await h.request({ method: "GET", url: "/api/review-items", cookie: cookieB });
    expect(listB.status).toBe(403);
    expect((await h.request({ method: "GET", url: "/api/review-items?companyId=" + companyA.id, cookie: cookieA })).status).toBe(403);
    expect((await h.request({ method: "GET", url: "/api/review-items?companyId=" + companyA.id, cookie: cookieB })).status).toBe(404);
    expect((await h.request({ method: "GET", url: "/api/review-items/" + reviewId, cookie: cookieA })).status).toBe(403);
    expect((await h.request({ method: "GET", url: "/api/review-items/" + reviewId, cookie: cookieAdmin1 })).status).toBe(200);
    expect((await h.request({ method: "GET", url: "/api/review-items/" + reviewId, cookie: cookieFiscal1 })).status).toBe(200);
    // O cliente mantém acesso ao próprio documento e aos status dos itens.
    const ownDocument = await h.request({ method: "GET", url: "/api/documents/" + documentA, cookie: cookieA });
    expect(ownDocument.status).toBe(200);
    expect(ownDocument.body.items[0].classificationStatus).toBe("PENDENTE_REVISAO");
    expect((await h.request({ method: "GET", url: "/api/review-items/" + reviewId, cookie: cookieB })).status).toBe(404);
    expect((await h.request({ method: "GET", url: "/api/review-items/" + reviewId, cookie: cookieFiscal2 })).status).toBe(404);

    const decision = { status: "EM_ANALISE" };
    expect((await h.request({ method: "PATCH", url: "/api/review-items/" + reviewId, cookie: cookieA, payload: decision })).status).toBe(403);
    expect((await h.request({ method: "PATCH", url: "/api/review-items/" + reviewId, cookie: cookieFiscal2, payload: decision })).status).toBe(404);
    expect((await h.request({ method: "PATCH", url: "/api/review-items/" + reviewId, cookie: cookieFiscal1, payload: decision })).status).toBe(200);
  });

  it("admin concede acesso somente a membros da própria organização", async () => {
    const outsider = (await h.request({ method: "GET", url: "/api/auth/me", cookie: cookieFiscal2 })).body.user.id;
    expect((await h.request({ method: "POST", url: "/api/companies/" + companyA.id + "/access", cookie: cookieAdmin1, payload: { userId: outsider } })).status).toBe(404);
    expect((await h.request({ method: "POST", url: "/api/companies/" + companyC.id + "/access", cookie: cookieAdmin1, payload: { userId: outsider } })).status).toBe(404);
    const insider = (await h.request({ method: "GET", url: "/api/auth/me", cookie: cookieB })).body.user.id;
    expect((await h.request({ method: "POST", url: "/api/companies/" + companyA.id + "/access", cookie: cookieAdmin1, payload: { userId: insider } })).status).toBe(201);
    expect((await h.request({ method: "GET", url: "/api/companies/" + companyA.id, cookie: cookieB })).status).toBe(200);
    expect((await h.request({ method: "DELETE", url: "/api/companies/" + companyA.id + "/access/" + insider, cookie: cookieAdmin1 })).status).toBe(200);
    expect((await h.request({ method: "GET", url: "/api/companies/" + companyA.id, cookie: cookieB })).status).toBe(404);
  });

  it("fora do escopo responde igual a inexistente (mesmo status e mensagem): sem oráculo de existência", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    const pairs: [string, string][] = [
      ["/api/documents/" + documentA, "/api/documents/" + missing],
      ["/api/documents/" + documentA + "/xml", "/api/documents/" + missing + "/xml"],
    ];
    const reviewId = (await h.request({ method: "GET", url: "/api/review-items", cookie: cookieFiscal1 })).body.items[0].id;
    pairs.push(["/api/review-items/" + reviewId, "/api/review-items/" + missing]);
    for (const [existing, absent] of pairs) {
      const outOfScope = await h.request({ method: "GET", url: existing, cookie: cookieB });
      const notThere = await h.request({ method: "GET", url: absent, cookie: cookieB });
      expect(outOfScope.status, existing).toBe(404);
      expect(outOfScope.body, existing).toEqual(notThere.body);
    }
  });

  it("decisões de revisão: cliente sem acesso e outra organização recebem 404; cliente com acesso recebe 403", async () => {
    const reviewId = (await h.request({ method: "GET", url: "/api/review-items", cookie: cookieFiscal1 })).body.items[0].id;
    const reopen = { validTo: "2026-12-31", reason: "teste de escopo" };
    // Cliente B é da mesma organização, mas sem acesso à empresa A: não pode saber que o item existe.
    expect((await h.request({ method: "PATCH", url: "/api/review-items/" + reviewId, cookie: cookieB, payload: { status: "PENDENTE_REVISAO" } })).status).toBe(404);
    expect((await h.request({ method: "POST", url: "/api/review-items/" + reviewId + "/reopen", cookie: cookieB, payload: reopen })).status).toBe(404);
    expect((await h.request({ method: "POST", url: "/api/review-items/" + reviewId + "/reopen", cookie: cookieFiscal2, payload: reopen })).status).toBe(404);
    // Cliente A pode ver seu documento, mas não pode ler ou alterar a revisão administrativa.
    expect((await h.request({ method: "POST", url: "/api/review-items/" + reviewId + "/reopen", cookie: cookieA, payload: reopen })).status).toBe(403);
  });

  it("XML devolvido é byte a byte o importado, com hash, sem cache, e o download é auditado", async () => {
    const response = await h.request({ method: "GET", url: "/api/documents/" + documentA + "/xml", cookie: cookieA });
    expect(response.status).toBe(200);
    expect(response.raw).toBe(xmlA);
    const [doc] = await h.db.select().from(nfeDocuments).where(eq(nfeDocuments.id, documentA));
    expect(response.headers["x-content-sha256"]).toBe(doc!.sha256);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(String(response.headers["content-disposition"])).toBe('attachment; filename="' + doc!.accessKey + '.xml"');
    const events = await h.db.select().from(auditEvents).where(eq(auditEvents.entityId, documentA));
    expect(events.some((e) => e.action === "NFE_XML_DOWNLOADED")).toBe(true);
  });

  it("XML adulterado no banco não é entregue e a falha de integridade é auditada", async () => {
    const xml = syntheticNfe({ number: "1003", recipientCnpj: companyA.cnpj, items: [ITEM_PASTILHA] });
    const imported = await h.request({ method: "POST", url: "/api/companies/" + companyA.id + "/documents", cookie: cookieA, headers: { "content-type": "application/xml" }, payload: xml });
    const id = imported.body.document.id as string;
    const tampered = xml.replace("Pastilha de freio", "Pastilha adulterada");
    expect(tampered).not.toBe(xml);
    await h.db.update(nfeDocuments).set({ rawXml: tampered }).where(eq(nfeDocuments.id, id));
    const response = await h.request({ method: "GET", url: "/api/documents/" + id + "/xml", cookie: cookieA });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("INTEGRITY_FAILURE");
    expect(response.raw).not.toContain("adulterada");
    const events = await h.db.select().from(auditEvents).where(eq(auditEvents.entityId, id));
    expect(events.map((e) => e.action)).toContain("NFE_INTEGRITY_FAILURE");
    expect(events.map((e) => e.action)).not.toContain("NFE_XML_DOWNLOADED");
  });

  it("revogar o acesso encerra a leitura de documentos e XML na sessão já aberta", async () => {
    const insider = (await h.request({ method: "GET", url: "/api/auth/me", cookie: cookieB })).body.user.id;
    await h.request({ method: "POST", url: "/api/companies/" + companyA.id + "/access", cookie: cookieAdmin1, payload: { userId: insider } });
    expect((await h.request({ method: "GET", url: "/api/documents/" + documentA + "/xml", cookie: cookieB })).status).toBe(200);
    await h.request({ method: "DELETE", url: "/api/companies/" + companyA.id + "/access/" + insider, cookie: cookieAdmin1 });
    expect((await h.request({ method: "GET", url: "/api/documents/" + documentA, cookie: cookieB })).status).toBe(404);
    expect((await h.request({ method: "GET", url: "/api/documents/" + documentA + "/xml", cookie: cookieB })).status).toBe(404);
  });

  it("pendências temporais: só staff do escopo lê e resolve; fora do escopo responde igual a inexistente", async () => {
    // Pendência sintética na empresa A: nota de outubro, homologação a partir de novembro.
    const item = { code: "ISO-T1", description: "PRODUTO SINTETICO ISOLAMENTO TEMPORAL", ncm: "40111000", productCents: 1000 };
    const xml = syntheticNfe({ number: "1501", issuedAt: "2026-10-01T10:00:00-03:00", recipientCnpj: companyA.cnpj, items: [item] });
    const imported = await h.request({ method: "POST", url: "/api/companies/" + companyA.id + "/documents", cookie: cookieA, headers: { "content-type": "application/xml" }, payload: xml });
    expect(imported.status).toBe(201);
    const ownDoc = await h.request({ method: "GET", url: "/api/documents/" + imported.body.document.id, cookie: cookieA });
    const pendencyId = ownDoc.body.items[0].reviewItemId as string;
    const secret = "Justificativa interna sintética que o cliente não pode ler";
    const homologated = await h.request({
      method: "PATCH",
      url: "/api/review-items/" + pendencyId,
      cookie: cookieFiscal1,
      payload: { status: "HOMOLOGADO", justification: secret, decision: { enquadramento: "Enquadramento sintético", fundamentoLegal: "Norma Sintética nº 2/2099" }, validFrom: "2026-11-01" },
    });
    expect(homologated.status).toBe(200);
    const resolveBody = { status: "REJEITADO", validFrom: "2026-10-01", validTo: "2026-10-31", justification: "Tentativa fora do escopo (sintética)." };
    const missing = "00000000-0000-4000-8000-000000000000";

    // Staff da organização lê.
    const list = await h.request({ method: "GET", url: "/api/temporal-pendencies", cookie: cookieFiscal1 });
    expect(list.status).toBe(200);
    expect(list.body.items.map((p: { id: string }) => p.id)).toEqual([pendencyId]);
    expect((await h.request({ method: "GET", url: "/api/temporal-pendencies?companyId=" + companyA.id, cookie: cookieAdmin1 })).status).toBe(200);
    expect((await h.request({ method: "GET", url: "/api/temporal-pendencies/" + pendencyId, cookie: cookieAdmin1 })).status).toBe(200);

    // Cliente com acesso à empresa: não lê nem resolve o fluxo interno (403).
    expect((await h.request({ method: "GET", url: "/api/temporal-pendencies", cookie: cookieA })).status).toBe(403);
    expect((await h.request({ method: "GET", url: "/api/temporal-pendencies?companyId=" + companyA.id, cookie: cookieA })).status).toBe(403);
    expect((await h.request({ method: "GET", url: "/api/temporal-pendencies/" + pendencyId, cookie: cookieA })).status).toBe(403);
    expect((await h.request({ method: "POST", url: "/api/temporal-pendencies/" + pendencyId + "/resolve", cookie: cookieA, payload: resolveBody })).status).toBe(403);
    // ...e continua vendo só o status no próprio documento, sem justificativa interna.
    const clientView = await h.request({ method: "GET", url: "/api/documents/" + imported.body.document.id, cookie: cookieA });
    expect(clientView.body.items[0].classificationStatus).toBe("PENDENTE_REVISAO");
    expect(clientView.raw).not.toContain(secret);
    expect(clientView.raw).not.toContain("Norma Sintética nº 2/2099");

    // Cliente sem acesso e staff de outra organização: 404 com o mesmo corpo de inexistente.
    for (const cookie of [cookieB, cookieFiscal2]) {
      expect((await h.request({ method: "GET", url: "/api/temporal-pendencies?companyId=" + companyA.id, cookie })).status).toBe(404);
      const outOfScope = await h.request({ method: "GET", url: "/api/temporal-pendencies/" + pendencyId, cookie });
      const absent = await h.request({ method: "GET", url: "/api/temporal-pendencies/" + missing, cookie });
      expect(outOfScope.status).toBe(404);
      expect(outOfScope.body).toEqual(absent.body);
      const resolveOut = await h.request({ method: "POST", url: "/api/temporal-pendencies/" + pendencyId + "/resolve", cookie, payload: resolveBody });
      const resolveAbsent = await h.request({ method: "POST", url: "/api/temporal-pendencies/" + missing + "/resolve", cookie, payload: resolveBody });
      expect(resolveOut.status).toBe(404);
      expect(resolveOut.body).toEqual(resolveAbsent.body);
    }
    expect((await h.request({ method: "GET", url: "/api/temporal-pendencies", cookie: cookieB })).status).toBe(403);
    expect((await h.request({ method: "GET", url: "/api/temporal-pendencies", cookie: cookieFiscal2 })).body.items).toEqual([]);
    // Item de revisão sem pendência temporal responde como inexistente.
    const plainReview = (await h.request({ method: "GET", url: "/api/review-items", cookie: cookieFiscal1 })).body.items.find((r: { id: string }) => r.id !== pendencyId).id;
    const noPendency = await h.request({ method: "GET", url: "/api/temporal-pendencies/" + plainReview, cookie: cookieFiscal1 });
    expect(noPendency.status).toBe(404);
    expect(noPendency.body).toEqual((await h.request({ method: "GET", url: "/api/temporal-pendencies/" + missing, cookie: cookieFiscal1 })).body);

    // Nada foi gravado pelas tentativas negadas; o staff da organização resolve.
    const denied = await h.db.select().from(auditEvents).where(eq(auditEvents.entityId, pendencyId));
    expect(denied.map((e) => e.action)).not.toContain("TEMPORAL_PENDENCY_RESOLVED");
    expect((await h.request({ method: "POST", url: "/api/temporal-pendencies/" + pendencyId + "/resolve", cookie: cookieFiscal1, payload: resolveBody })).status).toBe(201);
  });
});

/**
 * Catálogo legal (2A.1): administração normativa é exclusiva da equipe do
 * escritório. Toda rota nova do catálogo aparece aqui com teste negativo.
 */
describe("isolamento do catálogo legal", () => {
  let h: Harness;
  let org1: string;
  let org2: string;
  let cliente1: string;
  let fiscal1: string;
  let fiscal1b: string;
  let admin1: string;
  let fiscal2: string;
  let norm: { sourceId: string; snapshotId: string; provisionId: string };
  let rule: { ruleId: string; versionId: string };
  const MISSING = "00000000-0000-4000-8000-000000000000";

  beforeAll(async () => {
    h = await createHarness();
    org1 = (await h.createOrg("Escritório Um")).id;
    org2 = (await h.createOrg("Escritório Dois")).id;
    const company = await h.createCompany(org1, { cnpj: syntheticCnpj("510000000001"), legalName: "Cliente Sintético" });
    const cliente = await h.createUser({ email: "cliente@cat1.local", orgId: org1, role: "cliente" });
    await h.grantAccess(company.id, cliente.id);
    await h.createUser({ email: "fiscal@cat1.local", orgId: org1, role: "fiscal" });
    await h.createUser({ email: "fiscalb@cat1.local", orgId: org1, role: "fiscal" });
    await h.createUser({ email: "admin@cat1.local", orgId: org1, role: "admin" });
    await h.createUser({ email: "fiscal@cat2.local", orgId: org2, role: "fiscal" });
    cliente1 = await h.login("cliente@cat1.local", TEST_PASSWORD);
    fiscal1 = await h.login("fiscal@cat1.local", TEST_PASSWORD);
    fiscal1b = await h.login("fiscalb@cat1.local", TEST_PASSWORD);
    admin1 = await h.login("admin@cat1.local", TEST_PASSWORD);
    fiscal2 = await h.login("fiscal@cat2.local", TEST_PASSWORD);
    norm = await createSyntheticNorm(h, fiscal1, org1, { number: "1" });
    rule = await createSyntheticRule(h, fiscal1, org1, "CLS-ISOLAMENTO", norm.provisionId);
    expect((await op(h, fiscal1, rule.versionId, "submit")).status).toBe(200);
  });
  afterAll(() => h?.close());

  const sourceBody = { kind: "DECRETO", jurisdiction: "FEDERAL", issuer: "Órgão Sintético", number: "77/2099", title: "Norma Sintética nº 77/2099", publishedAt: "2099-01-02", officialUrl: "https://normas.example.invalid/77", licenseStatus: "OFICIAL_PUBLICO" };
  const versionBody = () => ({ conditions: CLASSIFICATION_CONDITIONS, effectsFrom: "2099-02-01", changeReason: "isolamento sintético", provisions: [{ provisionId: norm.provisionId, role: "FUNDAMENTO" }] });
  const collectionRoutes = () => [
    { method: "GET" as const, url: "/api/organizations/" + org1 + "/legal-sources" },
    { method: "POST" as const, url: "/api/organizations/" + org1 + "/legal-sources", payload: sourceBody },
    { method: "GET" as const, url: "/api/organizations/" + org1 + "/legal-provisions" },
    { method: "GET" as const, url: "/api/organizations/" + org1 + "/tax-rules" },
    { method: "POST" as const, url: "/api/organizations/" + org1 + "/tax-rules", payload: { code: "CLS-INVASOR", title: "Invasor", layer: "CLASSIFICACAO", kind: "SEGMENTO_ST", version: versionBody() } },
  ];
  /** Rotas por ID com [URL do recurso real, URL de ID inexistente]. */
  const byIdRoutes = () => {
    const pair = (method: "GET" | "POST" | "PATCH", path: (id: string) => string, real: string, payload?: Record<string, unknown>) => ({ method, real: path(real), absent: path(MISSING), payload });
    return [
      pair("GET", (id) => "/api/legal-sources/" + id, norm.sourceId),
      pair("PATCH", (id) => "/api/legal-sources/" + id + "/license", norm.sourceId, { licenseStatus: "LICENCA_NAO_VERIFICADA", justification: "invasão" }),
      pair("POST", (id) => "/api/legal-sources/" + id + "/snapshots", norm.sourceId, { retrievedAt: "2026-11-01T10:00:00Z", method: "MANUAL", contentSha256: "f".repeat(64) }),
      pair("POST", (id) => "/api/legal-sources/" + id + "/provisions", norm.sourceId, { snapshotId: norm.snapshotId, reference: "art. 99", effectsFrom: "2099-02-01" }),
      pair("POST", (id) => "/api/legal-provisions/" + id + "/close-effects", norm.provisionId, { effectsTo: "2099-12-31", reason: "invasão" }),
      pair("GET", (id) => "/api/tax-rules/" + id, rule.ruleId),
      pair("POST", (id) => "/api/tax-rules/" + id + "/versions", rule.ruleId, versionBody()),
      pair("GET", (id) => "/api/tax-rule-versions/" + id, rule.versionId),
      pair("POST", (id) => "/api/tax-rule-versions/" + id + "/submit", rule.versionId, {}),
      pair("POST", (id) => "/api/tax-rule-versions/" + id + "/approve", rule.versionId, APPROVE),
      pair("POST", (id) => "/api/tax-rule-versions/" + id + "/return", rule.versionId, APPROVE),
      pair("POST", (id) => "/api/tax-rule-versions/" + id + "/activate", rule.versionId, ACTIVATE),
      pair("POST", (id) => "/api/tax-rule-versions/" + id + "/suspend", rule.versionId, { justification: "invasão" }),
      pair("POST", (id) => "/api/tax-rule-versions/" + id + "/reactivate", rule.versionId, ACTIVATE),
      pair("POST", (id) => "/api/tax-rule-versions/" + id + "/revoke", rule.versionId, { justification: "invasão", effectsEndedOn: "2099-12-31" }),
    ];
  };

  it("sem sessão: 401 em todas as rotas do catálogo", async () => {
    for (const route of collectionRoutes()) expect((await h.request({ method: route.method, url: route.url, payload: route.payload })).status, route.url).toBe(401);
    for (const route of byIdRoutes()) expect((await h.request({ method: route.method, url: route.real, payload: route.payload })).status, route.real).toBe(401);
  });

  it("cliente da mesma organização: 403 nas coleções e 404 indistinguível nos recursos, mesmo conhecendo os IDs", async () => {
    for (const route of collectionRoutes()) {
      const response = await h.request({ method: route.method, url: route.url, cookie: cliente1, payload: route.payload });
      expect(response.status, route.method + " " + route.url).toBe(403);
    }
    for (const route of byIdRoutes()) {
      const real = await h.request({ method: route.method, url: route.real, cookie: cliente1, payload: route.payload });
      const absent = await h.request({ method: route.method, url: route.absent, cookie: cliente1, payload: route.payload });
      expect(real.status, route.method + " " + route.real).toBe(404);
      expect(real.body, route.real).toEqual(absent.body);
    }
  });

  it("fiscal de outra organização: 404 em tudo, inclusive coleções, sem revelar existência", async () => {
    for (const route of collectionRoutes()) {
      const response = await h.request({ method: route.method, url: route.url, cookie: fiscal2, payload: route.payload });
      expect(response.status, route.method + " " + route.url).toBe(404);
    }
    for (const route of byIdRoutes()) {
      const real = await h.request({ method: route.method, url: route.real, cookie: fiscal2, payload: route.payload });
      const absent = await h.request({ method: route.method, url: route.absent, cookie: fiscal2, payload: route.payload });
      expect(real.status, route.method + " " + route.real).toBe(404);
      expect(real.body, route.real).toEqual(absent.body);
    }
    // Listagens da própria organização não trazem nada da outra.
    expect((await h.request({ method: "GET", url: "/api/organizations/" + org2 + "/tax-rules", cookie: fiscal2 })).body.rules).toEqual([]);
    expect((await h.request({ method: "GET", url: "/api/organizations/" + org2 + "/legal-sources", cookie: fiscal2 })).body.sources).toEqual([]);
  });

  it("organizationId no corpo não é aceito nem redireciona a escrita; dispositivo alheio é indistinguível de inexistente", async () => {
    const injected = await h.request({ method: "POST", url: "/api/organizations/" + org2 + "/legal-sources", cookie: fiscal2, payload: { ...sourceBody, organizationId: org1 } });
    expect(injected.status).toBe(400);
    // Fiscal da org 2 tenta citar o dispositivo da org 1 na própria regra.
    const foreign = await h.request({ method: "POST", url: "/api/organizations/" + org2 + "/tax-rules", cookie: fiscal2, payload: { code: "CLS-ALHEIO", title: "Dispositivo alheio", layer: "CLASSIFICACAO", kind: "SEGMENTO_ST", version: versionBody() } });
    const missing = await h.request({ method: "POST", url: "/api/organizations/" + org2 + "/tax-rules", cookie: fiscal2, payload: { code: "CLS-ALHEIO", title: "Dispositivo alheio", layer: "CLASSIFICACAO", kind: "SEGMENTO_ST", version: { ...versionBody(), provisions: [{ provisionId: MISSING, role: "FUNDAMENTO" }] } } });
    expect(foreign.status).toBe(422);
    expect(foreign.body.error.message).toBe(missing.body.error.message);
    expect((await h.request({ method: "GET", url: "/api/organizations/" + org1 + "/tax-rules", cookie: fiscal1 })).body.rules.map((r: { code: string }) => r.code)).toEqual(["CLS-ISOLAMENTO"]);
  });

  it("nada do que foi tentado por cliente ou outra organização mudou o catálogo ou gerou trilha", async () => {
    const detail = await h.request({ method: "GET", url: "/api/tax-rule-versions/" + rule.versionId, cookie: fiscal1 });
    expect(detail.body.version.status).toBe("EM_REVISAO_TECNICA");
    expect(detail.body.trail.map((t: { action: string }) => t.action)).toEqual(["SUBMETE"]);
    const source = await h.request({ method: "GET", url: "/api/legal-sources/" + norm.sourceId, cookie: fiscal1 });
    expect(source.body.source.licenseStatus).toBe("OFICIAL_PUBLICO");
    expect(source.body.snapshots).toHaveLength(1);
    expect(source.body.provisions).toHaveLength(1);
    // Usuários legítimos continuam operando: o fluxo segue com outra pessoa.
    expect((await op(h, fiscal1b, rule.versionId, "approve", APPROVE)).status).toBe(200);
    expect((await op(h, admin1, rule.versionId, "activate", ACTIVATE)).status).toBe(200);
  });
});
