import type { FastifyInstance } from "fastify";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { audit } from "../audit/audit.ts";
import { isStaff, loadAccessibleCompany, staffCompanyScope } from "../auth/authorize.ts";
import type { Database } from "../db/client.ts";
import { classificationStatusEnum, companies, nfeDocuments, nfeItems, reviewItems } from "../db/schema.ts";
import type { ClassificationStatus } from "../db/schema.ts";
import type { Principal } from "../auth/session.ts";
import { asNotFound, conflict, forbidden, notFound, unprocessable } from "../errors.ts";
import { clientIp, idParams, isoDate, requireAuth } from "../http.ts";
import { classificationFor, isFinalDecision, issueDateOf, shiftDay } from "./classification.ts";

const REVIEW_NOT_FOUND = "Item de revisão não encontrado.";

export type ReviewRow = typeof reviewItems.$inferSelect;

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
export const decisionSchema = z.object({
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
      // A fila contém dados internos (justificativas, responsáveis e decisões):
      // só empresas de organizações em que o principal é staff (404/403 em staffCompanyScope).
      const companyIds = await staffCompanyScope(app.db, principal, request.query.companyId);
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
    // Notas vinculadas que a decisão final não cobre (pendência temporal, ver /api/temporal-pendencies/:id).
    const [outside] =
      isFinalDecision(row)
        ? await app.db
            .select({ count: sql<number>`count(*)::int` })
            .from(nfeItems)
            .where(and(eq(nfeItems.reviewItemId, row.id), eq(nfeItems.classificationStatus, "PENDENTE_REVISAO")))
        : [];
    return {
      item: reviewView(row),
      company: { id: company.id, legalName: company.legalName },
      occurrences,
      history: history.map(reviewView),
      outOfValidityItems: outside?.count ?? 0,
    };
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
        // Serializa com importação, reabertura e decisão de período do mesmo produto.
        await lockOpenReview(tx, row.companyId, row.fingerprint);
        let validFrom: string | null = null;
        if (isFinal) {
          // Vigências de decisões finais do mesmo produto são disjuntas (ADR-008): a decisão
          // aberta vale de validFrom em diante, logo tem de começar depois da última encerrada.
          const lastEnd = latestClosedDecisionEnd(await loadTimeline(tx, row.companyId, row.fingerprint));
          const today = new Date().toISOString().slice(0, 10);
          if (request.body.validFrom) validFrom = request.body.validFrom;
          // Rejeição sem data (padrão provisório, decisão pendente do Fiscal — ADR-008): vale para o
          // período em análise, desde o dia seguinte ao fim da última decisão encerrada (ou sem
          // início). Não depende da ordem de importação e fica registrada na própria decisão.
          // Notas de lacunas anteriores continuam pendentes (pendência temporal).
          else if (request.body.status === "REJEITADO") validFrom = lastEnd ? shiftDay(lastEnd, 1) : null;
          // Homologação sem data nunca retroage: vale a partir de hoje (ou do dia seguinte ao fim anterior).
          else validFrom = lastEnd && today <= lastEnd ? shiftDay(lastEnd, 1) : today;
          if (lastEnd && (validFrom === null || validFrom <= lastEnd)) {
            throw unprocessable("A vigência desta decisão deve começar depois de " + lastEnd + ", fim da decisão anterior deste produto.");
          }
        }
        const [next] = await tx
          .update(reviewItems)
          .set({
            status: request.body.status,
            assignedTo: request.body.status === "EM_ANALISE" ? principal.userId : row.assignedTo,
            decision: isFinal ? (request.body.decision ?? null) : row.decision,
            justification: request.body.justification ?? row.justification,
            decidedBy: isFinal ? principal.userId : null,
            decidedAt: isFinal ? new Date() : null,
            validFrom,
            updatedAt: new Date(),
          })
          // Concorrência otimista: só aplica se ninguém mudou o item desde a leitura.
          .where(and(eq(reviewItems.id, row.id), eq(reviewItems.status, row.status), isNull(reviewItems.validTo)))
          .returning();
        if (!next) throw conflict("O item foi alterado por outra pessoa. Recarregue e tente novamente.");
        const outOfValidityItems = await applyReviewToItems(tx, next);
        await audit(tx, {
          actorUserId: principal.userId,
          organizationId: row.organizationId,
          companyId: row.companyId,
          action: "REVIEW_" + request.body.status,
          entityType: "review_item",
          entityId: row.id,
          metadata: { from: row.status, to: request.body.status, fingerprint: row.fingerprint, decision: request.body.decision ?? null, validFrom, outOfValidityItems },
          ip: clientIp(request),
        });
        return next!;
      });
      return { item: reviewView(updated) };
    },
  );

  /**
   * Encerra a decisão vigente (ex.: mudança legislativa) e abre um novo item
   * pendente para o mesmo produto. O histórico anterior fica preservado: a
   * decisão encerrada continua valendo para as notas da sua vigência, e toda
   * nota que ela não cobre passa à nova análise (nenhuma fica órfã).
   */
  app.post(
    "/api/review-items/:id/reopen",
    { schema: { params: idParams, body: z.object({ validTo: isoDate, reason: z.string().trim().min(3).max(2000) }) } },
    async (request, reply) => {
      const principal = requireAuth(request);
      const row = await loadReviewForStaff(app.db, principal, request.params.id);
      if (row.validTo !== null) throw unprocessable("Este item já está encerrado.");
      // Sem decisão final não há vigência a encerrar; encerrar um item pendente deixaria notas sem análise.
      if (!isFinalDecision(row)) throw unprocessable("Só uma decisão homologada ou rejeitada pode ter a vigência encerrada; conclua a análise antes.");
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
        // Itens que a decisão encerrada não cobre passam à nova análise (pendentes, como manda
        // classificationFor para o novo item): emitidos depois do fim da vigência e — antes
        // ficavam órfãos na decisão encerrada — emitidos antes do início da vigência.
        const outside = row.validFrom
          ? sql`substr(issued_at, 1, 10) > ${request.body.validTo} or substr(issued_at, 1, 10) < ${row.validFrom}`
          : sql`substr(issued_at, 1, 10) > ${request.body.validTo}`;
        const moved = await tx
          .update(nfeItems)
          .set({ classificationStatus: classificationFor(next!, request.body.validTo), reviewItemId: next!.id })
          .where(and(eq(nfeItems.reviewItemId, row.id), sql`${nfeItems.documentId} in (select id from nfe_documents where ${outside})`))
          .returning({ id: nfeItems.id });
        await refreshDocumentStatuses(tx, next!.id);
        await audit(tx, {
          actorUserId: principal.userId,
          organizationId: row.organizationId,
          companyId: row.companyId,
          action: "REVIEW_REOPENED",
          entityType: "review_item",
          entityId: row.id,
          metadata: { newReviewItemId: next!.id, validTo: request.body.validTo, reason: request.body.reason, movedItems: moved.length },
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
 * `notFoundMessage` permite que outro recurso derivado do item (a pendência
 * temporal) responda com o próprio corpo de "inexistente".
 */
export async function loadReviewForStaff(db: Database, principal: Principal, id: string, notFoundMessage = REVIEW_NOT_FOUND): Promise<ReviewRow> {
  const row = (await db.select().from(reviewItems).where(eq(reviewItems.id, id)).limit(1))[0];
  if (!row) throw notFound(notFoundMessage);
  const { role } = await loadAccessibleCompany(db, principal, row.companyId).catch(asNotFound(notFoundMessage));
  if (!isStaff(role)) throw forbidden();
  return row;
}

/**
 * Lock pessimista do item aberto do produto (sempre existe enquanto houver
 * revisão do produto). Toda escrita que muda a linha do tempo de decisões
 * — decisão final, reabertura, decisão de período — e a importação (via
 * UPSERT, que trava a mesma linha) passam por ele, então leem e validam as
 * vigências sem corrida. Devolve o item aberto, ou undefined se não houver.
 */
export async function lockOpenReview(tx: Database, companyId: string, fingerprint: string): Promise<ReviewRow | undefined> {
  const [open] = await tx
    .select()
    .from(reviewItems)
    .where(and(eq(reviewItems.companyId, companyId), eq(reviewItems.fingerprint, fingerprint), isNull(reviewItems.validTo)))
    .for("update");
  return open;
}

/** Todas as versões (aberta, encerradas e de período) do produto na empresa. */
export async function loadTimeline(tx: Database, companyId: string, fingerprint: string): Promise<ReviewRow[]> {
  return tx.select().from(reviewItems).where(and(eq(reviewItems.companyId, companyId), eq(reviewItems.fingerprint, fingerprint)));
}

/** Fim da vigência mais tardia entre as decisões finais já encerradas. */
function latestClosedDecisionEnd(timeline: readonly ReviewRow[]): string | null {
  let latest: string | null = null;
  for (const row of timeline) {
    if (row.validTo !== null && isFinalDecision(row) && (latest === null || row.validTo > latest)) latest = row.validTo;
  }
  return latest;
}

/**
 * Propaga a decisão aos itens de NF-e vinculados usando a MESMA regra da
 * importação (`classificationFor`). Antes: estados de fluxo (EM_ANALISE) não
 * eram propagados — itens importados antes e depois da mudança ficavam com
 * status diferentes — e HOMOLOGADO era aplicado a todas as notas, ignorando a
 * vigência que a importação respeitava.
 */
async function applyReviewToItems(tx: Database, review: ReviewRow): Promise<number> {
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
  // Itens que uma decisão final deixou fora da vigência: origem de pendência temporal.
  return isFinalDecision(review) ? (byStatus.get("PENDENTE_REVISAO")?.length ?? 0) : 0;
}

/** Recalcula o status dos documentos que contêm itens ligados ao review item. */
export async function refreshDocumentStatuses(tx: Database, reviewItemId: string): Promise<void> {
  await tx.execute(sql`
    update nfe_documents d set status = case
      when exists (select 1 from nfe_items i where i.document_id = d.id and i.classification_status <> 'HOMOLOGADO') then 'COM_PENDENCIAS'::document_status
      else 'REVISADA'::document_status end
    where d.id in (select distinct document_id from nfe_items where review_item_id = ${reviewItemId})`);
}
