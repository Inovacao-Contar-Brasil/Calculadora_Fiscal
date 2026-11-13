import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, TEST_PASSWORD, type Harness } from "../test/harness.ts";
import { syntheticCnpj } from "../test/fixtures.ts";
import { previousDay } from "./fiscal-profiles.ts";

describe("cadastro fiscal versionado com vigência", () => {
  let h: Harness;
  let companyId: string;
  let fiscal: string;
  let cliente: string;

  beforeAll(async () => {
    h = await createHarness();
    const org = await h.createOrg("Org Fiscal");
    const company = await h.createCompany(org.id, { cnpj: syntheticCnpj("500000000001"), legalName: "Autopeças Sintética" });
    companyId = company.id;
    await h.createUser({ email: "fiscal@f.local", orgId: org.id, role: "fiscal" });
    const c = await h.createUser({ email: "cliente@f.local", orgId: org.id, role: "cliente" });
    await h.grantAccess(companyId, c.id);
    fiscal = await h.login("fiscal@f.local", TEST_PASSWORD);
    cliente = await h.login("cliente@f.local", TEST_PASSWORD);
  });
  afterAll(() => h.close());

  it("previousDay trata viradas de mês e ano", () => {
    expect(previousDay("2026-07-01")).toBe("2026-06-30");
    expect(previousDay("2026-01-01")).toBe("2025-12-31");
    expect(previousDay("2024-03-01")).toBe("2024-02-29");
  });

  it("cria versões sucessivas preservando a anterior e encerrando sua vigência", async () => {
    const v1 = await h.request({
      method: "POST",
      url: "/api/companies/" + companyId + "/fiscal-profiles",
      cookie: fiscal,
      payload: { regime: "SIMPLES_NACIONAL", cnaes: ["45.30-7-03"], contribuinteIcms: true, source: "Cartão CNPJ 2026", validFrom: "2026-01-01" },
    });
    expect(v1.status).toBe(201);
    expect(v1.body.profile).toMatchObject({ version: 1, regime: "SIMPLES_NACIONAL", cnaes: ["4530703"], validFrom: "2026-01-01", validTo: null });

    const v2 = await h.request({
      method: "POST",
      url: "/api/companies/" + companyId + "/fiscal-profiles",
      cookie: fiscal,
      payload: { regime: "LUCRO_PRESUMIDO", cnaes: ["4530703", "4530704"], contribuinteIcms: true, source: "Alteração contratual", notes: "Mudança de regime", validFrom: "2026-07-01", parameters: { regimeEspecial: null } },
    });
    expect(v2.status).toBe(201);
    expect(v2.body.profile.version).toBe(2);

    const history = await h.request({ method: "GET", url: "/api/companies/" + companyId + "/fiscal-profiles", cookie: cliente });
    expect(history.status).toBe(200);
    expect(history.body.profiles).toHaveLength(2);
    const [latest, first] = history.body.profiles;
    expect(latest.version).toBe(2);
    expect(first).toMatchObject({ version: 1, validTo: "2026-06-30", supersededById: v2.body.profile.id });
    expect(first.supersededAt).toBeTruthy();
    expect(first.regime).toBe("SIMPLES_NACIONAL");
  });

  it("resolve a versão vigente em uma data", async () => {
    const before = await h.request({ method: "GET", url: "/api/companies/" + companyId + "/fiscal-profiles/current?date=2025-12-31", cookie: fiscal });
    expect(before.body.profile).toBeNull();
    const inV1 = await h.request({ method: "GET", url: "/api/companies/" + companyId + "/fiscal-profiles/current?date=2026-06-30", cookie: fiscal });
    expect(inV1.body.profile.version).toBe(1);
    const inV2 = await h.request({ method: "GET", url: "/api/companies/" + companyId + "/fiscal-profiles/current?date=2026-07-01", cookie: fiscal });
    expect(inV2.body.profile.version).toBe(2);
  });

  it("recusa vigência que não avança e entradas inválidas", async () => {
    const same = await h.request({
      method: "POST",
      url: "/api/companies/" + companyId + "/fiscal-profiles",
      cookie: fiscal,
      payload: { regime: "LUCRO_REAL", cnaes: ["4530703"], contribuinteIcms: true, source: "x y z", validFrom: "2026-07-01" },
    });
    expect(same.status).toBe(422);
    const badCnae = await h.request({
      method: "POST",
      url: "/api/companies/" + companyId + "/fiscal-profiles",
      cookie: fiscal,
      payload: { regime: "LUCRO_REAL", cnaes: ["123"], contribuinteIcms: true, source: "x y z", validFrom: "2026-08-01" },
    });
    expect(badCnae.status).toBe(400);
    const badDate = await h.request({
      method: "POST",
      url: "/api/companies/" + companyId + "/fiscal-profiles",
      cookie: fiscal,
      payload: { regime: "LUCRO_REAL", cnaes: ["4530703"], contribuinteIcms: true, source: "x y z", validFrom: "2026-02-30" },
    });
    expect(badDate.status).toBe(400);
    // Nada disso gerou versão.
    const history = await h.request({ method: "GET", url: "/api/companies/" + companyId + "/fiscal-profiles", cookie: fiscal });
    expect(history.body.profiles).toHaveLength(2);
  });

  it("registra autoria na trilha de auditoria", async () => {
    const auditLog = await h.request({ method: "GET", url: "/api/companies/" + companyId + "/fiscal-profiles/audit", cookie: fiscal });
    expect(auditLog.status).toBe(200);
    expect(auditLog.body.events).toHaveLength(2);
    expect(auditLog.body.events[0]).toMatchObject({ action: "FISCAL_PROFILE_CREATED", actorEmail: "fiscal@f.local" });
    expect(auditLog.body.events[0].metadata).toMatchObject({ version: 2, previousVersion: 1, previousRegime: "SIMPLES_NACIONAL" });
    expect((await h.request({ method: "GET", url: "/api/companies/" + companyId + "/fiscal-profiles/audit", cookie: cliente })).status).toBe(403);
  });
});
