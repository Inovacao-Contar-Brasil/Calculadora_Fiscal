import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, TEST_PASSWORD, type Harness } from "../test/harness.ts";
import { ITEM_FILTRO, ITEM_PASTILHA, syntheticCnpj, syntheticNfe } from "../test/fixtures.ts";

describe("importação persistente de NF-e, histórico e revisão fiscal", () => {
  let h: Harness;
  let company: { id: string; cnpj: string };
  let cliente: string;
  let fiscal: string;
  let firstDocId: string;
  let reviewPastilha: string;
  let reviewFiltro: string;
  const xml1 = () => syntheticNfe({ number: "7001", recipientCnpj: company.cnpj, items: [ITEM_PASTILHA, ITEM_FILTRO] });

  const importXml = (xml: string, cookie = cliente, companyId = company.id, fileName?: string) =>
    h.request({
      method: "POST",
      url: "/api/companies/" + companyId + "/documents" + (fileName ? "?fileName=" + encodeURIComponent(fileName) : ""),
      cookie,
      headers: { "content-type": "application/xml" },
      payload: xml,
    });

  beforeAll(async () => {
    h = await createHarness();
    const org = await h.createOrg("Org Docs");
    company = await h.createCompany(org.id, { cnpj: syntheticCnpj("600000000001"), legalName: "Distribuidora Sintética" });
    const c = await h.createUser({ email: "cliente@d.local", orgId: org.id, role: "cliente" });
    await h.createUser({ email: "fiscal@d.local", orgId: org.id, role: "fiscal" });
    await h.grantAccess(company.id, c.id);
    cliente = await h.login("cliente@d.local", TEST_PASSWORD);
    fiscal = await h.login("fiscal@d.local", TEST_PASSWORD);
  });
  afterAll(() => h.close());

  it("importa, persiste itens e abre pendências de revisão sem calcular nada", async () => {
    const response = await importXml(xml1(), cliente, company.id, "nota-7001.xml");
    expect(response.status).toBe(201);
    expect(response.body.duplicate).toBe(false);
    expect(response.body.pendingCount).toBe(2);
    expect(response.body.document).toMatchObject({ number: "7001", itemCount: 2, status: "COM_PENDENCIAS", fileName: "nota-7001.xml", recipient: { document: company.cnpj } });
    expect(response.body.document.accessKey).toHaveLength(44);
    firstDocId = response.body.document.id;

    const detail = await h.request({ method: "GET", url: "/api/documents/" + firstDocId, cookie: cliente });
    expect(detail.status).toBe(200);
    expect(detail.body.items).toHaveLength(2);
    expect(detail.body.items[0]).toMatchObject({ line: 1, description: "Pastilha de freio dianteira", ncm: "87083090", cest: "0100100", productCents: 15000, classificationStatus: "PENDENTE_REVISAO" });
    expect(detail.body.items[1]).toMatchObject({ line: 2, productCents: 4000, freightCents: 500, classificationStatus: "PENDENTE_REVISAO" });
    expect(detail.body.items[0].reviewItemId).toBeTruthy();
    // Nenhum campo de cálculo é exposto.
    expect(JSON.stringify(detail.body)).not.toMatch(/icmsStCalculado|custoUnitario|antecipacaoCalculada/);

    const queue = await h.request({ method: "GET", url: "/api/review-items?companyId=" + company.id + "&status=PENDENTE_REVISAO", cookie: fiscal });
    expect(queue.body.items).toHaveLength(2);
    reviewPastilha = queue.body.items.find((i: { ncm: string }) => i.ncm === "87083090").id;
    reviewFiltro = queue.body.items.find((i: { ncm: string }) => i.ncm === "84212300").id;
    expect(queue.body.items[0]).toMatchObject({ occurrences: 1, companyName: "Distribuidora Sintética" });
  });

  it("reimportação é idempotente: devolve o mesmo documento e não grava de novo", async () => {
    const again = await importXml(xml1());
    expect(again.status).toBe(200);
    expect(again.body.duplicate).toBe(true);
    expect(again.body.contentDiffers).toBe(false);
    expect(again.body.document.id).toBe(firstDocId);

    // Mesma chave, bytes diferentes (ex.: XML reindentado): continua duplicado, com aviso.
    const reformatted = xml1().replace("<nNF>7001</nNF>", "<nNF>7001</nNF>\n");
    const differs = await importXml(reformatted);
    expect(differs.status).toBe(200);
    expect(differs.body).toMatchObject({ duplicate: true, contentDiffers: true });

    const history = await h.request({ method: "GET", url: "/api/companies/" + company.id + "/documents", cookie: cliente });
    expect(history.body.total).toBe(1);
    const queue = await h.request({ method: "GET", url: "/api/review-items?companyId=" + company.id, cookie: fiscal });
    expect(queue.body.items.every((i: { occurrences: number }) => i.occurrences === 1)).toBe(true);
  });

  it("preserva o XML original byte a byte", async () => {
    const download = await h.request({ method: "GET", url: "/api/documents/" + firstDocId + "/xml", cookie: cliente });
    expect(download.status).toBe(200);
    expect(String(download.headers["content-type"])).toMatch(/application\/xml/);
    expect(download.raw).toBe(xml1());
  });

  it("recusa destinatário divergente, XML inválido, DTD e corpo não-XML", async () => {
    const otherCnpj = syntheticCnpj("700000000001");
    const mismatch = await importXml(syntheticNfe({ number: "7002", recipientCnpj: otherCnpj, items: [ITEM_PASTILHA] }));
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.error.message).toMatch(/não corresponde ao CNPJ/);
    expect((await importXml("<nfeProc><NFe></nfeProc>")).status).toBe(422);
    expect((await importXml("<!DOCTYPE a [<!ENTITY x 'z'>]><NFe/>")).status).toBe(422);
    expect((await importXml("<CTe><infCte/></CTe>")).status).toBe(422);
    const json = await h.request({ method: "POST", url: "/api/companies/" + company.id + "/documents", cookie: cliente, payload: { xml: "x" } });
    expect(json.status).toBe(400);
    const history = await h.request({ method: "GET", url: "/api/companies/" + company.id + "/documents", cookie: cliente });
    expect(history.body.total).toBe(1);
  });

  it("fiscal homologa o enquadramento e o status se propaga aos itens e ao documento", async () => {
    const noDecision = await h.request({ method: "PATCH", url: "/api/review-items/" + reviewPastilha, cookie: fiscal, payload: { status: "HOMOLOGADO", justification: "sem decisão" } });
    expect(noDecision.status).toBe(400);

    const ok = await h.request({
      method: "PATCH",
      url: "/api/review-items/" + reviewPastilha,
      cookie: fiscal,
      payload: {
        status: "HOMOLOGADO",
        justification: "Produto de autopeças com CEST próprio; enquadramento conferido pelo Fiscal.",
        decision: { enquadramento: "ICMS-ST autopeças", fundamentoLegal: "Referência a definir no catálogo de regras (Issue #3)" },
        validFrom: "2026-01-01",
      },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.item).toMatchObject({ status: "HOMOLOGADO", validFrom: "2026-01-01", validTo: null });
    expect(ok.body.item.decidedBy).toBeTruthy();

    const detail = await h.request({ method: "GET", url: "/api/documents/" + firstDocId, cookie: cliente });
    expect(detail.body.items[0].classificationStatus).toBe("HOMOLOGADO");
    expect(detail.body.items[1].classificationStatus).toBe("PENDENTE_REVISAO");
    expect(detail.body.document.status).toBe("COM_PENDENCIAS");

    // Transição inválida a partir de estado final.
    const back = await h.request({ method: "PATCH", url: "/api/review-items/" + reviewPastilha, cookie: fiscal, payload: { status: "EM_ANALISE" } });
    expect(back.status).toBe(422);

    const rejected = await h.request({ method: "PATCH", url: "/api/review-items/" + reviewFiltro, cookie: fiscal, payload: { status: "REJEITADO", justification: "Descrição insuficiente; solicitar ao cliente." } });
    expect(rejected.status).toBe(200);
    const after = await h.request({ method: "GET", url: "/api/documents/" + firstDocId, cookie: cliente });
    expect(after.body.items[1].classificationStatus).toBe("REJEITADO");
    expect(after.body.document.status).toBe("COM_PENDENCIAS");
  });

  it("memoriza a classificação homologada em importações futuras do mesmo produto", async () => {
    const response = await importXml(syntheticNfe({ number: "7003", recipientCnpj: company.cnpj, items: [{ ...ITEM_PASTILHA, code: "OUTRO-COD", description: "PASTILHA DE FREIO DIANTEIRA" }] }));
    expect(response.status).toBe(201);
    expect(response.body.pendingCount).toBe(0);
    expect(response.body.document.status).toBe("REVISADA");
    const detail = await h.request({ method: "GET", url: "/api/documents/" + response.body.document.id, cookie: cliente });
    expect(detail.body.items[0]).toMatchObject({ classificationStatus: "HOMOLOGADO", reviewItemId: reviewPastilha });

    const review = await h.request({ method: "GET", url: "/api/review-items/" + reviewPastilha, cookie: fiscal });
    expect(review.body.item.occurrences).toBe(2);
    expect(review.body.occurrences).toHaveLength(2);
  });

  it("reabertura por mudança legislativa encerra a vigência e volta a pendência só para notas posteriores", async () => {
    const reopened = await h.request({ method: "POST", url: "/api/review-items/" + reviewPastilha + "/reopen", cookie: fiscal, payload: { validTo: "2026-11-30", reason: "Alteração de MVA a partir de dezembro" } });
    expect(reopened.status).toBe(201);
    expect(reopened.body.item).toMatchObject({ status: "PENDENTE_REVISAO", fingerprint: expect.stringContaining("87083090|0100100|") });
    const newReviewId = reopened.body.item.id;

    const old = await h.request({ method: "GET", url: "/api/review-items/" + reviewPastilha, cookie: fiscal });
    expect(old.body.item).toMatchObject({ status: "HOMOLOGADO", validTo: "2026-11-30" });
    expect(old.body.history.map((x: { id: string }) => x.id)).toContain(newReviewId);

    // Nota anterior à mudança mantém a homologação.
    const before = await h.request({ method: "GET", url: "/api/documents/" + firstDocId, cookie: cliente });
    expect(before.body.items[0].classificationStatus).toBe("HOMOLOGADO");

    // Nota emitida depois da vigência cai em pendência.
    const dec = await importXml(syntheticNfe({ number: "7004", issuedAt: "2026-12-05T10:00:00-03:00", recipientCnpj: company.cnpj, items: [ITEM_PASTILHA] }));
    expect(dec.status).toBe(201);
    expect(dec.body.pendingCount).toBe(1);
    const detail = await h.request({ method: "GET", url: "/api/documents/" + dec.body.document.id, cookie: cliente });
    expect(detail.body.items[0]).toMatchObject({ classificationStatus: "PENDENTE_REVISAO", reviewItemId: newReviewId });

    expect((await h.request({ method: "POST", url: "/api/review-items/" + reviewPastilha + "/reopen", cookie: fiscal, payload: { validTo: "2026-12-31", reason: "de novo" } })).status).toBe(422);
    expect((await h.request({ method: "PATCH", url: "/api/review-items/" + reviewPastilha, cookie: fiscal, payload: { status: "EM_ANALISE" } })).status).toBe(422);
  });

  it("histórico lista as notas da empresa em ordem decrescente de importação", async () => {
    const history = await h.request({ method: "GET", url: "/api/companies/" + company.id + "/documents?limit=2", cookie: cliente });
    expect(history.body.total).toBe(3);
    expect(history.body.documents).toHaveLength(2);
    expect(history.body.documents[0].number).toBe("7004");
    expect(history.body.documents.every((d: Record<string, unknown>) => !("rawXml" in d))).toBe(true);
  });
});
