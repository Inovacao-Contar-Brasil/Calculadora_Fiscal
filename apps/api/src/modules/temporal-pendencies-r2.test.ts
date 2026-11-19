import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { auditEvents, nfeDocuments, nfeItems, reviewItems } from "../db/schema.ts";
import { createHarness, TEST_PASSWORD, type Harness } from "../test/harness.ts";
import { syntheticCnpj, syntheticNfe, type SyntheticItem } from "../test/fixtures.ts";
import { classificationFor, decisionCovers, isFinalDecision, issueDateOf, selectReviewFor } from "./classification.ts";

/**
 * CF-FOUND-08-R2 — achados da auditoria independente do PR #10 @ d22f3b2.
 *
 * P1: REJEITADO ignorava a vigência — nota de outubro sob rejeição com início em
 * novembro era marcada REJEITADO sem decisão que a cobrisse e sem caminho na fila.
 * P2: o detalhe da pendência truncava as ocorrências em 500 e derivava as lacunas
 * de vigência dessa amostra, omitindo intervalos com notas pendentes.
 * Dados inteiramente sintéticos.
 */
describe("auditoria R2: rejeição fora da vigência e pendências volumosas", () => {
  let h: Harness;
  let companyA: { id: string; cnpj: string };
  let companyB: { id: string; cnpj: string };
  let cliente: string;
  let fiscal: string;

  const product = (code: string, description: string, ncm = "40111000"): SyntheticItem => ({ code, description, ncm, productCents: 1000 });
  const post = (xml: string, target: { id: string }) =>
    h.request({ method: "POST", url: "/api/companies/" + target.id + "/documents", cookie: cliente, headers: { "content-type": "application/xml" }, payload: xml });
  const importNote = async (number: string, issuedAt: string, item: SyntheticItem, target = companyA, lines = 1) => {
    const items = Array.from({ length: lines }, (_, i) => ({ ...item, code: item.code + "-" + i }));
    const response = await post(syntheticNfe({ number, issuedAt, recipientCnpj: target.cnpj, items }), target);
    expect(response.status, response.raw).toBe(201);
    return response.body.document.id as string;
  };
  const itemOf = async (documentId: string) => {
    const detail = await h.request({ method: "GET", url: "/api/documents/" + documentId, cookie: cliente });
    return { item: detail.body.items[0], status: detail.body.document.status };
  };
  const decide = (reviewId: string, payload: Record<string, unknown>) => h.request({ method: "PATCH", url: "/api/review-items/" + reviewId, cookie: fiscal, payload });
  const rejeitar = (reviewId: string, validFrom?: string) =>
    decide(reviewId, { status: "REJEITADO", justification: "Rejeição sintética" + (validFrom ? " a partir de " + validFrom : " sem data"), ...(validFrom ? { validFrom } : {}) });
  const homologar = (reviewId: string, validFrom: string) =>
    decide(reviewId, { status: "HOMOLOGADO", justification: "Homologação sintética.", decision: { enquadramento: "Enquadramento sintético", fundamentoLegal: "Norma Sintética nº 1/2099" }, validFrom });
  const reopen = (reviewId: string, validTo: string) =>
    h.request({ method: "POST", url: "/api/review-items/" + reviewId + "/reopen", cookie: fiscal, payload: { validTo, reason: "Mudança legal sintética" } });
  const pendencies = (companyId = companyA.id) => h.request({ method: "GET", url: "/api/temporal-pendencies?companyId=" + companyId, cookie: fiscal });
  const detail = (id: string, query = "") => h.request({ method: "GET", url: "/api/temporal-pendencies/" + id + query, cookie: fiscal });

  /** Estado persistido coerente com a regra única: vínculo, status e vigências disjuntas. */
  const assertTimelineInvariants = async (companyId: string, description: string) => {
    const timeline = await h.db.select().from(reviewItems).where(and(eq(reviewItems.companyId, companyId), eq(reviewItems.description, description)));
    const open = timeline.filter((r) => r.validTo === null);
    expect(open).toHaveLength(1);
    const finals = timeline.filter(isFinalDecision);
    for (const a of finals) {
      for (const b of finals) {
        if (a.id === b.id) continue;
        const disjoint = (a.validTo !== null && b.validFrom !== null && a.validTo < b.validFrom) || (b.validTo !== null && a.validFrom !== null && b.validTo < a.validFrom);
        expect(disjoint, "vigências sobrepostas").toBe(true);
      }
    }
    const items = await h.db
      .select({ reviewItemId: nfeItems.reviewItemId, status: nfeItems.classificationStatus, issuedAt: nfeDocuments.issuedAt })
      .from(nfeItems)
      .innerJoin(nfeDocuments, eq(nfeDocuments.id, nfeItems.documentId))
      .where(and(eq(nfeItems.companyId, companyId), eq(nfeItems.description, description)));
    for (const item of items) {
      const date = issueDateOf(item.issuedAt);
      const expected = selectReviewFor(open[0]!, timeline, date);
      expect(item.reviewItemId, "vínculo da nota de " + date).toBe(expected.id);
      expect(item.status, "status da nota de " + date).toBe(classificationFor(expected, date));
      // Nenhuma decisão final atribuída fora da própria vigência.
      if (item.status === "HOMOLOGADO" || item.status === "REJEITADO") expect(decisionCovers(expected, date), "decisão fora da vigência em " + date).toBe(true);
    }
  };

  beforeAll(async () => {
    h = await createHarness();
    const org = await h.createOrg("Org Auditoria R2");
    companyA = await h.createCompany(org.id, { cnpj: syntheticCnpj("830000000001"), legalName: "Auditoria R2 A" });
    companyB = await h.createCompany(org.id, { cnpj: syntheticCnpj("830000000002"), legalName: "Auditoria R2 B" });
    const c = await h.createUser({ email: "cliente@r2.local", orgId: org.id, role: "cliente" });
    await h.createUser({ email: "fiscal@r2.local", orgId: org.id, role: "fiscal" });
    await h.grantAccess(companyA.id, c.id);
    await h.grantAccess(companyB.id, c.id);
    cliente = await h.login("cliente@r2.local", TEST_PASSWORD);
    fiscal = await h.login("fiscal@r2.local", TEST_PASSWORD);
  });
  afterAll(() => h?.close());

  it("P1: rejeição a partir de novembro não rejeita a nota de outubro, que fica tratável pelo Fiscal", async () => {
    const item = product("RJ-01", "PNEU SINTETICO REJEICAO VIGENCIA");
    const october = await importNote("2001", "2026-10-10T10:00:00-03:00", item);
    const id = (await itemOf(october)).item.reviewItemId as string;
    expect((await rejeitar(id, "2026-11-01")).status).toBe(200);

    // Outubro: nenhuma decisão cobre a emissão — pendente, não rejeitada.
    expect(await itemOf(october)).toMatchObject({ item: { classificationStatus: "PENDENTE_REVISAO", reviewItemId: id }, status: "COM_PENDENCIAS" });
    // ...e com caminho acionável: pendência temporal identificada pela rejeição.
    const listed = await pendencies();
    expect(listed.body.items).toHaveLength(1);
    expect(listed.body.items[0]).toMatchObject({
      id,
      kind: "FORA_DA_VIGENCIA",
      reasonCode: "EMISSAO_ANTERIOR_A_VIGENCIA",
      decision: { id, status: "REJEITADO", validFrom: "2026-11-01", validTo: null },
      origin: { items: 1, documents: 1, firstIssueDate: "2026-10-10" },
      action: "REGISTRAR_DECISAO_DO_PERIODO",
    });
    expect((await h.request({ method: "GET", url: "/api/review-items/" + id, cookie: fiscal })).body.outOfValidityItems).toBe(1);

    // Novembro: a rejeição vale para o período coberto.
    const november = await importNote("2002", "2026-11-05T10:00:00-03:00", item);
    expect(await itemOf(november)).toMatchObject({ item: { classificationStatus: "REJEITADO", reviewItemId: id } });
    // Setembro importado depois da rejeição: mesma situação de outubro.
    const september = await importNote("2003", "2026-09-15T10:00:00-03:00", item);
    expect(await itemOf(september)).toMatchObject({ item: { classificationStatus: "PENDENTE_REVISAO", reviewItemId: id } });
    expect((await pendencies()).body.items[0].origin).toMatchObject({ items: 2, documents: 2, firstIssueDate: "2026-09-15", lastIssueDate: "2026-10-10" });

    // Cliente acompanha só o status; não lê nem resolve a pendência interna.
    expect((await h.request({ method: "GET", url: "/api/temporal-pendencies/" + id, cookie: cliente })).status).toBe(403);
    expect((await h.request({ method: "POST", url: "/api/temporal-pendencies/" + id + "/resolve", cookie: cliente, payload: { status: "REJEITADO", validFrom: "2026-09-01", justification: "tentativa do cliente" } })).status).toBe(403);

    // Fiscal resolve o período anterior sem tocar na rejeição de novembro.
    const before = (await h.request({ method: "GET", url: "/api/review-items/" + id, cookie: fiscal })).body.item;
    const resolved = await h.request({
      method: "POST",
      url: "/api/temporal-pendencies/" + id + "/resolve",
      cookie: fiscal,
      payload: { status: "HOMOLOGADO", validFrom: "2026-09-01", validTo: "2026-10-31", justification: "Período anterior conferido (sintético).", decision: { enquadramento: "Enquadramento sintético anterior", fundamentoLegal: "Norma Sintética nº 0/2098" } },
    });
    expect(resolved.status, resolved.raw).toBe(201);
    expect((await h.request({ method: "GET", url: "/api/review-items/" + id, cookie: fiscal })).body.item).toEqual(before);
    expect(await itemOf(october)).toMatchObject({ item: { classificationStatus: "HOMOLOGADO", reviewItemId: resolved.body.decision.id } });
    expect(await itemOf(november)).toMatchObject({ item: { classificationStatus: "REJEITADO", reviewItemId: id } });
    const events = await h.db.select().from(auditEvents).where(and(eq(auditEvents.entityType, "temporal_pendency"), eq(auditEvents.entityId, id)));
    expect(events.map((e) => e.action)).toEqual(["TEMPORAL_PENDENCY_RESOLVED"]);
    expect((await pendencies()).body.items).toHaveLength(0);
    await assertTimelineInvariants(companyA.id, item.description);
  });

  it("P1: ordem inversa (rejeição antes da nota antiga) leva ao mesmo estado", async () => {
    const item = product("RJ-02", "CAMARA SINTETICA REJEICAO ORDEM", "40131000");
    const states = async (target: typeof companyA, order: "notas-primeiro" | "rejeicao-primeiro") => {
      const nov = await importNote("2101", "2026-11-05T10:00:00-03:00", item, target);
      const id = (await itemOf(nov)).item.reviewItemId as string;
      if (order === "notas-primeiro") await importNote("2102", "2026-10-10T10:00:00-03:00", item, target);
      expect((await rejeitar(id, "2026-11-01")).status).toBe(200);
      if (order === "rejeicao-primeiro") await importNote("2102", "2026-10-10T10:00:00-03:00", item, target);
      await assertTimelineInvariants(target.id, item.description);
      const rows = await h.db
        .select({ number: nfeDocuments.number, status: nfeItems.classificationStatus })
        .from(nfeItems)
        .innerJoin(nfeDocuments, eq(nfeDocuments.id, nfeItems.documentId))
        .where(and(eq(nfeItems.companyId, target.id), eq(nfeItems.description, item.description)));
      return rows.sort((a, b) => a.number.localeCompare(b.number));
    };
    const a = await states(companyA, "notas-primeiro");
    const b = await states(companyB, "rejeicao-primeiro");
    expect(b).toEqual(a);
    expect(a).toEqual([
      { number: "2101", status: "REJEITADO" },
      { number: "2102", status: "PENDENTE_REVISAO" },
    ]);
  });

  it("P1: rejeição em período fechado vale só na própria vigência, antes e depois da reabertura", async () => {
    const item = product("RJ-03", "RODA SINTETICA REJEICAO FECHADA", "87087090");
    const oct = await importNote("2201", "2026-10-10T10:00:00-03:00", item);
    const nov = await importNote("2202", "2026-11-15T10:00:00-03:00", item);
    const jan = await importNote("2203", "2027-01-10T10:00:00-03:00", item);
    const id = (await itemOf(oct)).item.reviewItemId as string;
    expect((await rejeitar(id, "2026-11-01")).status).toBe(200);
    const reopened = await reopen(id, "2026-12-31");
    expect(reopened.status).toBe(201);
    const newId = reopened.body.item.id as string;
    expect(await itemOf(nov)).toMatchObject({ item: { classificationStatus: "REJEITADO", reviewItemId: id } });
    expect(await itemOf(oct)).toMatchObject({ item: { classificationStatus: "PENDENTE_REVISAO", reviewItemId: newId } });
    expect(await itemOf(jan)).toMatchObject({ item: { classificationStatus: "PENDENTE_REVISAO", reviewItemId: newId } });
    // Importadas depois da reabertura: dentro da rejeição encerrada × fora dela.
    expect(await itemOf(await importNote("2204", "2026-11-20T10:00:00-03:00", item))).toMatchObject({ item: { classificationStatus: "REJEITADO", reviewItemId: id } });
    expect(await itemOf(await importNote("2205", "2026-10-20T10:00:00-03:00", item))).toMatchObject({ item: { classificationStatus: "PENDENTE_REVISAO", reviewItemId: newId } });
    // A nova análise rejeitada a partir de janeiro deixa outubro como pendência temporal dela.
    expect((await rejeitar(newId, "2027-01-01")).status).toBe(200);
    expect(await itemOf(jan)).toMatchObject({ item: { classificationStatus: "REJEITADO", reviewItemId: newId } });
    const pending = await detail(newId);
    expect(pending.status).toBe(200);
    expect(pending.body.uncoveredPeriods).toMatchObject([{ from: null, to: "2026-10-31", items: 2 }]);
    await assertTimelineInvariants(companyA.id, item.description);
  });

  it("P1: rejeição sem data cobre o período em análise (padrão provisório), independentemente da ordem", async () => {
    const item = product("RJ-04", "ARO SINTETICO REJEICAO SEM DATA", "87087010");
    const oct = await importNote("2301", "2026-10-10T10:00:00-03:00", item);
    const id = (await itemOf(oct)).item.reviewItemId as string;
    const rejected = await rejeitar(id);
    expect(rejected.status).toBe(200);
    expect(rejected.body.item).toMatchObject({ status: "REJEITADO", validFrom: null, validTo: null });
    expect(await itemOf(oct)).toMatchObject({ item: { classificationStatus: "REJEITADO" } });
    // Nota mais antiga importada depois: coberta pela vigência registrada (sem início), como se viesse antes.
    expect(await itemOf(await importNote("2302", "2026-08-10T10:00:00-03:00", item))).toMatchObject({ item: { classificationStatus: "REJEITADO", reviewItemId: id } });
    await assertTimelineInvariants(companyA.id, item.description);
  });

  it("P2: pendência com mais de 500 itens em lacunas distintas não omite intervalos e pagina as ocorrências", async () => {
    const item = product("VOL-01", "PARAFUSO SINTETICO VOLUME", "73181500");
    // Linha do tempo: decisão encerrada [mar–abr]; nova análise homologada a partir de julho.
    const base = await importNote("2401", "2026-03-15T10:00:00-03:00", item);
    const first = (await itemOf(base)).item.reviewItemId as string;
    expect((await homologar(first, "2026-03-01")).status).toBe(200);
    const reopened = await reopen(first, "2026-04-30");
    expect(reopened.status).toBe(201);
    const id = reopened.body.item.id as string;
    // 520 itens na lacuna anterior a março (duas NF-e) e 5 na lacuna de maio–junho.
    await importNote("2402", "2026-01-10T10:00:00-03:00", item, companyA, 260);
    await importNote("2403", "2026-01-20T10:00:00-03:00", item, companyA, 260);
    await importNote("2404", "2026-06-10T10:00:00-03:00", item, companyA, 5);
    expect((await homologar(id, "2026-07-01")).status).toBe(200);

    const listed = (await pendencies()).body.items.find((p: { id: string }) => p.id === id);
    expect(listed.origin).toMatchObject({ items: 525, documents: 3, firstIssueDate: "2026-01-10", lastIssueDate: "2026-06-10" });

    const page1 = await detail(id);
    expect(page1.status).toBe(200);
    // Lacunas calculadas sobre TODAS as notas pendentes, não sobre uma amostra.
    expect(page1.body.uncoveredPeriods).toEqual([
      { from: null, to: "2026-02-28", items: 520, firstIssueDate: "2026-01-10", lastIssueDate: "2026-01-20" },
      { from: "2026-05-01", to: "2026-06-30", items: 5, firstIssueDate: "2026-06-10", lastIssueDate: "2026-06-10" },
    ]);
    expect(page1.body.page).toEqual({ limit: 100, offset: 0, total: 525, hasMore: true });
    expect(page1.body.occurrences).toHaveLength(100);

    // Percorrer todas as páginas devolve cada item exatamente uma vez.
    const seen = new Set<string>();
    for (let offset = 0; offset < 525; offset += 200) {
      const page = await detail(id, "?limit=200&offset=" + offset);
      expect(page.body.page).toMatchObject({ limit: 200, offset, total: 525, hasMore: offset + 200 < 525 });
      for (const o of page.body.occurrences) seen.add(o.nfeItemId);
    }
    expect(seen.size).toBe(525);
    const last = await detail(id, "?limit=500&offset=500");
    expect(last.body.occurrences.map((o: { issuedAt: string }) => o.issuedAt.slice(0, 10))).toEqual(Array(25).fill("2026-01-20").slice(0, 20).concat(Array(5).fill("2026-06-10")));
    expect((await detail(id, "?limit=501")).status).toBe(400);

    // Resolver a lacuna menor não afeta a maior; a contagem continua completa.
    const resolved = await h.request({
      method: "POST",
      url: "/api/temporal-pendencies/" + id + "/resolve",
      cookie: fiscal,
      payload: { status: "REJEITADO", validFrom: "2026-05-01", justification: "Lacuna de maio–junho rejeitada (sintético)." },
    });
    expect(resolved.status, resolved.raw).toBe(201);
    expect(resolved.body.decision).toMatchObject({ validFrom: "2026-05-01", validTo: "2026-06-30" });
    const after = await detail(id);
    expect(after.body.uncoveredPeriods).toEqual([{ from: null, to: "2026-02-28", items: 520, firstIssueDate: "2026-01-10", lastIssueDate: "2026-01-20" }]);
    expect(after.body.page.total).toBe(520);
    await assertTimelineInvariants(companyA.id, item.description);
  }, 120_000);
});
