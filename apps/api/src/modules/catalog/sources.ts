import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { audit } from "../../audit/audit.ts";
import {
  jurisdictionEnum,
  legalProvisions,
  legalSourceKindEnum,
  legalSources,
  legalSourceSnapshots,
  licenseStatusEnum,
  NORMATIVE_SOURCE_KINDS,
  snapshotMethodEnum,
  taxRules,
  taxRuleVersionProvisions,
  taxRuleVersions,
  users,
} from "../../db/schema.ts";
import { isUniqueViolation } from "../../db/pg-errors.ts";
import { conflict, notFound, unprocessable } from "../../errors.ts";
import { clientIp, idParams, isoDate, requireAuth } from "../../http.ts";
import { NOT_FOUND, requireCatalogStaff, staffRoleOrNotFound } from "./access.ts";

type SourceRow = typeof legalSources.$inferSelect;
type SnapshotRow = typeof legalSourceSnapshots.$inferSelect;
type ProvisionRow = typeof legalProvisions.$inferSelect;

const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"] as const;

export const isNormativeKind = (kind: SourceRow["kind"]) => (NORMATIVE_SOURCE_KINDS as readonly string[]).includes(kind);

/** Categoria exibida e usada nas regras de fundamentação. */
export function sourceCategory(kind: SourceRow["kind"]): "NORMATIVA_OFICIAL" | "FERRAMENTA_CONFRONTO" | "INTERPRETACAO_INTERNA" | "CONTEUDO_LICENCIADO" {
  if (isNormativeKind(kind)) return "NORMATIVA_OFICIAL";
  if (kind === "FERRAMENTA_CONFRONTO") return "FERRAMENTA_CONFRONTO";
  if (kind === "INTERPRETACAO_ESCRITORIO") return "INTERPRETACAO_INTERNA";
  return "CONTEUDO_LICENCIADO";
}

export const sourceView = (s: SourceRow) => ({
  id: s.id,
  organizationId: s.organizationId,
  kind: s.kind,
  category: sourceCategory(s.kind),
  jurisdiction: s.jurisdiction,
  uf: s.uf,
  issuer: s.issuer,
  number: s.number,
  title: s.title,
  publishedAt: s.publishedAt,
  officialUrl: s.officialUrl,
  normative: s.normative,
  licenseStatus: s.licenseStatus,
  licenseReference: s.licenseReference,
  notes: s.notes,
  createdBy: s.createdBy,
  createdAt: s.createdAt.toISOString(),
  licenseUpdatedBy: s.licenseUpdatedBy,
  licenseUpdatedAt: s.licenseUpdatedAt?.toISOString() ?? null,
});

const snapshotView = (s: SnapshotRow) => ({
  id: s.id,
  sourceId: s.sourceId,
  retrievedAt: s.retrievedAt.toISOString(),
  retrievedBy: s.retrievedBy,
  url: s.url,
  method: s.method,
  contentSha256: s.contentSha256,
  storageRef: s.storageRef,
  notes: s.notes,
  createdAt: s.createdAt.toISOString(),
});

export const provisionView = (p: ProvisionRow) => ({
  id: p.id,
  sourceId: p.sourceId,
  snapshotId: p.snapshotId,
  reference: p.reference,
  heading: p.heading,
  officialText: p.officialText,
  officialTextSha256: p.officialTextSha256,
  publishedAt: p.publishedAt,
  effectsFrom: p.effectsFrom,
  effectsTo: p.effectsTo,
  createdBy: p.createdBy,
  createdAt: p.createdAt.toISOString(),
  effectsClosedBy: p.effectsClosedBy,
  effectsClosedAt: p.effectsClosedAt?.toISOString() ?? null,
  effectsClosedReason: p.effectsClosedReason,
});

const httpUrl = z.url({ protocol: /^https?$/ }).max(2000);
const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, "SHA-256 em hexadecimal minúsculo (64 caracteres).");
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** Coerência de licença × espécie, com mensagens claras (o banco repete via CHECK). */
function licenseIssues(kind: SourceRow["kind"], status: SourceRow["licenseStatus"], reference: string | null | undefined): string | null {
  if ((status === "INTERNO") !== (kind === "INTERPRETACAO_ESCRITORIO")) return "INTERNO é exclusivo (e obrigatório) para interpretação do escritório.";
  if (kind === "BASE_LICENCIADA" && status === "OFICIAL_PUBLICO") return "Base licenciada não é conteúdo oficial público: use LICENCIADO_CONFIRMADO ou LICENCA_NAO_VERIFICADA.";
  if (status === "LICENCIADO_CONFIRMADO" && !reference) return "LICENCIADO_CONFIRMADO exige a referência verificável do instrumento autorizador (licenseReference).";
  return null;
}

