import type { FastifyInstance } from "fastify";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { isValidCnpj, onlyDigits } from "@calculadora-fiscal/domain";
import { audit } from "../audit/audit.ts";
import { listVisibleCompanies, loadAccessibleCompany, loadCompanyForStaff, requireRole } from "../auth/authorize.ts";
import { hashPassword, validatePasswordPolicy } from "../auth/password.ts";
import { companies, companyAccess, memberships, organizations, roleEnum, users } from "../db/schema.ts";
import { conflict, notFound, unprocessable } from "../errors.ts";
import { clientIp, idParams, requireAuth } from "../http.ts";

const UFS = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"] as const;

const cnpjSchema = z.string().transform(onlyDigits).refine(isValidCnpj, "CNPJ inválido.");

export const companyView = (c: typeof companies.$inferSelect) => ({
  id: c.id,
  organizationId: c.organizationId,
  cnpj: c.cnpj,
  legalName: c.legalName,
  tradeName: c.tradeName,
  uf: c.uf,
  active: c.active,
  createdAt: c.createdAt.toISOString(),
});

export async function companyRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get("/api/organizations", async (request) => {
    const principal = requireAuth(request);
    const ids = principal.memberships.map((m) => m.organizationId);
    if (!ids.length) return { organizations: [] };
    const rows = await app.db.select().from(organizations).where(sql`${organizations.id} in ${ids}`);
    return { organizations: rows.map((o) => ({ id: o.id, name: o.name, slug: o.slug, role: principal.memberships.find((m) => m.organizationId === o.id)?.role })) };
  });

  app.get("/api/companies", async (request) => {
    const principal = requireAuth(request);
    const rows = await listVisibleCompanies(app.db, principal);
    return { companies: rows.map(companyView) };
  });

  app.get("/api/companies/:id", { schema: { params: idParams } }, async (request) => {
    const principal = requireAuth(request);
    const { company, role } = await loadAccessibleCompany(app.db, principal, request.params.id);
    return { company: companyView(company), role };
  });

  app.post(
    "/api/organizations/:id/companies",
    {
      schema: {
        params: idParams,
        body: z.object({
          cnpj: cnpjSchema,
          legalName: z.string().trim().min(2).max(200),
          tradeName: z.string().trim().max(200).optional(),
          uf: z.enum(UFS),
        }),
      },
    },
    async (request, reply) => {
      const principal = requireAuth(request);
      requireRole(principal, request.params.id, ["admin", "fiscal"]);
      const existing = await app.db
        .select({ id: companies.id })
        .from(companies)
        .where(and(eq(companies.organizationId, request.params.id), eq(companies.cnpj, request.body.cnpj)))
        .limit(1);
      if (existing[0]) throw conflict("Já existe empresa com este CNPJ nesta organização.", { companyId: existing[0].id });
      const created = await app.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(companies)
          .values({ organizationId: request.params.id, cnpj: request.body.cnpj, legalName: request.body.legalName, tradeName: request.body.tradeName ?? null, uf: request.body.uf, createdBy: principal.userId })
          .returning();
        await audit(tx, { actorUserId: principal.userId, organizationId: request.params.id, companyId: row!.id, action: "COMPANY_CREATED", entityType: "company", entityId: row!.id, metadata: { cnpj: row!.cnpj, uf: row!.uf }, ip: clientIp(request) });
        return row!;
      });
      reply.code(201);
      return { company: companyView(created) };
    },
  );

  // --- Usuários da organização (somente admin) ---

  app.get("/api/organizations/:id/users", { schema: { params: idParams } }, async (request) => {
    const principal = requireAuth(request);
    requireRole(principal, request.params.id, ["admin"]);
    const rows = await app.db
      .select({ id: users.id, email: users.email, name: users.name, active: users.active, role: memberships.role, lastLoginAt: users.lastLoginAt })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.organizationId, request.params.id))
      .orderBy(users.name);
    return { users: rows.map((u) => ({ ...u, lastLoginAt: u.lastLoginAt?.toISOString() ?? null })) };
  });

  app.post(
    "/api/organizations/:id/users",
    {
      schema: {
        params: idParams,
        body: z.object({
          email: z.email().max(254),
          name: z.string().trim().min(2).max(120),
          password: z.string().min(1).max(256),
          role: z.enum(roleEnum.enumValues),
        }),
      },
    },
    async (request, reply) => {
      const principal = requireAuth(request);
      requireRole(principal, request.params.id, ["admin"]);
      const policyError = validatePasswordPolicy(request.body.password);
      if (policyError) throw unprocessable(policyError);
      const email = request.body.email.trim().toLowerCase();
      const exists = await app.db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
      if (exists[0]) throw conflict("Já existe usuário com este e-mail.");
      const passwordHash = await hashPassword(request.body.password);
      const created = await app.db.transaction(async (tx) => {
        const [user] = await tx.insert(users).values({ email, name: request.body.name, passwordHash }).returning();
        await tx.insert(memberships).values({ userId: user!.id, organizationId: request.params.id, role: request.body.role, createdBy: principal.userId });
        await audit(tx, { actorUserId: principal.userId, organizationId: request.params.id, action: "USER_CREATED", entityType: "user", entityId: user!.id, metadata: { role: request.body.role }, ip: clientIp(request) });
        return user!;
      });
      reply.code(201);
      return { user: { id: created.id, email: created.email, name: created.name, role: request.body.role } };
    },
  );

  // --- Acesso de usuários a empresas (admin concede; fiscal consulta) ---

  app.get("/api/companies/:id/access", { schema: { params: idParams } }, async (request) => {
    const principal = requireAuth(request);
    const { company } = await loadCompanyForStaff(app.db, principal, request.params.id);
    const rows = await app.db
      .select({ userId: users.id, email: users.email, name: users.name, grantedAt: companyAccess.grantedAt })
      .from(companyAccess)
      .innerJoin(users, eq(users.id, companyAccess.userId))
      .where(eq(companyAccess.companyId, company.id));
    return { access: rows.map((r) => ({ ...r, grantedAt: r.grantedAt.toISOString() })) };
  });

  app.post(
    "/api/companies/:id/access",
    { schema: { params: idParams, body: z.object({ userId: z.uuid() }) } },
    async (request, reply) => {
      const principal = requireAuth(request);
      const { company } = await loadCompanyForStaff(app.db, principal, request.params.id, ["admin"]);
      // O usuário precisa ser membro da mesma organização da empresa.
      const member = await app.db
        .select({ id: memberships.id })
        .from(memberships)
        .where(and(eq(memberships.userId, request.body.userId), eq(memberships.organizationId, company.organizationId)))
        .limit(1);
      if (!member[0]) throw notFound("Usuário não encontrado nesta organização.");
      const already = await app.db
        .select({ id: companyAccess.id })
        .from(companyAccess)
        .where(and(eq(companyAccess.companyId, company.id), eq(companyAccess.userId, request.body.userId)))
        .limit(1);
      if (already[0]) throw conflict("Usuário já tem acesso a esta empresa.");
      await app.db.transaction(async (tx) => {
        await tx.insert(companyAccess).values({ companyId: company.id, userId: request.body.userId, grantedBy: principal.userId });
        await audit(tx, { actorUserId: principal.userId, organizationId: company.organizationId, companyId: company.id, action: "COMPANY_ACCESS_GRANTED", entityType: "company_access", entityId: request.body.userId, ip: clientIp(request) });
      });
      reply.code(201);
      return { ok: true };
    },
  );

  app.delete(
    "/api/companies/:id/access/:userId",
    { schema: { params: z.object({ id: z.uuid(), userId: z.uuid() }) } },
    async (request) => {
      const principal = requireAuth(request);
      const { company } = await loadCompanyForStaff(app.db, principal, request.params.id, ["admin"]);
      await app.db.transaction(async (tx) => {
        await tx.delete(companyAccess).where(and(eq(companyAccess.companyId, company.id), eq(companyAccess.userId, request.params.userId)));
        await audit(tx, { actorUserId: principal.userId, organizationId: company.organizationId, companyId: company.id, action: "COMPANY_ACCESS_REVOKED", entityType: "company_access", entityId: request.params.userId, ip: clientIp(request) });
      });
      return { ok: true };
    },
  );
}
