import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { auditEvents, taxRuleApprovals, taxRuleVersions } from "../../db/schema.ts";
import { createHarness, TEST_PASSWORD, type Harness } from "../../test/harness.ts";
import { ACTIVATE, APPROVE, CLASSIFICATION_CONDITIONS, createSyntheticNorm, createSyntheticRule, INCIDENCE_CONDITIONS, op, SYNTHETIC_URL } from "../../test/catalog-fixtures.ts";

/**
 * Catálogo legal (2A.1) — fluxo funcional com dados sintéticos:
 * norma → snapshot → dispositivo → regra → revisão por outra pessoa →
 * aprovação → ativação, com quatro olhos, trilha e auditoria preservadas.
 */
describe("catálogo legal: workflow de regras com quatro olhos", () => {
  let h: Harness;
  let org: string;
  let admin: string;
  let admin2: string;
  let autor: string;
  let revisor: string;
  let ids: Record<string, string>;

  const get = (cookie: string, url: string) => h.request({ method: "GET", url, cookie });
  const auditCount = async (action: string, entityId: string) =>
    (await h.db.select().from(auditEvents).where(and(eq(auditEvents.action, action), eq(auditEvents.entityId, entityId)))).length;

  beforeAll(async () => {
    h = await createHarness();
    org = (await h.createOrg("Escritório Sintético")).id;
    const users = {
      admin: await h.createUser({ email: "admin@cat.local", orgId: org, role: "admin", name: "Admin Sintético" }),
      admin2: await h.createUser({ email: "admin2@cat.local", orgId: org, role: "admin", name: "Admin Dois" }),
      autor: await h.createUser({ email: "autor@cat.local", orgId: org, role: "fiscal", name: "Fiscal Autor" }),
      revisor: await h.createUser({ email: "revisor@cat.local", orgId: org, role: "fiscal", name: "Fiscal Revisor" }),
    };
    ids = Object.fromEntries(Object.entries(users).map(([k, v]) => [k, v.id]));
    admin = await h.login("admin@cat.local", TEST_PASSWORD);
    admin2 = await h.login("admin2@cat.local", TEST_PASSWORD);
    autor = await h.login("autor@cat.local", TEST_PASSWORD);
    revisor = await h.login("revisor@cat.local", TEST_PASSWORD);
  });
  afterAll(() => h?.close());

  it("critério de sucesso: autor cadastra e submete; outro revisa e aprova; admin ativa; evidências preservadas", async () => {
    const norm = await createSyntheticNorm(h, autor, org, { number: "1" });
    const { ruleId, versionId } = await createSyntheticRule(h, autor, org, "CLS-AUTOPECAS-TESTE", norm.provisionId);

    let detail = await get(autor, "/api/tax-rule-versions/" + versionId);
    expect(detail.status).toBe(200);
    expect(detail.body.version).toMatchObject({ status: "RASCUNHO", version: 1, conditionsSchemaVersion: 1, conditions: CLASSIFICATION_CONDITIONS, effectsFrom: "2099-02-01" });
    expect(detail.body.version.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(detail.body.readiness).toEqual([]);
    expect(detail.body.provisions[0]).toMatchObject({ role: "FUNDAMENTO", source: { title: "Norma Sintética nº 1/2099", normative: true, category: "NORMATIVA_OFICIAL" } });
    expect(detail.body.availableOperations).toEqual(["SUBMETE"]);

    expect((await op(h, autor, versionId, "submit", { expectedStatus: "RASCUNHO" })).status).toBe(200);

    // O autor não aprova a própria versão — nem como admin.
    const selfApproval = await op(h, autor, versionId, "approve", APPROVE);
    expect(selfApproval.status).toBe(403);
    expect(selfApproval.body.error.code).toBe("FOUR_EYES");
    expect((await get(autor, "/api/tax-rule-versions/" + versionId)).body.availableOperations).toEqual([]);

    const approved = await op(h, revisor, versionId, "approve", { ...APPROVE, expectedStatus: "EM_REVISAO_TECNICA" });
    expect(approved.status).toBe(200);
    expect(approved.body.version.status).toBe("APROVADA");
    expect(approved.body.approval).toMatchObject({ action: "APROVA", decidedBy: ids.revisor, justification: APPROVE.justification });

    // Fiscal não ativa (provisório: ativação restrita a admin, decisão nº 2).
    const fiscalActivation = await op(h, revisor, versionId, "activate", ACTIVATE);
    expect(fiscalActivation.status).toBe(403);
    // Ativação exige referência à autorização de negócio.
    expect((await op(h, admin, versionId, "activate", { justification: "sem referência" })).status).toBe(400);
    const activated = await op(h, admin, versionId, "activate", ACTIVATE);
    expect(activated.status).toBe(200);
    expect(activated.body.version.status).toBe("ATIVA");

    const history = await get(revisor, "/api/tax-rules/" + ruleId);
    expect(history.status).toBe(200);
    expect(history.body.trail.map((t: { action: string; decidedBy: string }) => [t.action, t.decidedBy])).toEqual([
      ["SUBMETE", ids.autor],
      ["APROVA", ids.revisor],
      ["ATIVA", ids.admin],
    ]);
    expect(history.body.trail[2].authorizationReference).toBe(ACTIVATE.authorizationReference);
    expect(history.body.audit.map((e: { action: string }) => e.action)).toEqual(["TAX_RULE_CREATED", "RULE_VERSION_CREATED", "RULE_VERSION_SUBMITTED", "RULE_VERSION_APPROVED", "RULE_VERSION_ACTIVATED"]);
    expect(history.body.people[ids.revisor!]).toBe("Fiscal Revisor");
    // Tentativas negadas não deixaram trilha nem auditoria.
    expect(await auditCount("RULE_VERSION_APPROVED", versionId)).toBe(1);

    detail = await get(admin, "/api/tax-rule-versions/" + versionId);
    expect(detail.body.availableOperations).toEqual(["SUSPENDE", "REVOGA"]);
    expect(detail.body.notice).toMatch(/nenhum tributo é calculado/);
  });

  it("admin autor não ativa a própria versão; trilha reflete cada decisão", async () => {
    const norm = await createSyntheticNorm(h, admin, org, { number: "2" });
    const { versionId } = await createSyntheticRule(h, admin, org, "CLS-ADMIN-AUTOR", norm.provisionId);
    expect((await op(h, admin, versionId, "submit")).status).toBe(200);
    expect((await op(h, revisor, versionId, "approve", APPROVE)).status).toBe(200);
    const own = await op(h, admin, versionId, "activate", ACTIVATE);
    expect(own.status).toBe(403);
    expect(own.body.error.code).toBe("FOUR_EYES");
    expect((await op(h, admin2, versionId, "activate", ACTIVATE)).status).toBe(200);
  });

  it("devolução preserva a versão; alteração material gera nova versão e o rascunho anterior fica SUBSTITUIDO", async () => {
    const norm = await createSyntheticNorm(h, autor, org, { number: "3" });
    const { ruleId, versionId: v1 } = await createSyntheticRule(h, autor, org, "CLS-DEVOLVIDA", norm.provisionId);
    const before = (await get(autor, "/api/tax-rule-versions/" + v1)).body.version;
    expect((await op(h, autor, v1, "submit")).status).toBe(200);
    expect((await op(h, autor, v1, "return", { justification: "Autor não pode devolver" })).status).toBe(403);
    // Enquanto há versão em revisão, não se cria outra.
    const blocked = await h.request({ method: "POST", url: "/api/tax-rules/" + ruleId + "/versions", cookie: autor, payload: { conditions: CLASSIFICATION_CONDITIONS, effectsFrom: "2099-02-01", changeReason: "tentativa", provisions: [{ provisionId: norm.provisionId, role: "FUNDAMENTO" }] } });
    expect(blocked.status).toBe(409);
    const returned = await op(h, revisor, v1, "return", { justification: "Incluir exclusão de subitem sintético." });
    expect(returned.status).toBe(200);
    expect(returned.body.version.status).toBe("RASCUNHO");

    // Não existe rota para editar conteúdo de versão.
    expect((await h.request({ method: "PATCH", url: "/api/tax-rule-versions/" + v1, cookie: autor, payload: { conditions: {} } })).status).toBe(404);

    const v2 = await h.request({
      method: "POST",
      url: "/api/tax-rules/" + ruleId + "/versions",
      cookie: autor,
      payload: { conditions: { ...CLASSIFICATION_CONDITIONS, ncm: { include: ["8708"], exclude: ["87089900"] } }, effectsFrom: "2099-02-01", changeReason: "Atende a devolução do revisor.", provisions: [{ provisionId: norm.provisionId, role: "FUNDAMENTO" }] },
    });
    expect(v2.status).toBe(201);
    expect(v2.body.version.version).toBe(2);
    expect(v2.body.superseded.map((v: { id: string; status: string }) => [v.id, v.status])).toEqual([[v1, "SUBSTITUIDA"]]);

    const old = (await get(autor, "/api/tax-rule-versions/" + v1)).body;
    expect(old.version.conditions).toEqual(before.conditions);
    expect(old.version.contentSha256).toBe(before.contentSha256);
    expect(old.version.supersededByVersionId).toBe(v2.body.version.id);
    expect(old.trail.map((t: { action: string }) => t.action)).toEqual(["SUBMETE", "DEVOLVE", "SUBSTITUI"]);
    expect(old.trail[1].justification).toBe("Incluir exclusão de subitem sintético.");
    expect(v2.body.version.contentSha256).not.toBe(before.contentSha256);
  });

  it("nova versão ativada substitui a anterior sem reescrevê-la e encerra sua vigência na véspera", async () => {
    const norm = await createSyntheticNorm(h, autor, org, { number: "4" });
    const { ruleId, versionId: v1 } = await createSyntheticRule(h, autor, org, "CLS-SUBSTITUICAO", norm.provisionId);
    for (const step of [() => op(h, autor, v1, "submit"), () => op(h, revisor, v1, "approve", APPROVE), () => op(h, admin, v1, "activate", ACTIVATE)]) expect((await step()).status).toBe(200);
    const v1Before = (await h.db.select().from(taxRuleVersions).where(eq(taxRuleVersions.id, v1)))[0]!;

    const created = await h.request({ method: "POST", url: "/api/tax-rules/" + ruleId + "/versions", cookie: autor, payload: { conditions: { ...CLASSIFICATION_CONDITIONS, cest: { include: ["0100100", "0100200"] } }, effectsFrom: "2099-06-01", changeReason: "Inclusão de CEST sintético.", provisions: [{ provisionId: norm.provisionId, role: "FUNDAMENTO" }] } });
    expect(created.status).toBe(201);
    const v2 = created.body.version.id as string;
    // A versão ATIVA continua ativa enquanto a nova tramita.
    expect((await get(autor, "/api/tax-rule-versions/" + v1)).body.version.status).toBe("ATIVA");
    for (const step of [() => op(h, autor, v2, "submit"), () => op(h, revisor, v2, "approve", APPROVE)]) expect((await step()).status).toBe(200);
    const activated = await op(h, admin, v2, "activate", ACTIVATE);
    expect(activated.status).toBe(200);
    expect(activated.body.superseded).toEqual([expect.objectContaining({ id: v1, status: "SUBSTITUIDA", effectsEndedOn: "2099-05-31", supersededByVersionId: v2 })]);

    const v1After = (await h.db.select().from(taxRuleVersions).where(eq(taxRuleVersions.id, v1)))[0]!;
    expect(v1After.conditions).toEqual(v1Before.conditions);
    expect(v1After.contentSha256).toBe(v1Before.contentSha256);
    expect(v1After.effectsTo).toBeNull(); // o fim original previsto fica intacto; o encerramento é registrado à parte
    const history = (await get(admin, "/api/tax-rules/" + ruleId)).body;
    expect(history.versions.map((v: { version: number; status: string }) => [v.version, v.status])).toEqual([[2, "ATIVA"], [1, "SUBSTITUIDA"]]);
    expect(history.trail.filter((t: { action: string }) => t.action === "APROVA")).toHaveLength(2);
  });

  it("transições proibidas são rejeitadas; suspensão, reativação e revogação seguem o workflow", async () => {
    const norm = await createSyntheticNorm(h, autor, org, { number: "5" });
    const { versionId } = await createSyntheticRule(h, autor, org, "CLS-TRANSICOES", norm.provisionId);
    const invalid = await op(h, admin, versionId, "activate", ACTIVATE);
    expect(invalid.status).toBe(409);
    expect(invalid.body.error).toMatchObject({ code: "INVALID_TRANSITION", details: { currentStatus: "RASCUNHO" } });
    expect((await op(h, revisor, versionId, "approve", APPROVE)).status).toBe(409);
    expect((await op(h, autor, versionId, "submit")).status).toBe(200);
    expect((await op(h, autor, versionId, "submit")).status).toBe(409);
    expect((await op(h, revisor, versionId, "approve", { justification: "" })).status).toBe(400);
    expect((await op(h, revisor, versionId, "approve", APPROVE)).status).toBe(200);
    expect((await op(h, revisor, versionId, "return", APPROVE)).status).toBe(409);
    expect((await op(h, admin, versionId, "suspend", { justification: "antes de ativar" })).status).toBe(409);
    expect((await op(h, admin, versionId, "activate", ACTIVATE)).status).toBe(200);

    // Sem permissão: fiscal não suspende nem revoga.
    expect((await op(h, revisor, versionId, "suspend", { justification: "fiscal tenta" })).status).toBe(403);
    expect((await op(h, autor, versionId, "revoke", { justification: "fiscal tenta", effectsEndedOn: "2099-12-31" })).status).toBe(403);
    // Estado divergente do que a pessoa viu: conflito controlado.
    expect((await op(h, admin, versionId, "suspend", { justification: "x sintético", expectedStatus: "APROVADA" })).status).toBe(409);

    expect((await op(h, admin, versionId, "suspend", { justification: "Suspensão sintética para análise." })).body.version.status).toBe("SUSPENSA");
    expect((await op(h, admin, versionId, "reactivate", ACTIVATE)).body.version.status).toBe("ATIVA");
    expect((await op(h, admin, versionId, "revoke", { justification: "Revogação sintética.", effectsEndedOn: "2099-01-01" })).status).toBe(422);
    const revoked = await op(h, admin, versionId, "revoke", { justification: "Revogação sintética.", effectsEndedOn: "2099-12-31" });
    expect(revoked.status).toBe(200);
    expect(revoked.body.version).toMatchObject({ status: "REVOGADA", effectsEndedOn: "2099-12-31" });
    const payloads: Record<string, Record<string, unknown>> = { activate: ACTIVATE, reactivate: ACTIVATE, suspend: { justification: "x sintético" }, revoke: { justification: "x sintético", effectsEndedOn: "2099-12-31" }, submit: {}, approve: APPROVE, return: APPROVE };
    for (const [operation, payload] of Object.entries(payloads)) {
      expect((await op(h, admin2, versionId, operation, payload)).status, operation).toBe(409);
    }
    const trail = await h.db.select().from(taxRuleApprovals).where(eq(taxRuleApprovals.ruleVersionId, versionId));
    expect(trail.map((t) => t.action)).toEqual(["SUBMETE", "APROVA", "ATIVA", "SUSPENDE", "REATIVA", "REVOGA"]);
  });

  it("fonte não normativa não fundamenta: confronto e interpretação só complementam", async () => {
    const tool = await h.request({ method: "POST", url: "/api/organizations/" + org + "/legal-sources", cookie: autor, payload: { kind: "FERRAMENTA_CONFRONTO", jurisdiction: "UF", uf: "MG", issuer: "Órgão Sintético", title: "Ferramenta Sintética de Consulta", publishedAt: "2099-01-01", officialUrl: SYNTHETIC_URL("ferramenta"), licenseStatus: "OFICIAL_PUBLICO" } });
    expect(tool.status).toBe(201);
    expect(tool.body.source).toMatchObject({ normative: false, category: "FERRAMENTA_CONFRONTO" });
    const snap = await h.request({ method: "POST", url: "/api/legal-sources/" + tool.body.source.id + "/snapshots", cookie: autor, payload: { retrievedAt: "2026-11-01T10:00:00Z", method: "MANUAL", content: "Resultado sintético de consulta" } });
    expect(snap.status).toBe(201);
    const prov = await h.request({ method: "POST", url: "/api/legal-sources/" + tool.body.source.id + "/provisions", cookie: autor, payload: { snapshotId: snap.body.snapshot.id, reference: "consulta sintética", effectsFrom: "2099-01-01" } });
    expect(prov.status).toBe(201);

    const asFundamento = await h.request({ method: "POST", url: "/api/organizations/" + org + "/tax-rules", cookie: autor, payload: { code: "CLS-SO-CONFRONTO", title: "Só confronto", layer: "CLASSIFICACAO", kind: "SEGMENTO_ST", version: { conditions: CLASSIFICATION_CONDITIONS, effectsFrom: "2099-02-01", changeReason: "teste", provisions: [{ provisionId: prov.body.provision.id, role: "FUNDAMENTO" }] } } });
    expect(asFundamento.status).toBe(422);
    expect(asFundamento.body.error.message).toMatch(/só pode ser citada como CONFRONTO/);

    const { versionId } = await createSyntheticRule(h, autor, org, "CLS-CONFRONTO-APENAS", prov.body.provision.id, { provisions: [{ provisionId: prov.body.provision.id, role: "CONFRONTO" }] });
    const submit = await op(h, autor, versionId, "submit");
    expect(submit.status).toBe(422);
    expect(submit.body.error.details.issues.map((i: { code: string }) => i.code)).toEqual(["SEM_FUNDAMENTO"]);

    // Interpretação do escritório: INTERNO, só como INTERPRETACAO.
    const internal = await h.request({ method: "POST", url: "/api/organizations/" + org + "/legal-sources", cookie: autor, payload: { kind: "INTERPRETACAO_ESCRITORIO", jurisdiction: "FEDERAL", issuer: "Escritório Sintético", title: "Orientação interna sintética", publishedAt: "2099-01-01", licenseStatus: "OFICIAL_PUBLICO" } });
    expect(internal.status).toBe(400);
  });

  it("conteúdo licenciado sem autorização documentada não é copiado, importado, aprovado nem ativado", async () => {
    const norm = await createSyntheticNorm(h, autor, org, { number: "6", licenseStatus: "LICENCA_NAO_VERIFICADA" });
    // Sem cópia do conteúdo nem importação assistida.
    const withContent = await h.request({ method: "POST", url: "/api/legal-sources/" + norm.sourceId + "/snapshots", cookie: autor, payload: { retrievedAt: "2026-11-02T10:00:00Z", method: "MANUAL", content: "texto licenciado sintético" } });
    expect(withContent.status).toBe(422);
    const assisted = await h.request({ method: "POST", url: "/api/legal-sources/" + norm.sourceId + "/snapshots", cookie: autor, payload: { retrievedAt: "2026-11-02T10:00:00Z", method: "IMPORTACAO_ASSISTIDA", contentSha256: "c".repeat(64) } });
    expect(assisted.status).toBe(422);
    const withText = await h.request({ method: "POST", url: "/api/legal-sources/" + norm.sourceId + "/provisions", cookie: autor, payload: { snapshotId: norm.snapshotId, reference: "art. 2º", effectsFrom: "2099-02-01", officialText: "texto sintético" } });
    expect(withText.status).toBe(422);

    const { versionId } = await createSyntheticRule(h, autor, org, "CLS-LICENCA", norm.provisionId);
    const submit = await op(h, autor, versionId, "submit");
    expect(submit.status).toBe(422);
    expect(submit.body.error.details.issues.map((i: { code: string }) => i.code)).toEqual(["LICENCA_NAO_VERIFICADA"]);

    // Só admin altera licença; LICENCIADO_CONFIRMADO exige referência do instrumento.
    expect((await h.request({ method: "PATCH", url: "/api/legal-sources/" + norm.sourceId + "/license", cookie: autor, payload: { licenseStatus: "LICENCIADO_CONFIRMADO", licenseReference: "Contrato Sintético 1", justification: "fiscal tenta" } })).status).toBe(403);
    expect((await h.request({ method: "PATCH", url: "/api/legal-sources/" + norm.sourceId + "/license", cookie: admin, payload: { licenseStatus: "LICENCIADO_CONFIRMADO", justification: "sem referência" } })).status).toBe(422);
    const confirmed = await h.request({ method: "PATCH", url: "/api/legal-sources/" + norm.sourceId + "/license", cookie: admin, payload: { licenseStatus: "LICENCIADO_CONFIRMADO", licenseReference: "Contrato Sintético nº 1/2099, cláusula 3", justification: "Contrato sintético conferido." } });
    expect(confirmed.status).toBe(200);
    expect((await op(h, autor, versionId, "submit")).status).toBe(200);
    expect((await op(h, revisor, versionId, "approve", APPROVE)).status).toBe(200);

    // Licença revogada depois da aprovação: a ativação é bloqueada.
    expect((await h.request({ method: "PATCH", url: "/api/legal-sources/" + norm.sourceId + "/license", cookie: admin, payload: { licenseStatus: "LICENCA_NAO_VERIFICADA", justification: "Contrato sintético encerrado." } })).status).toBe(200);
    const activation = await op(h, admin, versionId, "activate", ACTIVATE);
    expect(activation.status).toBe(422);
    expect(activation.body.error.details.issues[0].code).toBe("LICENCA_NAO_VERIFICADA");
    expect(await auditCount("LEGAL_SOURCE_LICENSE_CHANGED", norm.sourceId)).toBe(2);
  });

  it("vigência: fundamento precisa produzir efeitos no início da regra e cobrir todo o período", async () => {
    const norm = await createSyntheticNorm(h, autor, org, { number: "7", effectsFrom: "2099-03-01", effectsTo: "2099-12-31" });
    const early = await createSyntheticRule(h, autor, org, "CLS-ANTES-DO-FUNDAMENTO", norm.provisionId);
    const submit = await op(h, autor, early.versionId, "submit");
    expect(submit.status).toBe(422);
    expect(submit.body.error.details.issues[0].code).toBe("FUNDAMENTO_FORA_DE_VIGENCIA");
    const openEnded = await createSyntheticRule(h, autor, org, "CLS-ALEM-DO-FUNDAMENTO", norm.provisionId, { effectsFrom: "2099-03-01" });
    expect((await op(h, autor, openEnded.versionId, "submit")).body.error.details.issues[0].code).toBe("VIGENCIA_ALEM_DO_FUNDAMENTO");
    const ok = await createSyntheticRule(h, autor, org, "CLS-DENTRO-DO-FUNDAMENTO", norm.provisionId, { effectsFrom: "2099-03-01", effectsTo: "2099-12-31" });
    expect((await op(h, autor, ok.versionId, "submit")).status).toBe(200);
    // Fim anterior ao início é recusado na entrada.
    expect((await h.request({ method: "POST", url: "/api/organizations/" + org + "/tax-rules", cookie: autor, payload: { code: "CLS-DATAS", title: "datas", layer: "CLASSIFICACAO", kind: "SEGMENTO_ST", version: { conditions: CLASSIFICATION_CONDITIONS, effectsFrom: "2099-03-01", effectsTo: "2099-02-01", changeReason: "x sintético", provisions: [] } } })).status).toBe(400);
  });

  it("encerramento de efeitos de dispositivo preserva o registro e aponta as versões afetadas", async () => {
    const norm = await createSyntheticNorm(h, autor, org, { number: "8" });
    const { versionId } = await createSyntheticRule(h, autor, org, "CLS-DISPOSITIVO-ENCERRADO", norm.provisionId);
    const closed = await h.request({ method: "POST", url: "/api/legal-provisions/" + norm.provisionId + "/close-effects", cookie: autor, payload: { effectsTo: "2099-08-31", reason: "Revogado pela Norma Sintética nº 9/2099." } });
    expect(closed.status).toBe(200);
    expect(closed.body.provision).toMatchObject({ effectsTo: "2099-08-31", effectsClosedBy: ids.autor, reference: "art. 1º, Anexo Sintético, item 1" });
    expect(closed.body.affectedRuleVersions).toEqual([expect.objectContaining({ versionId, status: "RASCUNHO" })]);
    expect((await h.request({ method: "POST", url: "/api/legal-provisions/" + norm.provisionId + "/close-effects", cookie: autor, payload: { effectsTo: "2099-07-31", reason: "de novo" } })).status).toBe(409);
    // A versão aberta agora excede a vigência do fundamento: não pode ser submetida.
    expect((await op(h, autor, versionId, "submit")).body.error.details.issues[0].code).toBe("VIGENCIA_ALEM_DO_FUNDAMENTO");
    const source = await get(revisor, "/api/legal-sources/" + norm.sourceId);
    expect(source.body.provisions[0].usedBy).toHaveLength(1);
    expect(source.body.snapshots[0].contentSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("validações de cadastro: camada, duplicidade, hash e dispositivo inexistente", async () => {
    const norm = await createSyntheticNorm(h, autor, org, { number: "9" });
    const wrongLayer = await h.request({ method: "POST", url: "/api/organizations/" + org + "/tax-rules", cookie: autor, payload: { code: "INC-CAMADA", title: "camada", layer: "INCIDENCIA", kind: "INCIDENCIA_ST", version: { conditions: CLASSIFICATION_CONDITIONS, effectsFrom: "2099-02-01", changeReason: "x sintético", provisions: [] } } });
    expect(wrongLayer.status, JSON.stringify(wrongLayer.body)).toBe(422);
    const incidence = await h.request({ method: "POST", url: "/api/organizations/" + org + "/tax-rules", cookie: autor, payload: { code: "INC-AUTOPECAS-TESTE", title: "Incidência sintética", layer: "INCIDENCIA", kind: "INCIDENCIA_ST", version: { conditions: INCIDENCE_CONDITIONS, effectsFrom: "2099-02-01", changeReason: "x sintético", provisions: [{ provisionId: norm.provisionId, role: "FUNDAMENTO" }] } } });
    expect(incidence.status).toBe(201);
    expect((await h.request({ method: "POST", url: "/api/organizations/" + org + "/tax-rules", cookie: autor, payload: { code: "INC-ERRADA", title: "tipo", layer: "INCIDENCIA", kind: "SEGMENTO_ST", version: { conditions: INCIDENCE_CONDITIONS, effectsFrom: "2099-02-01", changeReason: "x sintético", provisions: [] } } })).status).toBe(422);
    expect((await createSyntheticRule(h, autor, org, "CLS-DUP", norm.provisionId)).ruleId).toBeTruthy();
    const dup = await h.request({ method: "POST", url: "/api/organizations/" + org + "/tax-rules", cookie: autor, payload: { code: "CLS-DUP", title: "dup", layer: "CLASSIFICACAO", kind: "SEGMENTO_ST", version: { conditions: CLASSIFICATION_CONDITIONS, effectsFrom: "2099-02-01", changeReason: "x sintético", provisions: [] } } });
    expect(dup.status).toBe(409);
    const unknown = await h.request({ method: "POST", url: "/api/organizations/" + org + "/tax-rules", cookie: autor, payload: { code: "CLS-SEM-DISP", title: "Sem dispositivo", layer: "CLASSIFICACAO", kind: "SEGMENTO_ST", version: { conditions: CLASSIFICATION_CONDITIONS, effectsFrom: "2099-02-01", changeReason: "x sintético", provisions: [{ provisionId: "00000000-0000-4000-8000-000000000000", role: "FUNDAMENTO" }] } } });
    expect(unknown.status, JSON.stringify(unknown.body)).toBe(422);
    expect(unknown.body.error.message).toBe("Dispositivo legal não encontrado.");
    // Falha na criação desfaz tudo: a regra não ficou gravada pela metade.
    expect((await get(autor, "/api/organizations/" + org + "/tax-rules")).body.rules.map((r: { code: string }) => r.code)).not.toContain("CLS-SEM-DISP");

    const source = await h.request({ method: "POST", url: "/api/organizations/" + org + "/legal-sources", cookie: autor, payload: { kind: "DECRETO", jurisdiction: "UF", uf: "MG", issuer: "Assembleia Sintética", number: "9/2099", title: "Duplicada", publishedAt: "2099-01-02", officialUrl: SYNTHETIC_URL("dup"), licenseStatus: "OFICIAL_PUBLICO" } });
    expect(source.status).toBe(409);
    expect((await h.request({ method: "POST", url: "/api/organizations/" + org + "/legal-sources", cookie: autor, payload: { kind: "LEI", jurisdiction: "FEDERAL", issuer: "Órgão", title: "Sem URL", publishedAt: "2099-01-02", licenseStatus: "OFICIAL_PUBLICO" } })).status).toBe(400);
    expect((await h.request({ method: "POST", url: "/api/organizations/" + org + "/legal-sources", cookie: autor, payload: { kind: "BASE_LICENCIADA", jurisdiction: "FEDERAL", issuer: "Base Sintética", title: "Base", publishedAt: "2099-01-02", licenseStatus: "LICENCIADO_CONFIRMADO" } })).status).toBe(400);

    const content = "Texto sintético consultado em 01/11/2026";
    const snap = await h.request({ method: "POST", url: "/api/legal-sources/" + norm.sourceId + "/snapshots", cookie: autor, payload: { retrievedAt: "2026-11-01T10:00:00Z", method: "MANUAL", content } });
    expect(snap.status).toBe(201);
    expect(snap.body.snapshot.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await h.request({ method: "POST", url: "/api/legal-sources/" + norm.sourceId + "/snapshots", cookie: autor, payload: { retrievedAt: "2026-11-01T10:00:00Z", method: "MANUAL", content } })).status).toBe(409);
    expect((await h.request({ method: "POST", url: "/api/legal-sources/" + norm.sourceId + "/snapshots", cookie: autor, payload: { retrievedAt: "2026-11-01T10:00:00Z", method: "MANUAL", content: "outro", contentSha256: "d".repeat(64) } })).status).toBe(422);
    expect((await h.request({ method: "POST", url: "/api/legal-sources/" + norm.sourceId + "/snapshots", cookie: autor, payload: { retrievedAt: "2999-01-01T10:00:00Z", method: "MANUAL", contentSha256: "e".repeat(64) } })).status).toBe(422);
    const text = await h.request({ method: "POST", url: "/api/legal-sources/" + norm.sourceId + "/provisions", cookie: autor, payload: { snapshotId: snap.body.snapshot.id, reference: "art. 3º", effectsFrom: "2099-02-01", officialText: "Texto sintético do art. 3º." } });
    expect(text.status).toBe(201);
    expect(text.body.provision.officialTextSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(text.body.provision.publishedAt).toBe("2099-01-02");
  });

  it("listagens mostram fontes, dispositivos e regras com versão ativa", async () => {
    const sources = await get(revisor, "/api/organizations/" + org + "/legal-sources");
    expect(sources.status).toBe(200);
    expect(sources.body.sources.length).toBeGreaterThan(5);
    const provisions = await get(revisor, "/api/organizations/" + org + "/legal-provisions?q=Sint%C3%A9tica");
    expect(provisions.body.provisions.length).toBeGreaterThan(0);
    const rules = await get(revisor, "/api/organizations/" + org + "/tax-rules?layer=CLASSIFICACAO");
    const main = rules.body.rules.find((r: { code: string }) => r.code === "CLS-AUTOPECAS-TESTE");
    expect(main.activeVersion.status).toBe("ATIVA");
    expect(rules.body.rules.every((r: { layer: string }) => r.layer === "CLASSIFICACAO")).toBe(true);
    const active = await h.db.select().from(taxRuleVersions).where(inArray(taxRuleVersions.status, ["ATIVA"]));
    expect(active.length).toBeGreaterThan(0);
  });
});

describe("catálogo legal: ativação com terceira pessoa (configuração)", () => {
  it("com RULE_ACTIVATION_REQUIRES_THIRD_PERSON=true quem aprovou não ativa", async () => {
    const h = await createHarness({ RULE_ACTIVATION_REQUIRES_THIRD_PERSON: "true" });
    try {
      const org = (await h.createOrg("Org Terceira Pessoa")).id;
      await h.createUser({ email: "autor@tp.local", orgId: org, role: "fiscal" });
      await h.createUser({ email: "aprovador@tp.local", orgId: org, role: "admin" });
      await h.createUser({ email: "ativador@tp.local", orgId: org, role: "admin" });
      const [autor, aprovador, ativador] = await Promise.all(["autor", "aprovador", "ativador"].map((n) => h.login(n + "@tp.local", TEST_PASSWORD)));
      const norm = await createSyntheticNorm(h, autor!, org, { number: "1" });
      const { versionId } = await createSyntheticRule(h, autor!, org, "CLS-TERCEIRA", norm.provisionId);
      expect((await op(h, autor!, versionId, "submit")).status).toBe(200);
      expect((await op(h, aprovador!, versionId, "approve", APPROVE)).status).toBe(200);
      const same = await op(h, aprovador!, versionId, "activate", ACTIVATE);
      expect(same.status).toBe(403);
      expect(same.body.error.message).toMatch(/terceira pessoa/);
      expect((await op(h, ativador!, versionId, "activate", ACTIVATE)).status).toBe(200);
    } finally {
      await h.close();
    }
  });
});
