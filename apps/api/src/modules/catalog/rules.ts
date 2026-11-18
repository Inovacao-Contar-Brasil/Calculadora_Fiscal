import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  availableOperations,
  canonicalJson,
  checkTransition,
  CONDITIONS_SCHEMA_VERSION,
  RULE_TRANSITIONS,
  type RuleUserOperation,
  type RuleVersionStatus,
  type RuleWorkflowAction,
  type StaffRole,
} from "@calculadora-fiscal/domain";
import { audit } from "../../audit/audit.ts";
import type { Principal } from "../../auth/session.ts";
import type { Database } from "../../db/client.ts";
import { isUniqueViolation } from "../../db/pg-errors.ts";
import {
  auditEvents,
  legalProvisions,
  legalSources,
  provisionRoleEnum,
  ruleKindEnum,
  ruleLayerEnum,
  ruleVersionStatusEnum,
  taxRuleApprovals,
  taxRules,
  taxRuleVersionProvisions,
  taxRuleVersions,
  users,
  type ProvisionRole,
} from "../../db/schema.ts";
import { AppError, conflict, forbidden, notFound, unprocessable } from "../../errors.ts";
import { clientIp, idParams, isoDate, requireAuth } from "../../http.ts";
import { previousDay } from "../fiscal-profiles.ts";
import { NOT_FOUND, requireCatalogStaff, staffRoleOrNotFound } from "./access.ts";
import { ruleConditionsSchema } from "./conditions.ts";
import { provisionView, sourceCategory, sourceView } from "./sources.ts";

type RuleRow = typeof taxRules.$inferSelect;
type VersionRow = typeof taxRuleVersions.$inferSelect;
type ApprovalRow = typeof taxRuleApprovals.$inferSelect;
type LinkedProvision = { role: ProvisionRole; provision: typeof legalProvisions.$inferSelect; source: typeof legalSources.$inferSelect };

// ---------------------------------------------------------------------------
// Visões
// ---------------------------------------------------------------------------

const ruleView = (r: RuleRow) => ({ id: r.id, organizationId: r.organizationId, layer: r.layer, kind: r.kind, code: r.code, title: r.title, createdBy: r.createdBy, createdAt: r.createdAt.toISOString() });

const versionSummary = (v: VersionRow) => ({
  id: v.id,
  ruleId: v.ruleId,
  version: v.version,
  status: v.status,
  effectsFrom: v.effectsFrom,
  effectsTo: v.effectsTo,
  effectsEndedOn: v.effectsEndedOn,
  contentSha256: v.contentSha256,
  changeReason: v.changeReason,
  authorId: v.authorId,
  createdAt: v.createdAt.toISOString(),
  statusChangedAt: v.statusChangedAt.toISOString(),
  supersededByVersionId: v.supersededByVersionId,
});

const versionView = (v: VersionRow) => ({ ...versionSummary(v), conditionsSchemaVersion: v.conditionsSchemaVersion, conditions: v.conditions });

const approvalView = (a: ApprovalRow) => ({
  id: a.id,
  ruleVersionId: a.ruleVersionId,
  action: a.action,
  fromStatus: a.fromStatus,
  toStatus: a.toStatus,
  decidedBy: a.decidedBy,
  decidedAt: a.decidedAt.toISOString(),
  justification: a.justification,
  authorizationReference: a.authorizationReference,
});

// ---------------------------------------------------------------------------
// Regras de fundamentação e prontidão
// ---------------------------------------------------------------------------

/** Papel do dispositivo × categoria da fonte: só norma oficial fundamenta. */
const ROLE_BY_CATEGORY: Record<ReturnType<typeof sourceCategory>, readonly ProvisionRole[]> = {
  NORMATIVA_OFICIAL: ["FUNDAMENTO", "EXCECAO"],
  FERRAMENTA_CONFRONTO: ["CONFRONTO"],
  CONTEUDO_LICENCIADO: ["CONFRONTO"],
  INTERPRETACAO_INTERNA: ["INTERPRETACAO"],
};