const createSourceBody = z
  .strictObject({
    kind: z.enum(legalSourceKindEnum.enumValues),
    jurisdiction: z.enum(jurisdictionEnum.enumValues),
    uf: z.enum(UFS).optional(),
    issuer: z.string().trim().min(2).max(200),
    number: z.string().trim().min(1).max(60).optional(),
    title: z.string().trim().min(3).max(300),
    publishedAt: isoDate,
    officialUrl: httpUrl.optional(),
    licenseStatus: z.enum(licenseStatusEnum.enumValues),
    licenseReference: z.string().trim().min(3).max(500).optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .superRefine((b, ctx) => {
    if ((b.jurisdiction === "UF") !== !!b.uf) ctx.addIssue({ code: "custom", path: ["uf"], message: "Informe a UF somente (e obrigatoriamente) para jurisdição UF." });
    if (isNormativeKind(b.kind) && !b.officialUrl) ctx.addIssue({ code: "custom", path: ["officialUrl"], message: "Fonte normativa exige a referência oficial (URL da publicação)." });
    const license = licenseIssues(b.kind, b.licenseStatus, b.licenseReference);
    if (license) ctx.addIssue({ code: "custom", path: ["licenseStatus"], message: license });
  });

export async function legalSourceRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const loadSource = async (principal: ReturnType<typeof requireAuth>, id: string) => {
    const row = (await app.db.select().from(legalSources).where(eq(legalSources.id, id)).limit(1))[0];
    if (!row) throw notFound(NOT_FOUND.source);
    const role = staffRoleOrNotFound(principal, row.organizationId, NOT_FOUND.source);
    return { source: row, role };
  };

  app.get(
    "/api/organizations/:id/legal-sources",
    { schema: { params: idParams, querystring: z.strictObject({ kind: z.enum(legalSourceKindEnum.enumValues).optional(), q: z.string().trim().max(100).optional() }) } },
    async (request) => {
      const principal = requireAuth(request);
      requireCatalogStaff(principal, request.params.id);
      const conditions = [eq(legalSources.organizationId, request.params.id)];
      if (request.query.kind) conditions.push(eq(legalSources.kind, request.query.kind));
      if (request.query.q) {
        const like = "%" + request.query.q.replace(/[%_\\]/g, (c) => "\\" + c) + "%";
        conditions.push(or(ilike(legalSources.title, like), ilike(legalSources.number, like), ilike(legalSources.issuer, like))!);
      }
      const rows = await app.db
        .select({ source: legalSources, provisions: sql<number>`(select count(*)::int from legal_provisions p where p.source_id = ${legalSources.id})` })
        .from(legalSources)
        .where(and(...conditions))
        .orderBy(desc(legalSources.createdAt))
        .limit(500);
      return { sources: rows.map((r) => ({ ...sourceView(r.source), provisionCount: r.provisions })) };
    },
  );

  app.post("/api/organizations/:id/legal-sources", { schema: { params: idParams, body: createSourceBody } }, async (request, reply) => {
    const principal = requireAuth(request);
    const organizationId = request.params.id;
    requireCatalogStaff(principal, organizationId);
    const b = request.body;
    try {
      const created = await app.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(legalSources)
          .values({
            organizationId,
            kind: b.kind,
            jurisdiction: b.jurisdiction,
            uf: b.uf ?? null,
            issuer: b.issuer,
            number: b.number ?? null,
            title: b.title,
            publishedAt: b.publishedAt,
            officialUrl: b.officialUrl ?? null,
            normative: isNormativeKind(b.kind),
            licenseStatus: b.licenseStatus,
            licenseReference: b.licenseReference ?? null,
            notes: b.notes ?? null,
            createdBy: principal.userId,
          })
          .returning();
        await audit(tx, {
          actorUserId: principal.userId,
          organizationId,
          action: "LEGAL_SOURCE_CREATED",
          entityType: "legal_source",
          entityId: row!.id,
          metadata: { kind: row!.kind, number: row!.number, publishedAt: row!.publishedAt, licenseStatus: row!.licenseStatus, normative: row!.normative },
          ip: clientIp(request),
        });
        return row!;
      });
      reply.code(201);
      return { source: sourceView(created) };
    } catch (error) {
      if (isUniqueViolation(error, "legal_sources_identity_idx")) throw conflict("Já existe fonte com esta espécie, jurisdição, número e data de publicação.");
      throw error;
    }
  });

  app.get("/api/legal-sources/:id", { schema: { params: idParams } }, async (request) => {
    const principal = requireAuth(request);
    const { source, role } = await loadSource(principal, request.params.id);
    const snapshots = await app.db.select().from(legalSourceSnapshots).where(eq(legalSourceSnapshots.sourceId, source.id)).orderBy(desc(legalSourceSnapshots.retrievedAt));
    const provisions = await app.db.select().from(legalProvisions).where(eq(legalProvisions.sourceId, source.id)).orderBy(asc(legalProvisions.reference), asc(legalProvisions.effectsFrom));
    const usage = provisions.length
      ? await app.db
          .select({ provisionId: taxRuleVersionProvisions.provisionId, role: taxRuleVersionProvisions.role, versionId: taxRuleVersions.id, version: taxRuleVersions.version, status: taxRuleVersions.status, ruleId: taxRules.id, ruleCode: taxRules.code })
          .from(taxRuleVersionProvisions)
          .innerJoin(taxRuleVersions, eq(taxRuleVersions.id, taxRuleVersionProvisions.ruleVersionId))
          .innerJoin(taxRules, eq(taxRules.id, taxRuleVersions.ruleId))
          .where(inArray(taxRuleVersionProvisions.provisionId, provisions.map((p) => p.id)))
      : [];
    const creators = await app.db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [source.createdBy, ...snapshots.map((s) => s.retrievedBy), ...provisions.map((p) => p.createdBy)]));
    return {
      source: sourceView(source),
      role,
      snapshots: snapshots.map(snapshotView),
      provisions: provisions.map((p) => ({ ...provisionView(p), usedBy: usage.filter((u) => u.provisionId === p.id) })),
      people: Object.fromEntries(creators.map((u) => [u.id, u.name])),
    };
  });

  // Situação de licença: decisão jurídica/de negócio, restrita a admin e auditada.
  app.patch(
    "/api/legal-sources/:id/license",
    {
      schema: {
        params: idParams,
        body: z.strictObject({
          licenseStatus: z.enum(["OFICIAL_PUBLICO", "LICENCIADO_CONFIRMADO", "LICENCA_NAO_VERIFICADA"]),
          licenseReference: z.string().trim().min(3).max(500).optional(),
          justification: z.string().trim().min(3).max(2000),
        }),
      },
    },
    async (request) => {
      const principal = requireAuth(request);
      const { source } = await loadSource(principal, request.params.id);
      requireCatalogStaff(principal, source.organizationId, ["admin"]);
      const b = request.body;
      const issue = licenseIssues(source.kind, b.licenseStatus, b.licenseReference);
      if (issue) throw unprocessable(issue);
      const updated = await app.db.transaction(async (tx) => {
        const [row] = await tx
          .update(legalSources)
          .set({ licenseStatus: b.licenseStatus, licenseReference: b.licenseReference ?? null, licenseUpdatedBy: principal.userId, licenseUpdatedAt: new Date() })
          .where(and(eq(legalSources.id, source.id), eq(legalSources.licenseStatus, source.licenseStatus)))
          .returning();
        if (!row) throw conflict("A licença foi alterada por outra pessoa. Recarregue e tente novamente.");
        await audit(tx, {
          actorUserId: principal.userId,
          organizationId: source.organizationId,
          action: "LEGAL_SOURCE_LICENSE_CHANGED",
          entityType: "legal_source",
          entityId: source.id,
          metadata: { from: source.licenseStatus, to: b.licenseStatus, licenseReference: b.licenseReference ?? null, justification: b.justification },
          ip: clientIp(request),
        });
        return row;
      });
      return { source: sourceView(updated) };
    },
  );

  app.post(
    "/api/legal-sources/:id/snapshots",
    {
      schema: {
        params: idParams,
        body: z
          .strictObject({
            retrievedAt: z.iso.datetime({ offset: true }),
            url: httpUrl.optional(),
            method: z.enum(snapshotMethodEnum.enumValues),
            contentSha256: sha256Hex.optional(),
            /** Conteúdo consultado: usado só para calcular o hash no servidor; não é armazenado. */
            content: z.string().min(1).max(500_000).optional(),
            storageRef: z.string().trim().min(3).max(500).optional(),
            notes: z.string().trim().max(2000).optional(),
          })
          .refine((b) => !!b.content || !!b.contentSha256, { message: "Informe o conteúdo consultado ou o seu SHA-256.", path: ["contentSha256"] }),
      },
    },
    async (request, reply) => {
      const principal = requireAuth(request);
      const { source } = await loadSource(principal, request.params.id);
      const b = request.body;
      const retrievedAt = new Date(b.retrievedAt);
      if (retrievedAt.getTime() > Date.now() + 5 * 60_000) throw unprocessable("A data da consulta não pode estar no futuro.");
      if (source.licenseStatus === "LICENCA_NAO_VERIFICADA") {
        // Conteúdo licenciado sem autorização documentada: nada de importação nem envio do texto.
        if (b.method === "IMPORTACAO_ASSISTIDA") throw unprocessable("Fonte com licença não verificada não admite importação assistida.");
        if (b.content) throw unprocessable("Fonte com licença não verificada: registre apenas o hash e a referência, sem enviar o conteúdo.");
      }
      const hash = b.content ? sha256(b.content) : b.contentSha256!;
      if (b.content && b.contentSha256 && b.contentSha256 !== hash) throw unprocessable("O SHA-256 informado não corresponde ao conteúdo enviado.", { computed: hash });
      try {
        const created = await app.db.transaction(async (tx) => {
          const [row] = await tx
            .insert(legalSourceSnapshots)
            .values({ organizationId: source.organizationId, sourceId: source.id, retrievedAt, retrievedBy: principal.userId, url: b.url ?? null, method: b.method, contentSha256: hash, storageRef: b.storageRef ?? null, notes: b.notes ?? null })
            .returning();
          await audit(tx, {
            actorUserId: principal.userId,
            organizationId: source.organizationId,
            action: "LEGAL_SOURCE_SNAPSHOT_CREATED",
            entityType: "legal_source_snapshot",
            entityId: row!.id,
            metadata: { sourceId: source.id, method: row!.method, contentSha256: hash },
            ip: clientIp(request),
          });
          return row!;
        });
        reply.code(201);
        return { snapshot: snapshotView(created) };
      } catch (error) {
        if (isUniqueViolation(error, "legal_source_snapshots_hash_idx")) throw conflict("Já existe snapshot desta fonte com o mesmo conteúdo (SHA-256).");
        throw error;
      }
    },
  );

  app.post(
    "/api/legal-sources/:id/provisions",
    {
      schema: {
        params: idParams,
        body: z
          .strictObject({
            snapshotId: z.uuid(),
            reference: z.string().trim().min(1).max(200),
            heading: z.string().trim().max(500).optional(),
            officialText: z.string().min(1).max(200_000).optional(),
            publishedAt: isoDate.optional(),
            effectsFrom: isoDate,
            effectsTo: isoDate.optional(),
          })
          .refine((b) => !b.effectsTo || b.effectsTo >= b.effectsFrom, { message: "O fim dos efeitos não pode ser anterior ao início.", path: ["effectsTo"] }),
      },
    },
    async (request, reply) => {
      const principal = requireAuth(request);
      const { source } = await loadSource(principal, request.params.id);
      const b = request.body;
      const snapshot = (await app.db.select().from(legalSourceSnapshots).where(and(eq(legalSourceSnapshots.id, b.snapshotId), eq(legalSourceSnapshots.sourceId, source.id))).limit(1))[0];
      if (!snapshot) throw unprocessable("Snapshot não encontrado nesta fonte: registre a proveniência antes do dispositivo.");
      if (b.officialText && source.licenseStatus !== "OFICIAL_PUBLICO") throw unprocessable("Texto integral só pode ser armazenado para fonte oficial pública; para as demais, guarde só a referência.");
      const publishedAt = b.publishedAt ?? source.publishedAt;
      if (publishedAt < source.publishedAt) throw unprocessable("A publicação do dispositivo não pode ser anterior à da fonte (" + source.publishedAt + ").");
      try {
        const created = await app.db.transaction(async (tx) => {
          const [row] = await tx
            .insert(legalProvisions)
            .values({
              organizationId: source.organizationId,
              sourceId: source.id,
              snapshotId: snapshot.id,
              reference: b.reference,
              heading: b.heading ?? null,
              officialText: b.officialText ?? null,
              officialTextSha256: b.officialText ? sha256(b.officialText) : null,
              publishedAt,
              effectsFrom: b.effectsFrom,
              effectsTo: b.effectsTo ?? null,
              createdBy: principal.userId,
            })
            .returning();
          await audit(tx, {
            actorUserId: principal.userId,
            organizationId: source.organizationId,
            action: "LEGAL_PROVISION_CREATED",
            entityType: "legal_provision",
            entityId: row!.id,
            metadata: { sourceId: source.id, snapshotId: snapshot.id, reference: row!.reference, publishedAt, effectsFrom: row!.effectsFrom, effectsTo: row!.effectsTo },
            ip: clientIp(request),
          });
          return row!;
        });
        reply.code(201);
        return { provision: provisionView(created) };
      } catch (error) {
        if (isUniqueViolation(error, "legal_provisions_identity_idx")) throw conflict("Já existe este dispositivo nesta fonte com o mesmo início de efeitos.");
        throw error;
      }
    },
  );

  /**
   * Encerra os efeitos de um dispositivo sem apagá-lo. Não reprocessa regras
   * (isso é a 2A.6): devolve as versões que o citam para análise do Fiscal.
   */
  app.post(
    "/api/legal-provisions/:id/close-effects",
    { schema: { params: idParams, body: z.strictObject({ effectsTo: isoDate, reason: z.string().trim().min(3).max(2000) }) } },
    async (request) => {
      const principal = requireAuth(request);
      const provision = (await app.db.select().from(legalProvisions).where(eq(legalProvisions.id, request.params.id)).limit(1))[0];
      if (!provision) throw notFound(NOT_FOUND.provision);
      staffRoleOrNotFound(principal, provision.organizationId, NOT_FOUND.provision);
      if (provision.effectsClosedAt) throw conflict("Os efeitos deste dispositivo já foram encerrados.");
      if (request.body.effectsTo < provision.effectsFrom) throw unprocessable("O fim dos efeitos não pode ser anterior ao início (" + provision.effectsFrom + ").");
      if (provision.effectsTo && request.body.effectsTo > provision.effectsTo) throw unprocessable("O encerramento não pode ampliar a vigência registrada (" + provision.effectsTo + ").");
      const result = await app.db.transaction(async (tx) => {
        const [row] = await tx
          .update(legalProvisions)
          .set({ effectsTo: request.body.effectsTo, effectsClosedAt: new Date(), effectsClosedBy: principal.userId, effectsClosedReason: request.body.reason })
          .where(and(eq(legalProvisions.id, provision.id), sql`${legalProvisions.effectsClosedAt} is null`))
          .returning();
        if (!row) throw conflict("Os efeitos deste dispositivo já foram encerrados por outra pessoa.");
        await audit(tx, {
          actorUserId: principal.userId,
          organizationId: provision.organizationId,
          action: "LEGAL_PROVISION_EFFECTS_CLOSED",
          entityType: "legal_provision",
          entityId: provision.id,
          metadata: { effectsTo: request.body.effectsTo, previousEffectsTo: provision.effectsTo, reason: request.body.reason },
          ip: clientIp(request),
        });
        return row;
      });
      const affected = await app.db
        .select({ versionId: taxRuleVersions.id, version: taxRuleVersions.version, status: taxRuleVersions.status, ruleCode: taxRules.code })
        .from(taxRuleVersionProvisions)
        .innerJoin(taxRuleVersions, eq(taxRuleVersions.id, taxRuleVersionProvisions.ruleVersionId))
        .innerJoin(taxRules, eq(taxRules.id, taxRuleVersions.ruleId))
        .where(eq(taxRuleVersionProvisions.provisionId, provision.id));
      return { provision: provisionView(result), affectedRuleVersions: affected };
    },
  );

  // Busca de dispositivos para citação em versões (seletor da interface).
  app.get(
    "/api/organizations/:id/legal-provisions",
    { schema: { params: idParams, querystring: z.strictObject({ q: z.string().trim().max(100).optional() }) } },
    async (request) => {
      const principal = requireAuth(request);
      requireCatalogStaff(principal, request.params.id);
      const conditions = [eq(legalProvisions.organizationId, request.params.id)];
      if (request.query.q) {
        const like = "%" + request.query.q.replace(/[%_\\]/g, (c) => "\\" + c) + "%";
        conditions.push(or(ilike(legalProvisions.reference, like), ilike(legalSources.title, like), ilike(legalSources.number, like))!);
      }
      const rows = await app.db
        .select({ provision: legalProvisions, source: legalSources })
        .from(legalProvisions)
        .innerJoin(legalSources, eq(legalSources.id, legalProvisions.sourceId))
        .where(and(...conditions))
        .orderBy(desc(legalProvisions.createdAt))
        .limit(200);
      return { provisions: rows.map((r) => ({ ...provisionView(r.provision), source: sourceView(r.source) })) };
    },
  );
}
