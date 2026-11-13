import type { FastifyInstance, InjectOptions } from "fastify";
import { sql } from "drizzle-orm";
import { buildApp } from "../app.ts";
import { hashPassword } from "../auth/password.ts";
import { loadConfig } from "../config.ts";
import { createDatabase, type DatabaseHandle } from "../db/client.ts";
import { companies, companyAccess, memberships, organizations, users } from "../db/schema.ts";
import type { Role } from "../db/schema.ts";

/**
 * Sobe uma API completa sobre um banco limpo. Por padrão usa PGlite em
 * memória; com TEST_DATABASE_URL usa PostgreSQL real (CI), recriando o schema.
 * Todos os dados são sintéticos.
 */
export interface Harness {
  app: FastifyInstance;
  db: DatabaseHandle["db"];
  close(): Promise<void>;
  createOrg(name: string): Promise<{ id: string }>;
  createUser(input: { email: string; orgId: string; role: Role; name?: string; password?: string }): Promise<{ id: string; email: string; password: string }>;
  createCompany(orgId: string, input: { cnpj: string; legalName: string; uf?: string }): Promise<{ id: string; cnpj: string; organizationId: string }>;
  grantAccess(companyId: string, userId: string): Promise<void>;
  login(email: string, password: string): Promise<string>;
  request(options: InjectOptions & { cookie?: string }): Promise<{ status: number; body: any; headers: Record<string, unknown>; raw: string }>;
}

export const TEST_PASSWORD = "senha-forte-de-teste-123";

export async function createHarness(envOverrides: Record<string, string> = {}): Promise<Harness> {
  const url = process.env.TEST_DATABASE_URL;
  const handle = url ? await createDatabase({ kind: "postgres", url }) : await createDatabase({ kind: "pglite", dataDir: "memory://" });
  if (url) {
    await handle.db.execute(sql`drop schema if exists public cascade`);
    await handle.db.execute(sql`drop schema if exists drizzle cascade`);
    await handle.db.execute(sql`create schema public`);
  }
  await handle.migrate();

  const config = loadConfig({
    NODE_ENV: "test",
    PGLITE_DIR: "memory://",
    ALLOWED_ORIGINS: "http://localhost:5173",
    LOG_LEVEL: "silent",
    COOKIE_SECURE: "false",
    SESSION_TTL_HOURS: "1",
    // Os testes fazem muitos logins em sequência; o limite real é coberto por teste próprio.
    LOGIN_RATE_LIMIT_MAX: "1000",
    ...envOverrides,
  });
  const app = await buildApp({ db: handle.db, config, logger: false });
  await app.ready();

  const request: Harness["request"] = async ({ cookie, ...options }) => {
    const headers: Record<string, string> = { ...(options.headers as Record<string, string> | undefined) };
    if (cookie) headers.cookie = cookie;
    if (options.payload && typeof options.payload === "object" && !headers["content-type"]) headers["content-type"] = "application/json";
    const response = await app.inject({ ...options, headers });
    let body: unknown = null;
    try {
      body = response.headers["content-type"]?.toString().includes("json") ? response.json() : response.body;
    } catch {
      body = response.body;
    }
    return { status: response.statusCode, body, headers: response.headers as Record<string, unknown>, raw: response.body };
  };

  return {
    app,
    db: handle.db,
    close: async () => {
      await app.close();
      await handle.close();
    },
    async createOrg(name) {
      const [row] = await handle.db.insert(organizations).values({ name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + Math.random().toString(36).slice(2, 8) }).returning();
      return { id: row!.id };
    },
    async createUser({ email, orgId, role, name, password }) {
      const pwd = password ?? TEST_PASSWORD;
      const [user] = await handle.db.insert(users).values({ email, name: name ?? email.split("@")[0]!, passwordHash: await hashPassword(pwd) }).returning();
      await handle.db.insert(memberships).values({ userId: user!.id, organizationId: orgId, role });
      return { id: user!.id, email, password: pwd };
    },
    async createCompany(orgId, { cnpj, legalName, uf }) {
      const [row] = await handle.db.insert(companies).values({ organizationId: orgId, cnpj, legalName, uf: uf ?? "MG" }).returning();
      return { id: row!.id, cnpj: row!.cnpj, organizationId: row!.organizationId };
    },
    async grantAccess(companyId, userId) {
      await handle.db.insert(companyAccess).values({ companyId, userId });
    },
    async login(email, password) {
      const response = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
      if (response.statusCode !== 200) throw new Error("login falhou: " + response.statusCode + " " + response.body);
      const setCookie = response.headers["set-cookie"];
      const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
      if (!header) throw new Error("login sem cookie");
      return header.split(";")[0]!;
    },
    request,
  };
}
