import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { auditEvents } from "../db/schema.ts";
import { createHarness, TEST_PASSWORD, type Harness } from "../test/harness.ts";
import { ITEM_PASTILHA, syntheticCnpj, syntheticNfe } from "../test/fixtures.ts";

/**
 * Consistência entre o item de revisão e os itens de NF-e (Issue #5, item 6):
 * o mesmo produto não pode ficar com status contraditórios conforme a ordem de
 * importação, e homologação respeita vigência tanto na importação quanto na
 * propagação. Também cobre decisões concorrentes.
 */
describe("consistência e concorrência da revisão fiscal", () => {
  let h: Harness;
  let company: { id: string; cnpj: string };
  let cliente: string;
  let fiscal: string;
  let fiscal2: string;

  const importNote = async (number: string, issuedAt: string, item = ITEM_PASTILHA) => {
    const response = await h.request({
      method: "POST",
      url: "/api/companies/" + company.id + "/documents",
      cookie: cliente,
      headers: { "content-type": "application/xml" },
      payload: syntheticNfe({ number, issuedAt, recipientCnpj: company.cnpj, items: [item] }),
    });
    expect(response.status).toBe(201);
    return response.body.document.id as string;
  };
  const itemOf = async (documentId: string) => {
    const detail = await h.request({ method: "GET", url: "/api/documents/" + documentId, cookie: cliente });
    return { item: detail.body.items[0], status: detail.body.document.status };
  };

  beforeAll(async () => {
    h = await createHarness();
    const org = await h.createOrg("Org Consistencia");
    company = await h.createCompany(org.id, { cnpj: syntheticCnpj("710000000001"), legalName: "Consistência Sintética" });
    const c = await h.createUser({ email: "cliente@c.local", orgId: org.id, role: "cliente" });
    await h.createUser({ email: "fiscal@c.local", orgId: org.id, role: "fiscal" });
    await h.createUser({ email: "fiscal2@c.local", orgId: org.id, role: "fiscal" });
    await h.grantAccess(company.id, c.id);
    cliente = await h.login("cliente@c.local", TEST_PASSWORD);
    fiscal = await h.login("fiscal@c.local", TEST_PASSWORD);
    fiscal2 = await h.login("fiscal2@c.local", TEST_PASSWORD);
  });
  afterAll(() => h?.close());

  it("EM_ANALISE e volta a PENDENTE valem para todos os itens do produto, de notas antigas e novas", async () => {
    const outubro = await importNote("8001", "2026-10-05T10:00:00-03:00");
    const reviewId = (await itemOf(outubro)).item.reviewItemId;

    expect((await h.request({ method: "PATCH", url: "/api/review-items/" + reviewId, cookie: fiscal, payload: { status: "EM_ANALISE" } })).status).toBe(200);
    const novembro = await importNote("8002", "2026-11-05T10:00:00-03:00");
    expect((await itemOf(outubro)).item.classificationStatus).toBe("EM_ANALISE");
    expect((await itemOf(novembro)).item.classificationStatus).toBe("EM_ANALISE");

    expect((await h.request({ method: "PATCH", url: "/api/review-items/" + reviewId, cookie: fiscal, payload: { status: "PENDENTE_REVISAO" } })).status).toBe(200);
    expect((await itemOf(outubro)).item.classificationStatus).toBe("PENDENTE_REVISAO");
    expect((await itemOf(novembro)).item.classificationStatus).toBe("PENDENTE_REVISAO");
  });

  it("homologação com início posterior não homologa notas anteriores — nem na propagação, nem na importação", async () => {
    const reviewId = (await itemOf(await importNote("8003", "2026-11-20T10:00:00-03:00"))).item.reviewItemId;
    const ok = await h.request({
      method: "PATCH",
      url: "/api/review-items/" + reviewId,
      cookie: fiscal,
      payload: {
        status: "HOMOLOGADO",
        justification: "Classificação conferida a partir de novembro (dados sintéticos).",
        decision: { enquadramento: "Enquadramento sintético", fundamentoLegal: "Fundamento sintético de teste" },
        validFrom: "2026-11-01",
      },
    });
    expect(ok.status).toBe(200);

    const docs = await h.request({ method: "GET", url: "/api/companies/" + company.id + "/documents", cookie: cliente });
    const byNumber = Object.fromEntries(docs.body.documents.map((d: { number: string; id: string }) => [d.number, d.id]));
    // Outubro: fora da vigência, continua pendente e o documento com pendência.
    expect(await itemOf(byNumber["8001"])).toMatchObject({ item: { classificationStatus: "PENDENTE_REVISAO" }, status: "COM_PENDENCIAS" });
    // Novembro: dentro da vigência.
    expect(await itemOf(byNumber["8002"])).toMatchObject({ item: { classificationStatus: "HOMOLOGADO" }, status: "REVISADA" });
    expect(await itemOf(byNumber["8003"])).toMatchObject({ item: { classificationStatus: "HOMOLOGADO" }, status: "REVISADA" });

    // Importação posterior de nota de setembro segue a mesma regra.
    const setembro = await importNote("8004", "2026-09-15T10:00:00-03:00");
    expect(await itemOf(setembro)).toMatchObject({ item: { classificationStatus: "PENDENTE_REVISAO", reviewItemId: reviewId }, status: "COM_PENDENCIAS" });
  });

  it("decisões concorrentes sobre o mesmo item: exatamente uma vence e só ela é auditada", async () => {
    const other = { ...ITEM_PASTILHA, code: "CONC-1", description: "PRODUTO SINTETICO CONCORRENCIA", ncm: "84212300", cest: undefined };
    const reviewId = (await itemOf(await importNote("8101", "2026-11-10T10:00:00-03:00", other))).item.reviewItemId;
    const homologar = {
      status: "HOMOLOGADO",
      justification: "Decisão A (sintética).",
      decision: { enquadramento: "Enquadramento A", fundamentoLegal: "Fundamento A" },
      validFrom: "2026-01-01",
    };
    const rejeitar = { status: "REJEITADO", justification: "Decisão B (sintética)." };
    const results = await Promise.all([
      h.request({ method: "PATCH", url: "/api/review-items/" + reviewId, cookie: fiscal, payload: homologar }),
      h.request({ method: "PATCH", url: "/api/review-items/" + reviewId, cookie: fiscal2, payload: rejeitar }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses[0]).toBe(200);
    expect([409, 422]).toContain(statuses[1]);

    const decisions = await h.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, reviewId), eq(auditEvents.entityType, "review_item")));
    expect(decisions.filter((e) => e.action === "REVIEW_HOMOLOGADO" || e.action === "REVIEW_REJEITADO")).toHaveLength(1);

    // Reabrir duas vezes em paralelo: só uma nova versão é criada.
    const reopen = await Promise.all([
      h.request({ method: "POST", url: "/api/review-items/" + reviewId + "/reopen", cookie: fiscal, payload: { validTo: "2026-12-31", reason: "Mudança legal sintética A" } }),
      h.request({ method: "POST", url: "/api/review-items/" + reviewId + "/reopen", cookie: fiscal2, payload: { validTo: "2026-12-31", reason: "Mudança legal sintética B" } }),
    ]);
    const reopenStatuses = reopen.map((r) => r.status).sort();
    expect(reopenStatuses[0]).toBe(201);
    expect([409, 422]).toContain(reopenStatuses[1]);
  });
});
