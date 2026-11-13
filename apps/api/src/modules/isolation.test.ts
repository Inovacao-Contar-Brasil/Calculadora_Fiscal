import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, TEST_PASSWORD, type Harness } from "../test/harness.ts";
import { ITEM_PASTILHA, syntheticCnpj, syntheticNfe } from "../test/fixtures.ts";

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

    const imported = await h.request({
      method: "POST",
      url: "/api/companies/" + companyA.id + "/documents",
      cookie: cookieA,
      headers: { "content-type": "application/xml" },
      payload: syntheticNfe({ number: "1001", recipientCnpj: companyA.cnpj, items: [ITEM_PASTILHA] }),
    });
    expect(imported.status).toBe(201);
    documentA = imported.body.document.id;
  });
  afterAll(() => h.close());

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
    const listA = await h.request({ method: "GET", url: "/api/review-items", cookie: cookieA });
    expect(listA.body.items).toHaveLength(1);
    const reviewId = listA.body.items[0].id;
    const listB = await h.request({ method: "GET", url: "/api/review-items", cookie: cookieB });
    expect(listB.body.items).toHaveLength(0);
    expect((await h.request({ method: "GET", url: "/api/review-items?companyId=" + companyA.id, cookie: cookieB })).status).toBe(404);
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
});