export interface ReadinessIssue {
  code: "SEM_FUNDAMENTO" | "FUNDAMENTO_NAO_NORMATIVO" | "LICENCA_NAO_VERIFICADA" | "FUNDAMENTO_FORA_DE_VIGENCIA" | "VIGENCIA_ALEM_DO_FUNDAMENTO";
  message: string;
  provisionId?: string;
}

/**
 * Condições para submeter, aprovar e ativar. Recalculada a cada transição
 * (licença e vigência do dispositivo podem mudar depois da criação).
 */
export function readinessIssues(version: Pick<VersionRow, "effectsFrom" | "effectsTo">, links: LinkedProvision[]): ReadinessIssue[] {
  const issues: ReadinessIssue[] = [];
  const fundamentos = links.filter((l) => l.role === "FUNDAMENTO");
  if (!fundamentos.length) issues.push({ code: "SEM_FUNDAMENTO", message: "A versão precisa citar ao menos um dispositivo normativo oficial como FUNDAMENTO; ferramenta de confronto ou interpretação não bastam." });
  for (const link of links) {
    const label = link.source.title + " — " + link.provision.reference;
    if ((link.role === "FUNDAMENTO" || link.role === "EXCECAO") && !link.source.normative) {
      issues.push({ code: "FUNDAMENTO_NAO_NORMATIVO", message: label + ": fonte não normativa não pode fundamentar.", provisionId: link.provision.id });
    }
    if (link.source.licenseStatus === "LICENCA_NAO_VERIFICADA") {
      issues.push({ code: "LICENCA_NAO_VERIFICADA", message: label + ": fonte com licença não verificada não pode sustentar regra aprovada ou ativa.", provisionId: link.provision.id });
    }
  }
  for (const link of fundamentos) {
    const label = link.source.title + " — " + link.provision.reference;
    const p = link.provision;
    if (p.effectsFrom > version.effectsFrom || (p.effectsTo !== null && p.effectsTo < version.effectsFrom)) {
      issues.push({ code: "FUNDAMENTO_FORA_DE_VIGENCIA", message: label + ": dispositivo sem efeitos em " + version.effectsFrom + " (efeitos " + p.effectsFrom + " a " + (p.effectsTo ?? "em aberto") + ").", provisionId: p.id });
    } else if (p.effectsTo !== null && (version.effectsTo === null || version.effectsTo > p.effectsTo)) {
      issues.push({ code: "VIGENCIA_ALEM_DO_FUNDAMENTO", message: label + ": os efeitos do dispositivo terminam em " + p.effectsTo + "; a versão não pode valer além disso.", provisionId: p.id });
    }
  }
  return issues;
}

