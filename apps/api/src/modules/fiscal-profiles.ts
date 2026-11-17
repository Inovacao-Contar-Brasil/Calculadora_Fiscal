import type { FastifyInstance } from "fastify";
import { and, desc, eq, isNull, lte, or, gte } from "drizzle-orm";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { audit } from "../audit/audit.ts";
import { loadAccessibleCompany, loadCompanyForStaff } from "../auth/authorize.ts";
import { auditEvents, companyFiscalProfiles, regimeEnum, users } from "../db/schema.ts";
import { unprocessable } from "../errors.ts";
import { clientIp, idParams, isoDate, requireAuth } from "../http.ts";

type Profile = typeof companyFiscalProfiles.$inferSelect;

export const profileView = (p: Profile) => ({
  id: p.id,
  companyId: p.companyId,
  version: p.version,
  regime: p.regime,
  cnaes: p.cnaes,
  contribuinteIcms: p.contribuinteIcms,
  parameters: p.parameters,
  source: p.source,
  notes: p.notes,
  validFrom: p.validFrom,
  validTo: p.validTo,
  createdAt: p.createdAt.toISOString(),
  createdBy: p.createdBy,
  supersededAt: p.supersededAt?.toISOString() ?? null,
  supersededById: p.supersededById,
});

/** Dia anterior a uma data ISO (YYYY-MM-DD), em UTC. */
export function previousDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d! - 1));
  return date.toISOString().slice(0, 10);
}

const cnaeSchema = z.string().transform((v) => v.replace(/\D/g, "")).refine((v) => /^\d{7}$/.test(v), "CNAE deve ter 7 dígitos.");

export async function fiscalProfileRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get("/api/companies/:id/fiscal-profiles", { schema: { params: idParams } }, async (request) => {
    const principal = requireAuth(request);
    const { company } = await loadAccessibleCompany(app.db, principal, request.params.id);
    const rows = await app.db
      .select()
      .from(companyFiscalProfiles)
      .where(eq(companyFiscalProfiles.companyId, company.id))
      .orderBy(desc(companyFiscalProfiles.version));
    return { profiles: rows.map(profileView) };
  });

  app.get(
    "/api/companies/:id/fiscal-profiles/current",
    { schema: { params: idParams, querystring: z.object({ date: isoDate.optional() }) } },
    async (request) => {
      const principal = requireAuth(request);
      const { company } = await loadAccessibleCompany(app.db, principal, request.params.id);
      const date = request.query.date ?? new Date().toISOString().slice(0, 10);
      const rows = await app.db
        .select()
        .from(companyFiscalProfiles)
        .where(
          and(
            eq(companyFiscalProfiles.companyId, company.id),
            lte(companyFiscalProfiles.validFrom, date),
            or(isNull(companyFiscalProfiles.validTo), gte(companyFiscalProfiles.validTo, date)),
          ),
        )
        .orderBy(desc(companyFiscalProfiles.version))
        .limit(1);
      return { date, profile: rows[0] ? profileView(rows[0]) : null };
    },
  );

  app.post(
    "/api/companies/:id/fiscal-profiles",
    {
      schema: {
        params: idParams,
        body: z.object({
          regime: z.enum(regimeEnum.enumValues),
          cnaes: z.array(cnaeSchema).min(1).max(50),
          contribuinteIcms: z.boolean(),
          parameters: z.record(z.string(), z.unknown()).default({}),
          source: z.string().trim().min(3).max(300),
          notes: z.string().trim().max(2000).optional(),
          validFrom: isoDate,
        }),
      },
    },
    async (request, reply) => {
      const principal = requireAuth(request);
      const { company } = await loadCompanyForStaff(app.db, principal, request.params.id);
      const body = request.body;

      const created = await app.db.transaction(async (tx) => {
        const latest = (
          await tx
            .select()
            .from(companyFiscalProfiles)
            .where(eq(companyFiscalProfiles.companyId, company.id))
            .orderBy(desc(companyFiscalProfiles.version))
            .limit(1)
        )[0];

        if (latest && body.validFrom <= latest.validFrom) {
          throw unprocessable(
            "A vigência da nova versão (" + body.validFrom + ") deve começar depois da versão " + latest.version + " (" + latest.validFrom + ").",
          );
        }

        const [row] = await tx
          .insert(companyFiscalProfiles)
          .values({
            companyId: company.id,
            version: (latest?.version ?? 0) + 1,
            regime: body.regime,
            cnaes: body.cnaes,
            contribuinteIcms: body.contribuinteIcms,
            parameters: body.parameters,
            source: body.source,
            notes: body.notes ?? null,
            validFrom: body.validFrom,
            validTo: null,
            createdBy: principal.userId,
          })
          .returning();

        // Encerra a versão anterior sem apagá-la: histórico preservado.
        if (latest && (latest.validTo === null || latest.validTo >= body.validFrom)) {
          await tx
            .update(companyFiscalProfiles)
            .set({ validTo: previousDay(body.validFrom), supersededAt: new Date(), supersededById: row!.id })
            .where(eq(companyFiscalProfiles.id, latest.id));
        }

        await audit(tx, {
          actorUserId: principal.userId,
          organizationId: company.organizationId,
          companyId: company.id,
          action: "FISCAL_PROFILE_CREATED",
          entityType: "company_fiscal_profile",
          entityId: row!.id,
          metadata: {
            version: row!.version,
            regime: row!.regime,
            validFrom: row!.validFrom,
            previousVersion: latest?.version ?? null,
            previousRegime: latest?.regime ?? null,
          },
          ip: clientIp(request),
        });
        return row!;
      });

      reply.code(201);
      return { profile: profileView(created) };
    },
  );

  // Consulta de auditoria do cadastro fiscal (staff).
  app.get("/api/companies/:id/fiscal-profiles/audit", { schema: { params: idParams } }, async (request) => {
    const principal = requireAuth(request);
    const { company } = await loadCompanyForStaff(app.db, principal, request.params.id);
    const rows = await app.db
      .select({ id: auditEvents.id, at: auditEvents.at, action: auditEvents.action, entityId: auditEvents.entityId, metadata: auditEvents.metadata, actorName: users.name, actorEmail: users.email })
      .from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.actorUserId))
      .where(and(eq(auditEvents.companyId, company.id), eq(auditEvents.entityType, "company_fiscal_profile")))
      .orderBy(desc(auditEvents.at))
      .limit(200);
    return { events: rows.map((r) => ({ ...r, at: r.at.toISOString() })) };
  });
}
