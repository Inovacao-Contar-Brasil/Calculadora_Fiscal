import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, TEST_PASSWORD, type Harness } from "../test/harness.ts";

describe("autenticação e sessões", () => {
  let h: Harness;
  let orgId: string;

  beforeAll(async () => {
    h = await createHarness();
    orgId = (await h.createOrg("Contar Teste")).id;
    await h.createUser({ email: "admin@teste.local", orgId, role: "admin" });
    await h.createUser({ email: "fiscal@teste.local", orgId, role: "fiscal" });
    await h.createUser({ email: "cliente@teste.local", orgId, role: "cliente" });
  });
  afterAll(() => h.close());

  it("bloqueia operações sem login", async () => {
    expect((await h.request({ method: "GET", url: "/api/auth/me" })).status).toBe(401);
    expect((await h.request({ method: "GET", url: "/api/companies" })).status).toBe(401);
    expect((await h.request({ method: "GET", url: "/api/review-items" })).status).toBe(401);
  });

  it("faz login com cookie HttpOnly + SameSite=Strict e devolve o perfil", async () => {
    const response = await h.request({ method: "POST", url: "/api/auth/login", payload: { email: "admin@teste.local", password: TEST_PASSWORD } });
    expect(response.status).toBe(200);
    const setCookie = String(response.headers["set-cookie"]);
    expect(setCookie).toMatch(/^cf_session=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);
    expect(response.body.user.email).toBe("admin@teste.local");

    const cookie = setCookie.split(";")[0]!;
    const me = await h.request({ method: "GET", url: "/api/auth/me", cookie });
    expect(me.status).toBe(200);
    expect(me.body.memberships).toEqual([expect.objectContaining({ organizationId: orgId, role: "admin", organizationName: "Contar Teste" })]);
  });

  it("recusa senha errada e e-mail inexistente com a mesma mensagem", async () => {
    const wrong = await h.request({ method: "POST", url: "/api/auth/login", payload: { email: "admin@teste.local", password: "errada-errada-errada" } });
    const unknown = await h.request({ method: "POST", url: "/api/auth/login", payload: { email: "ninguem@teste.local", password: TEST_PASSWORD } });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it("logout revoga a sessão", async () => {
    const cookie = await h.login("fiscal@teste.local", TEST_PASSWORD);
    expect((await h.request({ method: "GET", url: "/api/auth/me", cookie })).status).toBe(200);
    expect((await h.request({ method: "POST", url: "/api/auth/logout", cookie })).status).toBe(200);
    expect((await h.request({ method: "GET", url: "/api/auth/me", cookie })).status).toBe(401);
  });

  it("rejeita cookie forjado", async () => {
    const forged = "cf_session=" + "A".repeat(43);
    expect((await h.request({ method: "GET", url: "/api/auth/me", cookie: forged })).status).toBe(401);
  });

  it("bloqueia requisição mutável de origem não permitida (CSRF)", async () => {
    const cookie = await h.login("admin@teste.local", TEST_PASSWORD);
    const response = await h.request({ method: "POST", url: "/api/auth/logout", cookie, headers: { origin: "https://malicioso.example" } });
    expect(response.status).toBe(403);
    // Origem permitida passa.
    const ok = await h.request({ method: "GET", url: "/api/auth/me", cookie });
    expect(ok.status).toBe(200);
  });

  it("somente admin cria usuários; senha fraca é recusada", async () => {
    const admin = await h.login("admin@teste.local", TEST_PASSWORD);
    const fiscal = await h.login("fiscal@teste.local", TEST_PASSWORD);
    const cliente = await h.login("cliente@teste.local", TEST_PASSWORD);
    const payload = { email: "novo@teste.local", name: "Novo Usuário", password: "outra-senha-forte-456", role: "cliente" };

    expect((await h.request({ method: "POST", url: "/api/organizations/" + orgId + "/users", cookie: fiscal, payload })).status).toBe(403);
    expect((await h.request({ method: "POST", url: "/api/organizations/" + orgId + "/users", cookie: cliente, payload })).status).toBe(403);
    const weak = await h.request({ method: "POST", url: "/api/organizations/" + orgId + "/users", cookie: admin, payload: { ...payload, password: "curta" } });
    expect(weak.status).toBe(422);
    const created = await h.request({ method: "POST", url: "/api/organizations/" + orgId + "/users", cookie: admin, payload });
    expect(created.status).toBe(201);
    expect(created.body.user.role).toBe("cliente");
    const dup = await h.request({ method: "POST", url: "/api/organizations/" + orgId + "/users", cookie: admin, payload });
    expect(dup.status).toBe(409);

    // O novo usuário consegue autenticar e não enxerga empresa alguma até receber acesso.
    const novo = await h.login("novo@teste.local", payload.password);
    const list = await h.request({ method: "GET", url: "/api/companies", cookie: novo });
    expect(list.body.companies).toEqual([]);
  });

  it("limita tentativas de login por IP", async () => {
    const limited = await createHarness({ LOGIN_RATE_LIMIT_MAX: "3" });
    try {
      const org = await limited.createOrg("Org Limite");
      await limited.createUser({ email: "alvo@limite.local", orgId: org.id, role: "cliente" });
      const attempt = () => limited.request({ method: "POST", url: "/api/auth/login", payload: { email: "alvo@limite.local", password: "senha-errada-xxxx" } });
      expect((await attempt()).status).toBe(401);
      expect((await attempt()).status).toBe(401);
      expect((await attempt()).status).toBe(401);
      const blocked = await attempt();
      expect(blocked.status).toBe(429);
      // Mesmo com a senha certa, o IP segue bloqueado na janela.
      const right = await limited.request({ method: "POST", url: "/api/auth/login", payload: { email: "alvo@limite.local", password: TEST_PASSWORD } });
      expect(right.status).toBe(429);
    } finally {
      await limited.close();
    }
  });

  it("troca de senha exige senha atual e aplica política", async () => {
    const cookie = await h.login("cliente@teste.local", TEST_PASSWORD);
    expect((await h.request({ method: "POST", url: "/api/auth/password", cookie, payload: { currentPassword: "errada", newPassword: "nova-senha-forte-789" } })).status).toBe(401);
    expect((await h.request({ method: "POST", url: "/api/auth/password", cookie, payload: { currentPassword: TEST_PASSWORD, newPassword: "fraca" } })).status).toBe(422);
    expect((await h.request({ method: "POST", url: "/api/auth/password", cookie, payload: { currentPassword: TEST_PASSWORD, newPassword: "nova-senha-forte-789" } })).status).toBe(200);
    await expect(h.login("cliente@teste.local", TEST_PASSWORD)).rejects.toThrow(/401/);
    expect(await h.login("cliente@teste.local", "nova-senha-forte-789")).toMatch(/^cf_session=/);
  });
});
