import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { auditEvents, taxRuleApprovals, taxRuleVersions } from "../../db/schema.ts";
import { createHarness, TEST_PASSWORD, type Harness } from "../../test/harness.ts";
import { ACTIVATE, APPROVE, CLASSIFICATION_CONDITIONS, createSyntheticNorm, createSyntheticRule, op } from "../../test/catalog-fixtures.ts";

/**
 * Transições simultâneas na mesma regra produzem um único resultado e erro de
 * conflito controlado (409), nunca 500 nem estado duplicado. No PostgreSQL
 * real as requisições correm de fato em paralelo (pool com várias conexões);
 * no PGlite são serializadas, e o resultado esperado é o mesmo.
 */
describe("catálogo legal: concorrência de aprovação e ativação", () => {
  let h: Harness;
  let org: string;
  let autor: string;
  let revisores: string[];
  let admins: string[];
  let provisionId: string;
  let sequence = 0;

  const newSubmitted = async () => {
    sequence += 1;
    const created = await createSyntheticRule(h, autor, org, "CLS-CORRIDA-" + sequence, provisionId);
    expect((await op(h, autor, created.versionId, "submit")).status).toBe(200);
    return created;
  };
  const statuses = (responses: { status: number }[]) => responses.map((r) => r.status).sort();

  beforeAll(async () => {
    h = await createHarness();
    org = (await h.createOrg("Org Concorrência")).id;
    await h.createUser({ email: "autor@corrida.local", orgId: org, role: "fiscal" });
    for (let i = 0; i < 4; i += 1) await h.createUser({ email: "revisor" + i + "@corrida.local", orgId: org, role: "fiscal" });
    for (let i = 0; i < 4; i += 1) await h.createUser({ email: "admin" + i + "@corrida.local", orgId: org, role: "admin" });
    autor = await h.login("autor@corrida.local", TEST_PASSWORD);
    revisores = await Promise.all([0, 1, 2, 3].map((i) => h.login("revisor" + i + "@corrida.local", TEST_PASSWORD)));
    admins = await Promise.all([0, 1, 2, 3].map((i) => h.login("admin" + i + "@corrida.local", TEST_PASSWORD)));
    provisionId = (await createSyntheticNorm(h, autor, org, { number: "1" })).provisionId;
  });
  afterAll(() => h?.close());

  it("quatro aprovações simultâneas: uma vence, as demais recebem 409; uma só trilha e uma só auditoria", async () => {
    const { versionId } = await newSubmitted();
    const responses = await Promise.all(revisores.map((cookie) => op(h, cookie, versionId, "approve", APPROVE)));
    expect(statuses(responses)).toEqual([200, 409, 409, 409]);
    const approvals = await h.db.select().from(taxRuleApprovals).where(and(eq(taxRuleApprovals.ruleVersionId, versionId), eq(taxRuleApprovals.action, "APROVA")));
    expect(approvals).toHaveLength(1);
    const events = await h.db.select().from(auditEvents).where(and(eq(auditEvents.entityId, versionId), eq(auditEvents.action, "RULE_VERSION_APPROVED")));
    expect(events).toHaveLength(1);
    expect(events[0]!.actorUserId).toBe(approvals[0]!.decidedBy);
  });

  it("aprovar e devolver ao mesmo tempo: um único desfecho", async () => {
    const { versionId } = await newSubmitted();
    const responses = await Promise.all([op(h, revisores[0]!, versionId, "approve", APPROVE), op(h, revisores[1]!, versionId, "return", APPROVE)]);
    expect(statuses(responses)).toEqual([200, 409]);
    const trail = await h.db.select().from(taxRuleApprovals).where(eq(taxRuleApprovals.ruleVersionId, versionId));
    expect(trail.map((t) => t.action).sort()).toEqual(trail.some((t) => t.action === "APROVA") ? ["APROVA", "SUBMETE"] : ["DEVOLVE", "SUBMETE"]);
  });

  it("quatro ativações simultâneas da mesma versão: uma ATIVA, as demais 409", async () => {
    const { versionId } = await newSubmitted();
    expect((await op(h, revisores[0]!, versionId, "approve", APPROVE)).status).toBe(200);
    const responses = await Promise.all(admins.map((cookie) => op(h, cookie, versionId, "activate", ACTIVATE)));
    expect(statuses(responses)).toEqual([200, 409, 409, 409]);
    expect(await h.db.select().from(taxRuleApprovals).where(and(eq(taxRuleApprovals.ruleVersionId, versionId), eq(taxRuleApprovals.action, "ATIVA")))).toHaveLength(1);
  });

  it("ativação simultânea de duas versões da mesma regra termina com uma única versão ATIVA", async () => {
    const { ruleId, versionId: v1 } = await newSubmitted();
    expect((await op(h, revisores[0]!, v1, "approve", APPROVE)).status).toBe(200);
    const created = await h.request({ method: "POST", url: "/api/tax-rules/" + ruleId + "/versions", cookie: autor, payload: { conditions: CLASSIFICATION_CONDITIONS, effectsFrom: "2099-07-01", changeReason: "Versão concorrente sintética.", provisions: [{ provisionId, role: "FUNDAMENTO" }] } });
    expect(created.status).toBe(201);
    const v2 = created.body.version.id as string;
    expect((await op(h, autor, v2, "submit")).status).toBe(200);
    expect((await op(h, revisores[1]!, v2, "approve", APPROVE)).status).toBe(200);

    const responses = await Promise.all([op(h, admins[0]!, v1, "activate", ACTIVATE), op(h, admins[1]!, v2, "activate", ACTIVATE)]);
    for (const response of responses) expect([200, 409, 422]).toContain(response.status);
    const versions = await h.db.select().from(taxRuleVersions).where(eq(taxRuleVersions.ruleId, ruleId));
    expect(versions.filter((v) => v.status === "ATIVA")).toHaveLength(1);
    // Qualquer que seja a ordem, v2 (mais recente) termina ativa: ou v1 foi ativada e substituída, ou v1 foi substituída antes.
    expect(versions.find((v) => v.status === "ATIVA")!.id).toBe(v2);
    expect(versions.find((v) => v.id === v1)!.status).toBe("SUBSTITUIDA");
  });

  it("duas novas versões criadas ao mesmo tempo recebem números distintos, sem 500", async () => {
    const { ruleId, versionId } = await newSubmitted();
    expect((await op(h, revisores[0]!, versionId, "approve", APPROVE)).status).toBe(200);
    const payload = { conditions: CLASSIFICATION_CONDITIONS, effectsFrom: "2099-08-01", changeReason: "Rascunho simultâneo sintético.", provisions: [{ provisionId, role: "FUNDAMENTO" }] };
    const responses = await Promise.all([0, 1, 2].map(() => h.request({ method: "POST", url: "/api/tax-rules/" + ruleId + "/versions", cookie: autor, payload })));
    expect(responses.map((r) => r.status)).toEqual([201, 201, 201]);
    const versions = await h.db.select().from(taxRuleVersions).where(eq(taxRuleVersions.ruleId, ruleId));
    expect(versions.map((v) => v.version).sort()).toEqual([1, 2, 3, 4]);
    // Só o último rascunho fica aberto; os anteriores ficam SUBSTITUIDOS (preservados).
    expect(versions.filter((v) => v.status === "RASCUNHO")).toHaveLength(1);
    expect(versions.filter((v) => v.status === "SUBSTITUIDA")).toHaveLength(2);
  });
});
