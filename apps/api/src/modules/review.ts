import type { FastifyInstance } from "fastify";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { audit } from "../audit/audit.ts";
import { isStaff, listVisibleCompanies, loadAccessibleCompany } from "../auth/authorize.ts";
import type { Database } from "../db/client.ts";
import { classificationStatusEnum, companies, nfeDocuments, nfeItems, reviewItems } from "../db/schema.ts";
import type { ClassificationStatus } from "../db/schema.ts";
import type { Principal } from "../auth/session.ts";
import { asNotFound, conflict, forbidden, notFound, unprocessable } from "../errors.ts";

const REVIEW_NOT_FOUND = "Item de revisão não encontrado.";
import { clientIp, idParams, isoDate, requireAuth } from "../http.ts";
import { classificationFor, issueDateOf } from "./classification.ts";

type ReviewRow = typeof reviewItems.$inferSelect;

export const reviewView = (r: ReviewRow) => ({
  id: r.id,
  organizationId: r.organizationId,
  companyId: r.companyId,
  fingerprint: r.fingerprint,
  ncm: r.ncm,
  cest: r.cest,
  description: r.description,
  status: r.status,
  occurrences: r.occurrences,
  firstDocumentId: r.firstDocumentId,
  lastDocumentId: r.lastDocumentId,
  assignedTo: r.assignedTo,
  decision: r.decision,
  justification: r.justification,
  decidedBy: r.decidedBy,
  decidedAt: r.decidedAt?.toISOString() ?? null,
  validFrom: r.validFrom,
  validTo: r.validTo,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

/** Transições permitidas da fila de revisão. */
const TRANSITIONS: Record<ClassificationStatus, ClassificationStatus[]> = {
  PENDENTE_REVISAO: ["EM_ANALISE", "HOMOLOGADO", "REJEITADO"],
  EM_ANALISE: ["PENDENTE_REVISAO", "HOMOLOGADO", "REJEITADO"],
  HOMOLOGADO: [],
  REJEITADO: [],
};

/**
 * Decisão do Fiscal sobre o enquadramento. Deliberadamente sem campos de
 * valor: nesta fase a homologação é de classificação, não de cálculo.
 */
const decisionSchema = z.object({
  enquadramento: z.string().trim().min(3).max(300),
  fundamentoLegal: z.string().trim().min(3).max(1000),
  observacoes: z.string().trim().max(2000).optional(),
});

export async function reviewRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/api/review-items",
    {
      schema: {
        querystring: z.object({
          companyId: z.uuid().optional(),
          status: z.enum(classificationStatusEnum.enumValues).optional(),
          limit: z.coerce.number().int().min(1).max(200).default(100),
        }),
      },
    },
    async (request) => {
      const principal = requireAuth(request);
      // A fila contém dados internos (justificativas, responsáveis e decisões).
      // Um usuário pode ser fiscal numa organização e cliente em outra:
      // a listagem deve considerar APENAS empresas de organizações com papel staff.
      const staffOrgs = new Set(principal.memberships.filter((m) => isStaff(m.role)).map((m) => m.organizationId));
      const visible = await listVisibleCompanies(app.db, principal);
      let companyIds = visible.filter((c) => staffOrgs.has(c.organizationId)).map((c) => c.id);
      if (request.query.companyId) {
        // Preserve 404 para empresas fora do escopo e 403 para cliente com acesso.
        if (!visible.some((c) => c.id === request.query.companyId)) throw notFound("Empresa não encontrada.");
        if (!companyIds.includes(request.query.companyId)) throw forbidden();
        companyIds = [request.query.companyId];
      } else if (staffOrgs.size === 0) {
        throw forbidden();
      }
      if (!companyIds.length) return { items: [] };
      const conditions = [inArray(reviewItems.companyId, companyIds), isNull(reviewItems.validTo)];
      if (request.query.status) conditions.push(eq(reviewItems.status, request.query.status));
      const rows = await app.db
        .select({ review: reviewItems, companyName: companies.legalName })
        .from(reviewItems)
        .innerJoin(companies, eq(companies.id, reviewItems.companyId))
        .where(and(...conditions))
        .orderBy(desc(reviewItems.updatedAt))
        .limit(request.query.limit);
      return { items: rows.map((r) => ({ ...reviewView(r.review), companyName: r.companyName })) };
    },
  );

  app.get("/api/review-items/:id", { schema: { params: idParams } }, async (request) => {
    const principal = requireAuth(request);
    // Consulta administrativa: cliente acessa status dos próprios documentos,
    // não justificativas, atribuições ou histórico de decisões internas.
    const row = await loadReviewForStaff(app.db, principal, request.params.id);
    const { company } = await loadAccessibleCompany(app.db, principal, row.companyId).catch(asNotFound(REVIEW_NOT_FOUND));
    const occurrences = await app.db
      .select({ documentId: nfeDocuments.id, number: nfeDocuments.number, issuedAt: nfeDocuments.issuedAt, issuerName: nfeDocuments.issuerName, line: nfeItems.line, productCents: nfeItems.productCents, classificationStatus: nfeItems.classificationStatus })
      .from(nfeItems)
      .innerJoin(nfeDocuments, eq(nfeDocuments.id, nfeItems.documentId))
      .where(eq(nfeItems.reviewItemId, row.id))
      .orderBy(desc(nfeDocuments.importedAt))
      .limit(50);
    // Versões anteriores (decisões encerradas) do mesmo produto nesta empresa.
    const history = await app.db
      .select()
      .from(reviewItems)
      .where(and(eq(reviewItems.companyId, company.id), eq(reviewItems.fingerprint, row.fingerprint), sql`${reviewItems.id} <> ${row.id}`))
      .orderBy(desc(reviewItems.createdAt));
    return { item: reviewView(row), company: { id: company.id, legalName: company.legalName }, occurrences, history: history.map(reviewView) };
  });

  app.patch(
    "/api/review-items/:id",
    {
      schema: {
        params: idParams,
        body: z
          .object({
            status: z.enum(["EM_ANALISE", "PENDENTE_REVISAO", "HOMOLOGADO", "REJEITADO"]),
            justification: z.string().trim().max(2000).optional(),
            decision: decisionSchema.optional(),
            validFrom: isoDate.optional(),
          })
          .refine((b) => (b.status === "HOMOLOGADO" ? !!b.decision && !!b.justification : true), {
            message: "Homologar exige decisão (enquadramento + fundamento legal) e justificativa.",
          })
          .refine((b) => (b.status === "REJEITADO" ? !!b.justification : true), { message: "Rejeitar exige justificativa." }),
      },
    },
    async (request) => {
      const principal = requireAuth(request);
      const row = await loadReviewForStaff(app.db, principal, request.params.id);
      if (row.validTo !== null) throw unprocessable("Esta decisão já foi encerrada; reabra o item para nova análise.");
      if (!TRANSITIONS[row.status].includes(request.body.status)) {
        throw unprocessable("Transição de " + row.status + " para " + request.body.status + " não é permitida.");
      }
      const isFinal = request.body.status === "HOMOLOGADO" || request.body.status === "REJEITADO";
      const updated = await app.db.transaction(async (tx) => {
        const [next] = await tx
          .update(reviewItems)
          .set({
            status: request.body.status,
            assignedTo: request.body.status === "EM_ANALISE" ? principal.userId : row.assignedTo,
            decision: isFinal ? (request.body.decision ?? null) : row.decision,
            justification: request.body.justification ?? row.justification,
            decidedBy: isFinal ? principal.userId : null,
            decidedAt: isFinal ? new Date() : null,
            validFrom: isFinal ? (request.body.validFrom ?? new Date().toISOString().slice(0, 10)) : null,
            updatedAt: new Date(),
          })
          // Concorrência otimista: só aplica se ninguém mudou o item desde a leitura.
          .where(and(eq(reviewItems.id, row.id), eq(reviewItems.status, row.status), isNull(reviewItems.validTo)))
          .returning();
        if (!next) throw conflict("O item foi alterado por outra pessoa. Recarregue e tente novamente.");
        await applyReviewToItems(tx, next);
        await audit(tx, {
          actorUserId: principal.userId,
          organizationId: row.organizationId,
          companyId: row.companyId,
          action: "REVIEW_" + request.body.status,
          entityType: "review_item",
          entityId: row.id,
          metadata: { from: row.status, to: request.body.status, fingerprint: row.fingerprint, decision: request.body.decision ?? null },
          ip: clientIp(request),
        });
        return next!;
      });
      return { item: reviewView(updated) };
    },
  );

  /**
   * Encerra a decisão vigente (ex.: mudança legislativa) e abre um novo item
   * pendente para o mesmo produto. O histórico anterior fica preservado.
   */
  app.post(
    "/api/review-items/:id/reopen",
    { schema: { params: idParams, body: z.object({ validTo: isoDate, reason: z.string().trim().min(3).max(2000) }) } },
    async (request, reply) => {
      const principal = requireAuth(request);
      const row = await loadReviewForStaff(app.db, principal, request.params.id);
      if (row.validTo !== null) throw unprocessable("Este item já está encerrado.");
      if (row.validFrom && request.body.validTo < row.validFrom) throw unprocessable("O fim da vigência não pode ser anterior ao início.");
      const created = await app.db.transaction(async (tx) => {
        const [closed] = await tx
          .update(reviewItems)
          .set({ validTo: request.body.validTo, updatedAt: new Date() })
          .where(and(eq(reviewItems.id, row.id), isNull(reviewItems.validTo)))
          .returning();
        if (!closed) throw conflict("O item já foi encerrado por outra pessoa. Recarregue e tente novamente.");
        const [next] = await tx
          .insert(reviewItems)
          .values({
            organizationId: row.organizationId,
            companyId: row.companyId,
            fingerprint: row.fingerprint,
            ncm: row.ncm,
            cest: row.cest,
            description: row.description,
            status: "PENDENTE_REVISAO",
            occurrences: row.occurrences,
            firstDocumentId: row.firstDocumentId,
            lastDocumentId: row.lastDocumentId,
            justification: "Reaberto: " + request.body.reason,
          })
          .returning();
        // Itens de notas emitidas após o fim da vigência voltam a pendente e passam a apontar para o novo item.
        await tx
          .update(nfeItems)
          .set({ classificationStatus: "PENDENTE_REVISAO", reviewItemId: next!.id })
          .where(
            and(
              eq(nfeItems.reviewItemId, row.id),
              sql`${nfeItems.documentId} in (select id from nfe_documents where substr(issued_at, 1, 10) > ${request.body.validTo})`,
            ),
          );
        await refreshDocumentStatuses(tx, next!.id);
        await audit(tx, {
          actorUserId: principal.userId,
          organizationId: row.organizationId,
          companyId: row.companyId,
          action: "REVIEW_REOPENED",
          entityType: "review_item",
          entityId: row.id,
          metadata: { newReviewItemId: next!.id, validTo: request.body.validTo, reason: request.body.reason },
          ip: clientIp(request),
        });
        return next!;
      });
      reply.code(201);
      return { item: reviewView(created) };
    },
  );
}

