import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNotNull } from "drizzle-orm";
import { auditEvents, nfeDocuments, nfeItems, reviewItems } from "../db/schema.ts";
import { createHarness, TEST_PASSWORD, type Harness } from "../test/harness.ts";
import { syntheticCnpj, syntheticNfe, type SyntheticItem } from "../test/fixtures.ts";
import { classificationFor, decisionCovers, isFinalDecision, issueDateOf, selectReviewFor } from "./classification.ts";

/**
 * Issue #8 — CF-FOUND-08-TEMPORAL. Uma NF-e emitida fora da vigência de uma
 * classificação homologada fica PENDENTE_REVISAO (correto), mas precisa de um
 * fluxo administrativo tratável pelo Fiscal sem alterar retroativamente a
 * decisão válida. Também cobre: ordem de importação, reabertura, reimportação
 * e operações concorrentes. Todos os dados são sintéticos.
 */
describe("pendência temporal: NF-e fora da vigência de classificação homologada", () => {
  let h: Harness;
  let company: { id: string; cnpj: string };
  let companyB: { id: string; cnpj: string };
  let cliente: string;
  let fiscal: string;
  let fiscal2: string;

  const product = (code: string, description: string, ncm = "40111000"): SyntheticItem => ({ code, description, ncm, productCents: 9900 });
  const PNEU = product("PN-01", "PNEU SINTETICO ARO 15");

  const xmlOf = (number: string, issuedAt: string, item: SyntheticItem, target = company) =>
    syntheticNfe({ number, issuedAt, recipientCnpj: target.cnpj, items: [item] });
  const post = (xml: string, target = company) =>
    h.request({ method: "POST", url: "/api/companies/" + target.id + "/documents", cookie: cliente, headers: { "content-type": "application/xml" }, payload: xml });
  const importNote = async (number: string, issuedAt: string, item: SyntheticItem, target = company) => {
    const response = await post(xmlOf(number, issuedAt, item, target), target);
    expect(response.status, response.raw).toBe(201);
    return response.body.document.id as string;
  };
  const itemOf = async (documentId: string) => {
    const detail = await h.request({ method: "GET", url: "/api/documents/" + documentId, cookie: cliente });
    return { item: detail.body.items[0], status: detail.body.document.status };
  };
  const decide = (reviewId: string, payload: Record<string, unknown>, cookie = fiscal) =>
    h.request({ method: "PATCH", url: "/api/review-items/" + reviewId, cookie, payload });
  const homologar = (reviewId: string, validFrom: string, cookie = fiscal) =>
    decide(reviewId, {
      status: "HOMOLOGADO",
      justification: "Classificação conferida a partir de " + validFrom + " (dados sintéticos).",
      decision: { enquadramento: "Enquadramento sintético vigente", fundamentoLegal: "Norma Sintética nº 1/2099, art. 1º" },
      validFrom,
    }, cookie);
  const pendencies = (companyId = company.id, cookie = fiscal) =>
    h.request({ method: "GET", url: "/api/temporal-pendencies?companyId=" + companyId, cookie });
  const resolve = (pendencyId: string, payload: Record<string, unknown>, cookie = fiscal) =>
    h.request({ method: "POST", url: "/api/temporal-pendencies/" + pendencyId + "/resolve", cookie, payload });
  const periodDecision = (validFrom: string, validTo: string) => ({
    status: "HOMOLOGADO",
    validFrom,
    validTo,
    decision: { enquadramento: "Enquadramento sintético do período anterior", fundamentoLegal: "Norma Sintética nº 0/2098, art. 9º" },
    justification: "Notas anteriores à vigência conferidas pelo Fiscal com a norma do período (dados sintéticos).",
  });

  /** Estado persistido de cada item do produto: decisão vinculada e status. */
  const linkage = async (companyId: string, description: string) => {
    const rows = await h.db
      .select({ number: nfeDocuments.number, issuedAt: nfeDocuments.issuedAt, status: nfeItems.classificationStatus, reviewItemId: nfeItems.reviewItemId, reviewValidTo: reviewItems.validTo })
      .from(nfeItems)
      .innerJoin(nfeDocuments, eq(nfeDocuments.id, nfeItems.documentId))
      .innerJoin(reviewItems, eq(reviewItems.id, nfeItems.reviewItemId))
      .where(and(eq(nfeItems.companyId, companyId), eq(nfeItems.description, description)));
    return rows.sort((a, b) => a.issuedAt.localeCompare(b.issuedAt));
  };

  /**
   * Invariantes da linha do tempo, conferidos no estado persistido: vigências de
   * decisões finais disjuntas; exatamente um item aberto; cada nota vinculada à
   * decisão que a regra única escolheria e com o status que ela determina.
   */
  const assertTimelineInvariants = async (companyId: string, description: string) => {
    const timeline = await h.db.select().from(reviewItems).where(and(eq(reviewItems.companyId, companyId), eq(reviewItems.description, description)));
    const open = timeline.filter((r) => r.validTo === null);
    expect(open).toHaveLength(1);
    const finals = timeline.filter(isFinalDecision);
    for (const a of finals) {
      for (const b of finals) {
        if (a.id === b.id) continue;
        const disjoint = (a.validTo !== null && b.validFrom !== null && a.validTo < b.validFrom) || (b.validTo !== null && a.validFrom !== null && b.validTo < a.validFrom);
        expect(disjoint, "vigências sobrepostas: " + a.id + " × " + b.id).toBe(true);
      }
    }
    const items = await h.db
      .select({ id: nfeItems.id, reviewItemId: nfeItems.reviewItemId, status: nfeItems.classificationStatus, issuedAt: nfeDocuments.issuedAt })
      .from(nfeItems)
      .innerJoin(nfeDocuments, eq(nfeDocuments.id, nfeItems.documentId))
      .where(and(eq(nfeItems.companyId, companyId), eq(nfeItems.description, description)));
    for (const item of items) {
      const date = issueDateOf(item.issuedAt);
      const expected = selectReviewFor(open[0]!, timeline, date);
      expect(item.reviewItemId, "vínculo da nota de " + date).toBe(expected.id);
      expect(item.status, "status da nota de " + date).toBe(classificationFor(expected, date));
      // Nenhuma nota pendente presa a decisão encerrada que não a cobre (órfã invisível).
      const linked = timeline.find((r) => r.id === item.reviewItemId)!;
      if (linked.validTo !== null) expect(decisionCovers(linked, date)).toBe(true);
    }
    return { timeline, items };
  };

  beforeAll(async () => {
    h = await createHarness();
    const org = await h.createOrg("Org Temporal");
    company = await h.createCompany(org.id, { cnpj: syntheticCnpj("810000000001"), legalName: "Temporal Sintética A" });
    companyB = await h.createCompany(org.id, { cnpj: syntheticCnpj("810000000002"), legalName: "Temporal Sintética B" });
    const c = await h.createUser({ email: "cliente@t.local", orgId: org.id, role: "cliente" });
    await h.createUser({ email: "fiscal@t.local", orgId: org.id, role: "fiscal" });
    await h.createUser({ email: "fiscal2@t.local", orgId: org.id, role: "fiscal" });
    await h.grantAccess(company.id, c.id);
    await h.grantAccess(companyB.id, c.id);
    cliente = await h.login("cliente@t.local", TEST_PASSWORD);
    fiscal = await h.login("fiscal@t.local", TEST_PASSWORD);
    fiscal2 = await h.login("fiscal2@t.local", TEST_PASSWORD);
  });
  afterAll(() => h?.close());

  let reviewId: string;
  let octoberDoc: string;
  let septemberDoc: string;
  let novemberDoc: string;

  it("reproduz a Issue #8: nota de outubro segue pendente e passa a ter pendência temporal acionável", async () => {
    // 1. Importar NF-e de outubro com produto novo.
    octoberDoc = await importNote("9001", "2026-10-10T10:00:00-03:00", PNEU);
    reviewId = (await itemOf(octoberDoc)).item.reviewItemId;
    // 2. Homologar com início de vigência em novembro.
    expect((await homologar(reviewId, "2026-11-01")).status).toBe(200);
    // 3. A nota de outubro continua pendente: a homologação não a cobre.
    expect(await itemOf(octoberDoc)).toMatchObject({ item: { classificationStatus: "PENDENTE_REVISAO" }, status: "COM_PENDENCIAS" });
    // 4. A fila de decisões não tem ação para ela (o item vigente está HOMOLOGADO)...
    const queue = await h.request({ method: "GET", url: "/api/review-items?companyId=" + company.id + "&status=PENDENTE_REVISAO", cookie: fiscal });
    expect(queue.body.items.map((i: { id: string }) => i.id)).not.toContain(reviewId);
    // ...mas existe uma pendência temporal com identidade, motivo, empresa, origem e ação.
    const listed = await pendencies();
    expect(listed.status).toBe(200);
    expect(listed.body.items).toHaveLength(1);
    expect(listed.body.items[0]).toMatchObject({
      id: reviewId,
      kind: "FORA_DA_VIGENCIA",
      reasonCode: "EMISSAO_ANTERIOR_A_VIGENCIA",
      companyId: company.id,
      companyName: "Temporal Sintética A",
      product: { description: PNEU.description, ncm: PNEU.ncm },
      decision: { id: reviewId, status: "HOMOLOGADO", validFrom: "2026-11-01", validTo: null },
      origin: { documents: 1, items: 1, firstIssueDate: "2026-10-10", lastIssueDate: "2026-10-10" },
      action: "REGISTRAR_DECISAO_DO_PERIODO",
    });
    expect(listed.body.items[0].reason).toMatch(/antes do início da vigência/);

    // 5. Outra NF-e anterior à homologação: mesma pendência, sem duplicar.
    septemberDoc = await importNote("9002", "2026-09-15T10:00:00-03:00", PNEU);
    expect(await itemOf(septemberDoc)).toMatchObject({ item: { classificationStatus: "PENDENTE_REVISAO", reviewItemId: reviewId }, status: "COM_PENDENCIAS" });
    const again = await pendencies();
    expect(again.body.items).toHaveLength(1);
    expect(again.body.items[0].origin).toMatchObject({ documents: 2, items: 2, firstIssueDate: "2026-09-15", lastIssueDate: "2026-10-10" });

    // Reimportar a mesma NF-e não duplica a pendência.
    const duplicate = await post(xmlOf("9001", "2026-10-10T10:00:00-03:00", PNEU));
    expect(duplicate.status).toBe(200);
    expect((await pendencies()).body.items[0].origin).toMatchObject({ documents: 2, items: 2 });

    const detail = await h.request({ method: "GET", url: "/api/temporal-pendencies/" + reviewId, cookie: fiscal });
    expect(detail.status).toBe(200);
    expect(detail.body.occurrences.map((o: { documentId: string }) => o.documentId).sort()).toEqual([octoberDoc, septemberDoc].sort());
    expect(detail.body.uncoveredPeriods).toEqual([{ from: null, to: "2026-10-31", items: 2, firstIssueDate: "2026-09-15", lastIssueDate: "2026-10-10" }]);
    expect(detail.body.page).toEqual({ limit: 100, offset: 0, total: 2, hasMore: false });
  });

  it("nota dentro da vigência é homologada e não entra na pendência", async () => {
    novemberDoc = await importNote("9003", "2026-11-05T10:00:00-03:00", PNEU);
    expect(await itemOf(novemberDoc)).toMatchObject({ item: { classificationStatus: "HOMOLOGADO", reviewItemId: reviewId }, status: "REVISADA" });
    expect((await pendencies()).body.items[0].origin).toMatchObject({ documents: 2, items: 2 });
  });

  it("validações da decisão do período: sobreposição, período sem notas, datas e conteúdo obrigatório", async () => {
    // Não pode invadir a vigência da decisão homologada.
    expect((await resolve(reviewId, periodDecision("2026-09-01", "2026-11-01"))).status).toBe(422);
    expect((await resolve(reviewId, periodDecision("2026-11-02", "2026-11-30"))).status).toBe(422);
    // Período sem notas pendentes não é ação desta pendência.
    expect((await resolve(reviewId, periodDecision("2026-07-01", "2026-07-31"))).status).toBe(422);
    // Datas invertidas.
    expect((await resolve(reviewId, periodDecision("2026-10-31", "2026-09-01"))).status).toBe(422);
    // Homologar exige decisão; rejeitar exige justificativa.
    expect((await resolve(reviewId, { status: "HOMOLOGADO", validFrom: "2026-09-01", justification: "sem decisão" })).status).toBe(400);
    expect((await resolve(reviewId, { status: "REJEITADO", validFrom: "2026-09-01" })).status).toBe(400);
    // Nada foi gravado.
    const closed = await h.db.select().from(reviewItems).where(and(eq(reviewItems.companyId, company.id), isNotNull(reviewItems.validTo)));
    expect(closed).toHaveLength(0);
  });

  it("Fiscal resolve com decisão do período, sem alterar a homologação vigente e com auditoria", async () => {
    const before = (await h.request({ method: "GET", url: "/api/review-items/" + reviewId, cookie: fiscal })).body.item;
    const resolved = await resolve(reviewId, periodDecision("2026-09-01", "2026-10-31"));
    expect(resolved.status, resolved.raw).toBe(201);
    const periodId = resolved.body.decision.id as string;
    expect(periodId).not.toBe(reviewId);
    expect(resolved.body.decision).toMatchObject({ status: "HOMOLOGADO", validFrom: "2026-09-01", validTo: "2026-10-31", occurrences: 2 });
    expect(resolved.body.pendency).toBeNull();

    // A homologação de novembro não sofreu nenhum efeito retroativo.
    const after = await h.request({ method: "GET", url: "/api/review-items/" + reviewId, cookie: fiscal });
    expect(after.body.item).toEqual(before);
    expect(after.body.history.map((x: { id: string }) => x.id)).toContain(periodId);

    // Notas do período passam a seguir a decisão do período; novembro segue a sua.
    for (const doc of [octoberDoc, septemberDoc]) {
      expect(await itemOf(doc)).toMatchObject({ item: { classificationStatus: "HOMOLOGADO", reviewItemId: periodId }, status: "REVISADA" });
    }
    expect(await itemOf(novemberDoc)).toMatchObject({ item: { classificationStatus: "HOMOLOGADO", reviewItemId: reviewId } });
    expect((await pendencies()).body.items).toHaveLength(0);
    expect((await h.request({ method: "GET", url: "/api/temporal-pendencies/" + reviewId, cookie: fiscal })).status).toBe(404);

    const events = await h.db.select().from(auditEvents).where(and(eq(auditEvents.entityType, "temporal_pendency"), eq(auditEvents.entityId, reviewId)));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: "TEMPORAL_PENDENCY_RESOLVED", companyId: company.id });
    expect(events[0]!.actorUserId).toBeTruthy();
    expect(events[0]!.metadata).toMatchObject({ decisionId: periodId, status: "HOMOLOGADO", validFrom: "2026-09-01", validTo: "2026-10-31", items: 2 });

    // Nova nota do período resolvido segue a decisão do período (memória dentro da vigência).
    const lateOctober = await importNote("9004", "2026-10-20T10:00:00-03:00", PNEU);
    expect(await itemOf(lateOctober)).toMatchObject({ item: { classificationStatus: "HOMOLOGADO", reviewItemId: periodId } });
    // Nota anterior a tudo não é homologada automaticamente: nova pendência.
    const august = await importNote("9005", "2026-08-10T10:00:00-03:00", PNEU);
    expect(await itemOf(august)).toMatchObject({ item: { classificationStatus: "PENDENTE_REVISAO", reviewItemId: reviewId } });
    const reopened = await pendencies();
    expect(reopened.body.items).toHaveLength(1);
    expect(reopened.body.items[0]).toMatchObject({ id: reviewId, origin: { items: 1, firstIssueDate: "2026-08-10" } });
    const detail = await h.request({ method: "GET", url: "/api/temporal-pendencies/" + reviewId, cookie: fiscal });
    expect(detail.body.uncoveredPeriods).toEqual([{ from: null, to: "2026-08-31", items: 1, firstIssueDate: "2026-08-10", lastIssueDate: "2026-08-10" }]);

    // Sobrepor a decisão do período é conflito; rejeitar o período também é uma resolução válida.
    expect((await resolve(reviewId, periodDecision("2026-08-01", "2026-09-10"))).status).toBe(409);
    const rejected = await resolve(reviewId, { status: "REJEITADO", validFrom: "2026-08-01", validTo: "2026-08-31", justification: "Sem fundamento para agosto; solicitar documentação (sintético)." });
    expect(rejected.status, rejected.raw).toBe(201);
    expect(await itemOf(august)).toMatchObject({ item: { classificationStatus: "REJEITADO" }, status: "COM_PENDENCIAS" });
    expect((await pendencies()).body.items).toHaveLength(0);
    await assertTimelineInvariants(company.id, PNEU.description);
  });

  it("duas resoluções simultâneas da mesma pendência: exatamente uma vence e só ela é auditada", async () => {
    const item = product("CC-01", "CAMARA DE AR SINTETICA CONCORRENTE", "40131000");
    const doc = await importNote("9101", "2026-10-03T10:00:00-03:00", item);
    const id = (await itemOf(doc)).item.reviewItemId as string;
    expect((await homologar(id, "2026-11-01")).status).toBe(200);
    // Várias requisições para abrir de fato a janela de corrida no PostgreSQL real. O pool
    // é aquecido antes: sem isso, as conexões novas atrasam as requisições seguintes e a
    // primeira termina sozinha (corrida não exercitada — verificado removendo o lock).
    await Promise.all(Array.from({ length: 8 }, () => pendencies()));
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, index) => resolve(id, periodDecision("2026-10-01", "2026-10-31"), index % 2 ? fiscal2 : fiscal)),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409, 409]);
    const events = await h.db.select().from(auditEvents).where(and(eq(auditEvents.entityType, "temporal_pendency"), eq(auditEvents.entityId, id)));
    expect(events).toHaveLength(1);
    const periodRows = await h.db.select().from(reviewItems).where(and(eq(reviewItems.companyId, company.id), eq(reviewItems.description, item.description), isNotNull(reviewItems.validTo)));
    expect(periodRows).toHaveLength(1);
    expect(await itemOf(doc)).toMatchObject({ item: { classificationStatus: "HOMOLOGADO", reviewItemId: periodRows[0]!.id } });
    await assertTimelineInvariants(company.id, item.description);
  });

  it("resolução concorrente com importação de nota do mesmo período converge para o mesmo estado", async () => {
    const item = product("CC-02", "VALVULA SINTETICA CONCORRENTE", "84818099");
    const first = await importNote("9201", "2026-10-03T10:00:00-03:00", item);
    const id = (await itemOf(first)).item.reviewItemId as string;
    expect((await homologar(id, "2026-11-01")).status).toBe(200);
    const [resolved, imported] = await Promise.all([resolve(id, periodDecision("2026-10-01", "2026-10-31")), post(xmlOf("9202", "2026-10-25T10:00:00-03:00", item))]);
    expect(resolved.status).toBe(201);
    expect(imported.status).toBe(201);
    const rows = await linkage(company.id, item.description);
    expect(rows.map((r) => [r.number, r.status, r.reviewItemId])).toEqual([
      ["9201", "HOMOLOGADO", resolved.body.decision.id],
      ["9202", "HOMOLOGADO", resolved.body.decision.id],
    ]);
    await assertTimelineInvariants(company.id, item.description);
  });

  it("reabertura e resolução simultâneas sobre a mesma decisão: estado final coerente, sem órfãs", async () => {
    const item = product("CC-03", "BICO SINTETICO CONCORRENTE", "84818092");
    const oct = await importNote("9251", "2026-10-03T10:00:00-03:00", item);
    await importNote("9252", "2026-11-10T10:00:00-03:00", item);
    const id = (await itemOf(oct)).item.reviewItemId as string;
    expect((await homologar(id, "2026-11-01")).status).toBe(200);
    await Promise.all(Array.from({ length: 4 }, () => pendencies()));
    const [resolved, reopened] = await Promise.all([
      resolve(id, periodDecision("2026-10-01", "2026-10-31")),
      h.request({ method: "POST", url: "/api/review-items/" + id + "/reopen", cookie: fiscal2, payload: { validTo: "2026-12-31", reason: "Mudança legal sintética simultânea" } }),
    ]);
    expect(reopened.status).toBe(201);
    // A resolução vence se chegou antes; se a reabertura venceu, a nota de outubro já está na nova análise.
    expect([201, 409]).toContain(resolved.status);
    const after = await itemOf(oct);
    if (resolved.status === 201) expect(after.item).toMatchObject({ classificationStatus: "HOMOLOGADO", reviewItemId: resolved.body.decision.id });
    else expect(after.item).toMatchObject({ classificationStatus: "PENDENTE_REVISAO", reviewItemId: reopened.body.item.id });
    await assertTimelineInvariants(company.id, item.description);
  });

  it("nota posterior ao encerramento vai para a nova análise; reabertura não deixa notas órfãs", async () => {
    const item = product("RO-01", "RODA SINTETICA REABERTURA", "87087090");
    const oct = await importNote("9301", "2026-10-10T10:00:00-03:00", item);
    const nov = await importNote("9302", "2026-11-15T10:00:00-03:00", item);
    const jan = await importNote("9303", "2027-01-10T10:00:00-03:00", item);
    const id = (await itemOf(oct)).item.reviewItemId as string;
    expect((await homologar(id, "2026-11-01")).status).toBe(200);

    const reopened = await h.request({ method: "POST", url: "/api/review-items/" + id + "/reopen", cookie: fiscal, payload: { validTo: "2026-12-31", reason: "Mudança legal sintética" } });
    expect(reopened.status).toBe(201);
    const newId = reopened.body.item.id as string;
    // Posterior ao encerramento: pendente na nova análise.
    expect(await itemOf(jan)).toMatchObject({ item: { classificationStatus: "PENDENTE_REVISAO", reviewItemId: newId } });
    // Anterior à vigência: também vai para a nova análise (antes ficava órfã na decisão encerrada).
    expect(await itemOf(oct)).toMatchObject({ item: { classificationStatus: "PENDENTE_REVISAO", reviewItemId: newId } });
    // Dentro da vigência encerrada: decisão histórica preservada.
    expect(await itemOf(nov)).toMatchObject({ item: { classificationStatus: "HOMOLOGADO", reviewItemId: id } });
    const old = await h.request({ method: "GET", url: "/api/review-items/" + id, cookie: fiscal });
    expect(old.body.item).toMatchObject({ status: "HOMOLOGADO", validFrom: "2026-11-01", validTo: "2026-12-31" });
    const queue = await h.request({ method: "GET", url: "/api/review-items?companyId=" + company.id + "&status=PENDENTE_REVISAO", cookie: fiscal });
    expect(queue.body.items.map((i: { id: string }) => i.id)).toContain(newId);

    // Nota importada depois da reabertura, mas emitida na vigência encerrada, segue a decisão histórica.
    const lateNov = await importNote("9304", "2026-11-20T10:00:00-03:00", item);
    expect(await itemOf(lateNov)).toMatchObject({ item: { classificationStatus: "HOMOLOGADO", reviewItemId: id }, status: "REVISADA" });

    // A nova decisão não pode se sobrepor à vigência encerrada.
    expect((await homologar(newId, "2026-12-15")).status).toBe(422);
    expect((await homologar(newId, "2027-02-01")).status).toBe(200);
    expect(await itemOf(jan)).toMatchObject({ item: { classificationStatus: "PENDENTE_REVISAO", reviewItemId: newId } });
    const detail = await h.request({ method: "GET", url: "/api/temporal-pendencies/" + newId, cookie: fiscal });
    expect(detail.status).toBe(200);
    expect(detail.body.uncoveredPeriods).toEqual([
      { from: null, to: "2026-10-31", items: 1, firstIssueDate: "2026-10-10", lastIssueDate: "2026-10-10" },
      { from: "2027-01-01", to: "2027-01-31", items: 1, firstIssueDate: "2027-01-10", lastIssueDate: "2027-01-10" },
    ]);
    // A decisão do período precisa caber numa lacuna, sem invadir a vigência encerrada.
    expect((await resolve(newId, periodDecision("2026-12-01", "2027-01-31"))).status).toBe(409);
    expect((await resolve(newId, periodDecision("2027-01-01", "2027-01-31"))).status).toBe(201);
    expect(await itemOf(jan)).toMatchObject({ item: { classificationStatus: "HOMOLOGADO" } });
    expect(await itemOf(oct)).toMatchObject({ item: { classificationStatus: "PENDENTE_REVISAO", reviewItemId: newId } });
    await assertTimelineInvariants(company.id, item.description);
  });

  it("decisão sem data de início depois de reabertura com fim futuro começa no dia seguinte ao fim", async () => {
    const item = product("RO-03", "PARAFUSO SINTETICO VIGENCIA FUTURA", "73181500");
    const doc = await importNote("9451", "2026-10-10T10:00:00-03:00", item);
    const id = (await itemOf(doc)).item.reviewItemId as string;
    expect((await homologar(id, "2026-01-01")).status).toBe(200);
    const reopened = await h.request({ method: "POST", url: "/api/review-items/" + id + "/reopen", cookie: fiscal, payload: { validTo: "2099-12-30", reason: "Encerramento futuro sintético" } });
    expect(reopened.status).toBe(201);
    const rejected = await decide(reopened.body.item.id, { status: "REJEITADO", justification: "Rejeição sintética sem data de início." });
    expect(rejected.status).toBe(200);
    expect(rejected.body.item).toMatchObject({ status: "REJEITADO", validFrom: "2099-12-31" });
    await assertTimelineInvariants(company.id, item.description);
  });

  it("reabrir exige uma decisão final: item pendente não tem vigência a encerrar", async () => {
    const item = product("RO-02", "ARO SINTETICO PENDENTE", "87087010");
    const doc = await importNote("9401", "2026-10-10T10:00:00-03:00", item);
    const id = (await itemOf(doc)).item.reviewItemId as string;
    const response = await h.request({ method: "POST", url: "/api/review-items/" + id + "/reopen", cookie: fiscal, payload: { validTo: "2026-12-31", reason: "tentativa sintética" } });
    expect(response.status).toBe(422);
  });

  it("a ordem de importação não altera a conclusão fiscal", async () => {
    const item = product("OR-01", "CALOTA SINTETICA ORDEM", "87089990");
    const notes = { out: ["9501", "2026-10-10T10:00:00-03:00"], nov: ["9502", "2026-11-15T10:00:00-03:00"], jan: ["9503", "2027-01-10T10:00:00-03:00"] } as const;
    const sequence = async (target: typeof company, before: (keyof typeof notes)[], after: (keyof typeof notes)[]) => {
      const ids: Record<string, string> = {};
      for (const key of before) ids[key] = await importNote(notes[key][0], notes[key][1], item, target);
      const id = (await itemOf(ids[before[0]!]!)).item.reviewItemId as string;
      expect((await homologar(id, "2026-11-01")).status).toBe(200);
      expect((await h.request({ method: "POST", url: "/api/review-items/" + id + "/reopen", cookie: fiscal, payload: { validTo: "2026-12-31", reason: "Mudança legal sintética" } })).status).toBe(201);
      for (const key of after) ids[key] = await importNote(notes[key][0], notes[key][1], item, target);
      const rows = await linkage(target.id, item.description);
      return rows.map((r) => ({ number: r.number, status: r.status, decision: r.reviewValidTo === null ? "NOVA_ANALISE" : "DECISAO_ENCERRADA" }));
    };
    // Empresa A: todas as notas antes das decisões. Empresa B: só janeiro antes; outubro e novembro depois.
    const a = await sequence(company, ["out", "nov", "jan"], []);
    const b = await sequence(companyB, ["jan"], ["nov", "out"]);
    await assertTimelineInvariants(company.id, item.description);
    await assertTimelineInvariants(companyB.id, item.description);
    expect(b).toEqual(a);
    expect(a).toEqual([
      { number: "9501", status: "PENDENTE_REVISAO", decision: "NOVA_ANALISE" },
      { number: "9502", status: "HOMOLOGADO", decision: "DECISAO_ENCERRADA" },
      { number: "9503", status: "PENDENTE_REVISAO", decision: "NOVA_ANALISE" },
    ]);
  });
});
