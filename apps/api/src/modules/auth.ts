import type { FastifyInstance } from "fastify";
import { eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { audit } from "../audit/audit.ts";
import { hashPassword, validatePasswordPolicy, verifyPassword } from "../auth/password.ts";
import { SESSION_COOKIE, createSession, revokeAllUserSessions, revokeSession } from "../auth/session.ts";
import { organizations, users } from "../db/schema.ts";
import { unauthorized, unprocessable } from "../errors.ts";
import { clientIp, requireAuth } from "../http.ts";

/** Hash fixo usado para equalizar o tempo de resposta quando o e-mail não existe. */
const DUMMY_HASH_PROMISE = hashPassword("senha-inexistente-para-timing-constante");

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const cookieOptions = () => ({
    httpOnly: true,
    sameSite: "strict" as const,
    secure: app.config.cookieSecure,
    path: "/",
    maxAge: app.config.SESSION_TTL_HOURS * 3600,
  });

  app.post(
    "/api/auth/login",
    {
      config: { rateLimit: { max: app.config.LOGIN_RATE_LIMIT_MAX, timeWindow: "1 minute" } },
      schema: {
        body: z.object({ email: z.email().max(254), password: z.string().min(1).max(256) }),
      },
    },
    async (request, reply) => {
      const email = request.body.email.trim().toLowerCase();
      const user = (await app.db.select().from(users).where(sql`lower(${users.email}) = ${email}`).limit(1))[0];
      const ok = user ? await verifyPassword(request.body.password, user.passwordHash) : (await verifyPassword(request.body.password, await DUMMY_HASH_PROMISE), false);
      if (!user || !ok || !user.active) {
        await audit(app.db, { actorUserId: null, organizationId: null, action: "LOGIN_FAILED", entityType: "user", entityId: user?.id ?? null, ip: clientIp(request), metadata: { emailDomain: email.split("@")[1] ?? null } });
        throw unauthorized("E-mail ou senha inválidos.");
      }
      const session = await createSession(app.db, user.id, app.config.SESSION_TTL_HOURS, { ip: clientIp(request), userAgent: request.headers["user-agent"] ?? null });
      await app.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
      await audit(app.db, { actorUserId: user.id, organizationId: null, action: "LOGIN", entityType: "user", entityId: user.id, ip: clientIp(request) });
      reply.setCookie(SESSION_COOKIE, session.token, cookieOptions());
      return { user: { id: user.id, email: user.email, name: user.name }, expiresAt: session.expiresAt.toISOString() };
    },
  );

  app.post("/api/auth/logout", async (request, reply) => {
    if (request.principal) {
      await revokeSession(app.db, request.principal.sessionId);
      await audit(app.db, { actorUserId: request.principal.userId, organizationId: null, action: "LOGOUT", entityType: "user", entityId: request.principal.userId, ip: clientIp(request) });
    }
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/auth/me", async (request) => {
    const principal = requireAuth(request);
    const orgIds = principal.memberships.map((m) => m.organizationId);
    const orgs = orgIds.length ? await app.db.select().from(organizations).where(inArray(organizations.id, orgIds)) : [];
    return {
      user: { id: principal.userId, email: principal.email, name: principal.name },
      memberships: principal.memberships.map((m) => ({
        organizationId: m.organizationId,
        role: m.role,
        organizationName: orgs.find((o) => o.id === m.organizationId)?.name ?? "",
      })),
    };
  });

  app.post(
    "/api/auth/password",
    { schema: { body: z.object({ currentPassword: z.string().min(1).max(256), newPassword: z.string().min(1).max(256) }) } },
    async (request) => {
      const principal = requireAuth(request);
      const user = (await app.db.select().from(users).where(eq(users.id, principal.userId)).limit(1))[0];
      if (!user || !(await verifyPassword(request.body.currentPassword, user.passwordHash))) throw unauthorized("Senha atual incorreta.");
      const policyError = validatePasswordPolicy(request.body.newPassword);
      if (policyError) throw unprocessable(policyError);
      await app.db.update(users).set({ passwordHash: await hashPassword(request.body.newPassword) }).where(eq(users.id, user.id));
      // Encerra as demais sessões; a atual continua válida até expirar.
      await revokeAllUserSessions(app.db, user.id);
      await audit(app.db, { actorUserId: user.id, organizationId: null, action: "PASSWORD_CHANGED", entityType: "user", entityId: user.id, ip: clientIp(request) });
      return { ok: true, note: "Senha alterada. Faça login novamente." };
    },
  );
}