/**
 * Carrega o item de revisão para uma decisão do escritório. Ordem importa:
 * primeiro o escopo (fora dele = 404, sem revelar existência, inclusive para
 * cliente da mesma organização sem acesso à empresa), depois o papel (403).
 */
async function loadReviewForStaff(db: Database, principal: Principal, id: string): Promise<ReviewRow> {
  const row = (await db.select().from(reviewItems).where(eq(reviewItems.id, id)).limit(1))[0];
  if (!row) throw notFound(REVIEW_NOT_FOUND);
  const { role } = await loadAccessibleCompany(db, principal, row.companyId).catch(asNotFound(REVIEW_NOT_FOUND));
  if (!isStaff(role)) throw forbidden();
  return row;
}

/**
 * Propaga a decisão aos itens de NF-e vinculados usando a MESMA regra da
 * importação (`classificationFor`). Antes: estados de fluxo (EM_ANALISE) não
 * eram propagados — itens importados antes e depois da mudança ficavam com
 * status diferentes — e HOMOLOGADO era aplicado a todas as notas, ignorando a
 * vigência que a importação respeitava.
 */
async function applyReviewToItems(tx: Database, review: ReviewRow): Promise<void> {
  const linked = await tx
    .select({ id: nfeItems.id, issuedAt: nfeDocuments.issuedAt })
    .from(nfeItems)
    .innerJoin(nfeDocuments, eq(nfeDocuments.id, nfeItems.documentId))
    .where(eq(nfeItems.reviewItemId, review.id));
  const byStatus = new Map<ClassificationStatus, string[]>();
  for (const item of linked) {
    const status = classificationFor(review, issueDateOf(item.issuedAt));
    byStatus.set(status, [...(byStatus.get(status) ?? []), item.id]);
  }
  for (const [status, ids] of byStatus) {
    for (let i = 0; i < ids.length; i += 500) {
      await tx.update(nfeItems).set({ classificationStatus: status }).where(inArray(nfeItems.id, ids.slice(i, i + 500)));
    }
  }
  await refreshDocumentStatuses(tx, review.id);
}

/** Recalcula o status dos documentos que contêm itens ligados ao review item. */
async function refreshDocumentStatuses(tx: Database, reviewItemId: string): Promise<void> {
  await tx.execute(sql`
    update nfe_documents d set status = case
      when exists (select 1 from nfe_items i where i.document_id = d.id and i.classification_status <> 'HOMOLOGADO') then 'COM_PENDENCIAS'::document_status
      else 'REVISADA'::document_status end
    where d.id in (select distinct document_id from nfe_items where review_item_id = ${reviewItemId})`);
}