function contentHash(input: { ruleId: string; layer: RuleRow["layer"]; conditions: unknown; effectsFrom: string; effectsTo: string | null; provisions: { provisionId: string; role: string }[] }): string {
  const provisions = [...input.provisions].sort((a, b) => (a.provisionId < b.provisionId ? -1 : a.provisionId > b.provisionId ? 1 : 0));
  return createHash("sha256").update(canonicalJson({ ...input, provisions }), "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Esquemas de entrada
// ---------------------------------------------------------------------------

const versionBody = z
  .strictObject({
    conditions: ruleConditionsSchema,
    effectsFrom: isoDate,
    effectsTo: isoDate.optional(),
    changeReason: z.string().trim().min(3).max(2000),
    provisions: z.array(z.strictObject({ provisionId: z.uuid(), role: z.enum(provisionRoleEnum.enumValues) })).max(50),
  })
  .refine((b) => !b.effectsTo || b.effectsTo >= b.effectsFrom, { message: "O fim dos efeitos não pode ser anterior ao início.", path: ["effectsTo"] })
  .refine((b) => new Set(b.provisions.map((p) => p.provisionId)).size === b.provisions.length, { message: "Dispositivo repetido na lista.", path: ["provisions"] });
type VersionInput = z.infer<typeof versionBody>;

const justification = z.string().trim().min(3).max(4000);
const authorizationReference = z.string().trim().min(3).max(500);
const expectedStatus = z.enum(ruleVersionStatusEnum.enumValues).optional();

const OPERATION_BODIES = {
  submit: { action: "SUBMETE", body: z.strictObject({ expectedStatus, justification: justification.optional() }) },
  approve: { action: "APROVA", body: z.strictObject({ expectedStatus, justification }) },
  return: { action: "DEVOLVE", body: z.strictObject({ expectedStatus, justification }) },
  activate: { action: "ATIVA", body: z.strictObject({ expectedStatus, justification, authorizationReference }) },
  suspend: { action: "SUSPENDE", body: z.strictObject({ expectedStatus, justification }) },
  reactivate: { action: "REATIVA", body: z.strictObject({ expectedStatus, justification, authorizationReference }) },
  revoke: { action: "REVOGA", body: z.strictObject({ expectedStatus, justification, effectsEndedOn: isoDate }) },
} as const satisfies Record<string, { action: RuleUserOperation; body: z.ZodType }>;

type OperationBody = { expectedStatus?: RuleVersionStatus; justification?: string; authorizationReference?: string; effectsEndedOn?: string };

const AUDIT_ACTION: Record<RuleWorkflowAction, string> = {
  SUBMETE: "RULE_VERSION_SUBMITTED",
  APROVA: "RULE_VERSION_APPROVED",
  DEVOLVE: "RULE_VERSION_RETURNED",
  ATIVA: "RULE_VERSION_ACTIVATED",
  SUSPENDE: "RULE_VERSION_SUSPENDED",
  REATIVA: "RULE_VERSION_REACTIVATED",
  REVOGA: "RULE_VERSION_REVOKED",
  SUBSTITUI: "RULE_VERSION_SUPERSEDED",
};

// ---------------------------------------------------------------------------
// Acesso a dados
// ---------------------------------------------------------------------------

/** Bloqueia a regra (SELECT ... FOR UPDATE): serializa criação de versões e transições da mesma regra. */
async function lockRule(tx: Database, ruleId: string): Promise<RuleRow> {
  const row = (await tx.select().from(taxRules).where(eq(taxRules.id, ruleId)).for("update"))[0];
  if (!row) throw notFound(NOT_FOUND.rule);
  return row;
}

async function linkedProvisions(db: Database, versionIds: string[]): Promise<Map<string, LinkedProvision[]>> {
  const map = new Map<string, LinkedProvision[]>();
  if (!versionIds.length) return map;
  const rows = await db
    .select({ versionId: taxRuleVersionProvisions.ruleVersionId, role: taxRuleVersionProvisions.role, provision: legalProvisions, source: legalSources })
    .from(taxRuleVersionProvisions)
    .innerJoin(legalProvisions, eq(legalProvisions.id, taxRuleVersionProvisions.provisionId))
    .innerJoin(legalSources, eq(legalSources.id, legalProvisions.sourceId))
    .where(inArray(taxRuleVersionProvisions.ruleVersionId, versionIds))
    .orderBy(asc(legalProvisions.reference));
  for (const row of rows) map.set(row.versionId, [...(map.get(row.versionId) ?? []), { role: row.role, provision: row.provision, source: row.source }]);
  return map;
}

/** Insere trilha + muda status na mesma transação (o trigger exige essa ordem). */
async function recordTransition(
  tx: Database,
  version: VersionRow,
  action: RuleWorkflowAction,
  actorId: string,
  extra: { justification?: string | null; authorizationReference?: string | null; set?: Partial<Pick<VersionRow, "effectsEndedOn" | "supersededByVersionId">> },
): Promise<{ version: VersionRow; approval: ApprovalRow }> {
  const to = RULE_TRANSITIONS[action].to;
  const [approval] = await tx
    .insert(taxRuleApprovals)
    .values({
      organizationId: version.organizationId,
      ruleVersionId: version.id,
      versionAuthorId: version.authorId,
      action,
      fromStatus: version.status,
      toStatus: to,
      decidedBy: actorId,
      justification: extra.justification ?? null,
      authorizationReference: extra.authorizationReference ?? null,
    })
    .returning();
  const [updated] = await tx
    .update(taxRuleVersions)
    .set({ status: to, statusChangedAt: new Date(), ...extra.set })
    .where(and(eq(taxRuleVersions.id, version.id), eq(taxRuleVersions.status, version.status)))
    .returning();
  if (!updated) throw conflict("A versão foi alterada por outra pessoa. Recarregue e tente novamente.");
  return { version: updated, approval: approval! };
}

/** Valida e grava uma nova versão (sempre RASCUNHO) com seus dispositivos, dentro da transação. */
async function insertVersion(tx: Database, request: FastifyRequest, principal: Principal, rule: RuleRow, input: VersionInput): Promise<{ version: VersionRow; superseded: VersionRow[] }> {
  if (input.conditions.layer !== rule.layer) throw unprocessable("As condições são da camada " + input.conditions.layer + ", mas a regra é da camada " + rule.layer + ".");
  const ids = input.provisions.map((p) => p.provisionId);
  const found = ids.length
    ? await tx
        .select({ provision: legalProvisions, source: legalSources })
        .from(legalProvisions)
        .innerJoin(legalSources, eq(legalSources.id, legalProvisions.sourceId))
        .where(and(inArray(legalProvisions.id, ids), eq(legalProvisions.organizationId, rule.organizationId)))
    : [];
  // Dispositivo de outra organização é indistinguível de inexistente.
  const missing = ids.filter((id) => !found.some((f) => f.provision.id === id));
  if (missing.length) throw unprocessable("Dispositivo legal não encontrado.", { provisionIds: missing });
  for (const link of input.provisions) {
    const { source } = found.find((f) => f.provision.id === link.provisionId)!;
    const allowed = ROLE_BY_CATEGORY[sourceCategory(source.kind)];
    if (!allowed.includes(link.role)) {
      throw unprocessable("Fonte " + source.title + " (" + sourceCategory(source.kind) + ") só pode ser citada como " + allowed.join(" ou ") + ", não como " + link.role + ".", { provisionId: link.provisionId });
    }
  }

  const versions = await tx.select().from(taxRuleVersions).where(eq(taxRuleVersions.ruleId, rule.id)).orderBy(desc(taxRuleVersions.version));
  if (versions.some((v) => v.status === "EM_REVISAO_TECNICA")) {
    throw conflict("Há uma versão desta regra em revisão técnica: aprove-a ou devolva-a antes de criar outra.");
  }
  const number = (versions[0]?.version ?? 0) + 1;
  const effectsTo = input.effectsTo ?? null;
  const [created] = await tx
    .insert(taxRuleVersions)
    .values({
      organizationId: rule.organizationId,
      ruleId: rule.id,
      version: number,
      conditionsSchemaVersion: CONDITIONS_SCHEMA_VERSION,
      conditions: input.conditions as Record<string, unknown>,
      contentSha256: contentHash({ ruleId: rule.id, layer: rule.layer, conditions: input.conditions, effectsFrom: input.effectsFrom, effectsTo, provisions: input.provisions }),
      effectsFrom: input.effectsFrom,
      effectsTo,
      changeReason: input.changeReason,
      authorId: principal.userId,
    })
    .returning();
  if (input.provisions.length) {
    await tx.insert(taxRuleVersionProvisions).values(input.provisions.map((p) => ({ organizationId: rule.organizationId, ruleVersionId: created!.id, provisionId: p.provisionId, role: p.role })));
  }
  // Um rascunho por vez: rascunhos anteriores (nunca submetidos ou devolvidos) ficam SUBSTITUIDOS, preservados.
  const superseded: VersionRow[] = [];
  for (const draft of versions.filter((v) => v.status === "RASCUNHO")) {
    const { version } = await recordTransition(tx, draft, "SUBSTITUI", principal.userId, { justification: "Rascunho substituído pela versão " + number + ".", set: { supersededByVersionId: created!.id } });
    superseded.push(version);
    await audit(tx, { actorUserId: principal.userId, organizationId: rule.organizationId, action: AUDIT_ACTION.SUBSTITUI, entityType: "tax_rule_version", entityId: draft.id, metadata: { ruleId: rule.id, version: draft.version, from: "RASCUNHO", supersededBy: created!.id }, ip: clientIp(request) });
  }
  await audit(tx, {
    actorUserId: principal.userId,
    organizationId: rule.organizationId,
    action: "RULE_VERSION_CREATED",
    entityType: "tax_rule_version",
    entityId: created!.id,
    metadata: { ruleId: rule.id, ruleCode: rule.code, version: number, contentSha256: created!.contentSha256, effectsFrom: created!.effectsFrom, effectsTo, provisions: input.provisions, changeReason: input.changeReason },
    ip: clientIp(request),
  });
  return { version: created!, superseded };
}

function denialToError(denial: NonNullable<ReturnType<typeof checkTransition>>, current: RuleVersionStatus): AppError {
  if (denial.code === "INVALID_TRANSITION") return new AppError(409, "INVALID_TRANSITION", denial.message, { currentStatus: current });
  if (denial.code === "FOUR_EYES") return new AppError(403, "FOUR_EYES", denial.message);
  return forbidden(denial.message);
}

// ---------------------------------------------------------------------------
// Rotas
// ---------------------------------------------------------------------------

export async function taxRuleRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const loadRule = async (principal: Principal, id: string) => {
    const rule = (await app.db.select().from(taxRules).where(eq(taxRules.id, id)).limit(1))[0];
    if (!rule) throw notFound(NOT_FOUND.rule);
    return { rule, role: staffRoleOrNotFound(principal, rule.organizationId, NOT_FOUND.rule) };
  };
  const loadVersion = async (principal: Principal, id: string) => {
    const version = (await app.db.select().from(taxRuleVersions).where(eq(taxRuleVersions.id, id)).limit(1))[0];
    if (!version) throw notFound(NOT_FOUND.version);
    return { version, role: staffRoleOrNotFound(principal, version.organizationId, NOT_FOUND.version) };
  };
  const peopleNames = async (ids: (string | null)[]) => {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    if (!unique.length) return {};
    const rows = await app.db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, unique));
    return Object.fromEntries(rows.map((u) => [u.id, u.name]));
  };

  app.get(
    "/api/organizations/:id/tax-rules",
    { schema: { params: idParams, querystring: z.strictObject({ layer: z.enum(ruleLayerEnum.enumValues).optional() }) } },
    async (request) => {
      const principal = requireAuth(request);
      requireCatalogStaff(principal, request.params.id);
      const conditions = [eq(taxRules.organizationId, request.params.id)];
      if (request.query.layer) conditions.push(eq(taxRules.layer, request.query.layer));
      const rules = await app.db.select().from(taxRules).where(and(...conditions)).orderBy(asc(taxRules.code)).limit(500);
      const versions = rules.length ? await app.db.select().from(taxRuleVersions).where(inArray(taxRuleVersions.ruleId, rules.map((r) => r.id))).orderBy(desc(taxRuleVersions.version)) : [];
      return {
        rules: rules.map((rule) => {
          const own = versions.filter((v) => v.ruleId === rule.id);
          const active = own.find((v) => v.status === "ATIVA");
          return { ...ruleView(rule), latestVersion: own[0] ? versionSummary(own[0]) : null, activeVersion: active ? versionSummary(active) : null, versionCount: own.length };
        }),
      };
    },
  );

  app.post(
    "/api/organizations/:id/tax-rules",
    {
      schema: {
        params: idParams,
        body: z.strictObject({
          code: z.string().trim().regex(/^[A-Z0-9][A-Z0-9_.-]{2,63}$/, "Código: maiúsculas, dígitos, _ . -, de 3 a 64 caracteres."),
          title: z.string().trim().min(3).max(300),
          layer: z.enum(ruleLayerEnum.enumValues),
          kind: z.enum(ruleKindEnum.enumValues),
          version: versionBody,
        }),
      },
    },
    async (request, reply) => {
      const principal = requireAuth(request);
      const organizationId = request.params.id;
      requireCatalogStaff(principal, organizationId);
      const b = request.body;
      const kindOk = b.layer === "CLASSIFICACAO" ? b.kind === "SEGMENTO_ST" || b.kind === "OUTRO" : b.kind !== "SEGMENTO_ST";
      if (!kindOk) throw unprocessable("O tipo " + b.kind + " não pertence à camada " + b.layer + ".");
      try {
        const result = await app.db.transaction(async (tx) => {
          const [rule] = await tx.insert(taxRules).values({ organizationId, layer: b.layer, kind: b.kind, code: b.code, title: b.title, createdBy: principal.userId }).returning();
          await audit(tx, { actorUserId: principal.userId, organizationId, action: "TAX_RULE_CREATED", entityType: "tax_rule", entityId: rule!.id, metadata: { code: rule!.code, layer: rule!.layer, kind: rule!.kind }, ip: clientIp(request) });
          const { version } = await insertVersion(tx, request, principal, rule!, b.version);
          return { rule: rule!, version };
        });
        reply.code(201);
        return { rule: ruleView(result.rule), version: versionView(result.version) };
      } catch (error) {
        if (isUniqueViolation(error, "tax_rules_org_code_idx")) throw conflict("Já existe regra com o código " + b.code + " nesta organização.");
        throw error;
      }
    },
  );

  app.get("/api/tax-rules/:id", { schema: { params: idParams } }, async (request) => {
    const principal = requireAuth(request);
    const { rule } = await loadRule(principal, request.params.id);
    const versions = await app.db.select().from(taxRuleVersions).where(eq(taxRuleVersions.ruleId, rule.id)).orderBy(desc(taxRuleVersions.version));
    const versionIds = versions.map((v) => v.id);
    const trail = versionIds.length ? await app.db.select().from(taxRuleApprovals).where(inArray(taxRuleApprovals.ruleVersionId, versionIds)).orderBy(asc(taxRuleApprovals.decidedAt), asc(taxRuleApprovals.id)) : [];
    const events = await app.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, rule.organizationId),
          or(and(eq(auditEvents.entityType, "tax_rule"), eq(auditEvents.entityId, rule.id)), versionIds.length ? and(eq(auditEvents.entityType, "tax_rule_version"), inArray(auditEvents.entityId, versionIds)) : sql`false`),
        ),
      )
      .orderBy(asc(auditEvents.at))
      .limit(1000);
    return {
      rule: ruleView(rule),
      versions: versions.map(versionSummary),
      trail: trail.map((a) => ({ ...approvalView(a), version: versions.find((v) => v.id === a.ruleVersionId)?.version ?? null })),
      audit: events.map((e) => ({ id: e.id, at: e.at.toISOString(), action: e.action, entityType: e.entityType, entityId: e.entityId, actorUserId: e.actorUserId, metadata: e.metadata })),
      people: await peopleNames([rule.createdBy, ...versions.map((v) => v.authorId), ...trail.map((a) => a.decidedBy), ...events.map((e) => e.actorUserId)]),
    };
  });

  app.post("/api/tax-rules/:id/versions", { schema: { params: idParams, body: versionBody } }, async (request, reply) => {
    const principal = requireAuth(request);
    const { rule } = await loadRule(principal, request.params.id);
    try {
      const result = await app.db.transaction(async (tx) => {
        const locked = await lockRule(tx, rule.id);
        return insertVersion(tx, request, principal, locked, request.body);
      });
      reply.code(201);
      return { version: versionView(result.version), superseded: result.superseded.map(versionSummary) };
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict("Outra versão desta regra foi criada ao mesmo tempo. Recarregue e tente novamente.");
      throw error;
    }
  });

  app.get("/api/tax-rule-versions/:id", { schema: { params: idParams } }, async (request) => {
    const principal = requireAuth(request);
    const { version, role } = await loadVersion(principal, request.params.id);
    const rule = (await app.db.select().from(taxRules).where(eq(taxRules.id, version.ruleId)).limit(1))[0]!;
    const links = (await linkedProvisions(app.db, [version.id])).get(version.id) ?? [];
    const trail = await app.db.select().from(taxRuleApprovals).where(eq(taxRuleApprovals.ruleVersionId, version.id)).orderBy(asc(taxRuleApprovals.decidedAt), asc(taxRuleApprovals.id));
    const siblings = await app.db.select().from(taxRuleVersions).where(eq(taxRuleVersions.ruleId, rule.id)).orderBy(desc(taxRuleVersions.version));
    return {
      rule: ruleView(rule),
      version: versionView(version),
      provisions: links.map((l) => ({ role: l.role, provision: provisionView(l.provision), source: sourceView(l.source) })),
      trail: trail.map(approvalView),
      readiness: readinessIssues(version, links),
      availableOperations: availableOperations({ status: version.status, role, actorId: principal.userId, authorId: version.authorId }),
      versions: siblings.map(versionSummary),
      people: await peopleNames([rule.createdBy, version.authorId, ...trail.map((a) => a.decidedBy)]),
      notice: "Catálogo da Sprint 2A.1: regras ATIVAS ainda não são aplicadas a NF-e e nenhum tributo é calculado.",
    };
  });

  for (const [path, { action, body }] of Object.entries(OPERATION_BODIES)) {
    app.post("/api/tax-rule-versions/:id/" + path, { schema: { params: idParams, body } }, async (request) => {
      const principal = requireAuth(request);
      const input = request.body as OperationBody;
      const { version: loaded } = await loadVersion(principal, request.params.id);
      try {
        const result = await app.db.transaction(async (tx) => {
          const rule = await lockRule(tx, loaded.ruleId);
          // Releitura sob o bloqueio da regra: quem chegou depois enxerga o estado já alterado.
          const version = (await tx.select().from(taxRuleVersions).where(eq(taxRuleVersions.id, loaded.id)).limit(1))[0]!;
          const role = staffRoleOrNotFound(principal, version.organizationId, NOT_FOUND.version);
          if (input.expectedStatus && input.expectedStatus !== version.status) {
            throw conflict("A versão foi alterada por outra pessoa: agora está em " + version.status + ". Recarregue e tente novamente.", { currentStatus: version.status });
          }
          const denial = checkTransition({ action, status: version.status, role, actorId: principal.userId, authorId: version.authorId });
          if (denial) throw denialToError(denial, version.status);
          return applyOperation(tx, request, principal, role, rule, version, action, input);
        });
        return result;
      } catch (error) {
        if (isUniqueViolation(error)) throw conflict("Outra transição desta regra foi concluída ao mesmo tempo. Recarregue e tente novamente.");
        throw error;
      }
    });
  }

  async function applyOperation(
    tx: Database,
    request: FastifyRequest,
    principal: Principal,
    _role: StaffRole,
    rule: RuleRow,
    version: VersionRow,
    action: RuleUserOperation,
    input: OperationBody,
  ) {
    const links = (await linkedProvisions(tx, [version.id])).get(version.id) ?? [];
    if (action === "SUBMETE" || action === "APROVA" || action === "ATIVA" || action === "REATIVA") {
      const issues = readinessIssues(version, links);
      if (issues.length) throw unprocessable("A versão não cumpre os requisitos de fundamentação para esta etapa.", { issues });
    }
    const set: Partial<Pick<VersionRow, "effectsEndedOn" | "supersededByVersionId">> = {};
    const others: { version: VersionRow; effectsEndedOn: string | null }[] = [];

    if (action === "ATIVA" && app.config.RULE_ACTIVATION_REQUIRES_THIRD_PERSON === "true") {
      const approval = (await tx.select().from(taxRuleApprovals).where(and(eq(taxRuleApprovals.ruleVersionId, version.id), eq(taxRuleApprovals.action, "APROVA"))).limit(1))[0];
      if (approval?.decidedBy === principal.userId) throw new AppError(403, "FOUR_EYES", "A ativação exige uma terceira pessoa: quem aprovou não pode ativar.");
    }
    if (action === "ATIVA") {
      const siblings = await tx.select().from(taxRuleVersions).where(and(eq(taxRuleVersions.ruleId, rule.id), sql`${taxRuleVersions.id} <> ${version.id}`));
      const current = siblings.find((v) => v.status === "ATIVA" || v.status === "SUSPENSA");
      if (current) {
        if (current.version > version.version) throw unprocessable("A versão " + current.version + " é mais recente e está " + current.status + "; não é possível ativar uma versão anterior.");
        if (version.effectsFrom <= current.effectsFrom) throw unprocessable("A nova versão precisa começar a produzir efeitos depois da versão " + current.version + " (" + current.effectsFrom + ").");
        const overlaps = current.effectsTo === null || current.effectsTo >= version.effectsFrom;
        others.push({ version: current, effectsEndedOn: overlaps ? previousDay(version.effectsFrom) : null });
      }
      for (const older of siblings.filter((v) => v.status === "APROVADA" && v.version < version.version)) others.push({ version: older, effectsEndedOn: null });
    }
    if (action === "REVOGA") {
      const ended = input.effectsEndedOn!;
      if (ended < previousDay(version.effectsFrom)) throw unprocessable("O fim da vigência não pode ser anterior a " + previousDay(version.effectsFrom) + ".");
      if (version.effectsTo && ended > version.effectsTo) throw unprocessable("O fim da vigência não pode ser posterior ao fim previsto na versão (" + version.effectsTo + ").");
      set.effectsEndedOn = ended;
    }

    // Substituições primeiro (liberam o índice de versão ativa única), depois a versão alvo.
    const superseded: VersionRow[] = [];
    for (const other of others) {
      const { version: replaced } = await recordTransition(tx, other.version, "SUBSTITUI", principal.userId, {
        justification: "Substituída pela ativação da versão " + version.version + ".",
        set: { supersededByVersionId: version.id, ...(other.effectsEndedOn ? { effectsEndedOn: other.effectsEndedOn } : {}) },
      });
      superseded.push(replaced);
      await audit(tx, {
        actorUserId: principal.userId,
        organizationId: rule.organizationId,
        action: AUDIT_ACTION.SUBSTITUI,
        entityType: "tax_rule_version",
        entityId: replaced.id,
        metadata: { ruleId: rule.id, version: replaced.version, from: other.version.status, supersededBy: version.id, effectsEndedOn: other.effectsEndedOn },
        ip: clientIp(request),
      });
    }
    const { version: updated, approval } = await recordTransition(tx, version, action, principal.userId, { justification: input.justification ?? null, authorizationReference: input.authorizationReference ?? null, set });
    await audit(tx, {
      actorUserId: principal.userId,
      organizationId: rule.organizationId,
      action: AUDIT_ACTION[action],
      entityType: "tax_rule_version",
      entityId: version.id,
      metadata: {
        ruleId: rule.id,
        ruleCode: rule.code,
        version: version.version,
        from: version.status,
        to: updated.status,
        authorId: version.authorId,
        justification: input.justification ?? null,
        authorizationReference: input.authorizationReference ?? null,
        effectsEndedOn: set.effectsEndedOn ?? null,
        contentSha256: version.contentSha256,
        superseded: superseded.map((v) => v.id),
      },
      ip: clientIp(request),
    });
    return { version: versionView(updated), approval: approvalView(approval), superseded: superseded.map(versionSummary) };
  }
}
