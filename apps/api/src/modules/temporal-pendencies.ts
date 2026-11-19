import type { FastifyInstance } from "fastify";
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { audit } from "../audit/audit.ts";
import { staffCompanyScope } from "../auth/authorize.ts";
import type { Database } from "../db/client.ts";
import { companies, nfeDocuments, nfeItems, reviewItems } from "../db/schema.ts";
import type { ClassificationStatus } from "../db/schema.ts";
import { conflict, notFound, unprocessable } from "../errors.ts";
import { clientIp, idParams, isoDate, requireAuth } from "../http.ts";
import { classificationFor, freePeriods, isFinalDecision, issueDateOf, periodContains, uncoveredPeriods, type Period } from "./classification.ts";
import { decisionSchema, loadReviewForStaff, loadTimeline, lockOpenReview, refreshDocumentStatuses, reviewView, type ReviewRow } from "./review.ts";

/**
 * Pendência temporal (Issue #8, ADR-008): notas de um produto que ficaram
 * PENDENTE_REVISAO porque foram emitidas fora da vigência da decisão final
 * (homologação ou rejeição) à qual estão vinculadas. A decisão é válida e não
 * é alterada; falta uma decisão para o período das notas.
 *
 * É uma PROJEÇÃO, não uma tabela: deriva do estado autoritativo (itens de NF-e
 * e linha do tempo de decisões), então não duplica com reimportações, não
 * diverge do status das notas e desaparece sozinha quando resolvida. Identidade:
 * a decisão final que não cobre as notas (`id` = id do item de revisão).
 * Ação: registrar uma decisão final (homologar ou rejeitar) para um período
 * sem decisão — uma nova versão append-only em `review_items`, nunca uma edição
 * da decisão existente. Somente staff; o cliente continua vendo apenas o
 * status dos itens nos próprios documentos.
 */

const PENDENCY_NOT_FOUND = "Pendência temporal não encontrada.";

/**
 * Item de NF-e pendente vinculado a uma decisão final (homologação ou rejeição):
 * pela regra única, só fica pendente se a vigência da decisão não cobre a emissão.
 */
const outOfValidity = and(inArray(reviewItems.status, ["HOMOLOGADO", "REJEITADO"]), eq(nfeItems.classificationStatus, "PENDENTE_REVISAO"))!;
const issueDay = sql<string>`substr(${nfeDocuments.issuedAt}, 1, 10)`;

interface Origin {
  items: number;
  documents: number;
  firstIssueDate: string;
  lastIssueDate: string;
}

type ReasonCode = "EMISSAO_ANTERIOR_A_VIGENCIA" | "EMISSAO_POSTERIOR_A_VIGENCIA" | "EMISSAO_FORA_DA_VIGENCIA";

function reasonOf(review: ReviewRow, origin: Origin): { reasonCode: ReasonCode; reason: string } {
  const notes = origin.items === 1 ? "Nota emitida" : origin.items + " notas emitidas";
  const decision = review.status === "REJEITADO" ? "da rejeição registrada" : "da classificação homologada";
  const tail = " " + decision + "; a decisão não as cobre e nenhuma decisão foi registrada para esse período.";
  if (review.validFrom && origin.lastIssueDate < review.validFrom) {
    return { reasonCode: "EMISSAO_ANTERIOR_A_VIGENCIA", reason: notes + " antes do início da vigência (" + review.validFrom + ")" + tail };
  }
  if (review.validTo && origin.firstIssueDate > review.validTo) {
    return { reasonCode: "EMISSAO_POSTERIOR_A_VIGENCIA", reason: notes + " depois do fim da vigência (" + review.validTo + ")" + tail };
  }
  return { reasonCode: "EMISSAO_FORA_DA_VIGENCIA", reason: notes + " fora da vigência (" + (review.validFrom ?? "início indefinido") + " a " + (review.validTo ?? "em aberto") + ")" + tail };
}

export const pendencyView = (review: ReviewRow, companyName: string, origin: Origin) => ({
  id: review.id,
  kind: "FORA_DA_VIGENCIA" as const,
  ...reasonOf(review, origin),
  organizationId: review.organizationId,
  companyId: review.companyId,
  companyName,
  product: { fingerprint: review.fingerprint, ncm: review.ncm, cest: review.cest, description: review.description },
  decision: { id: review.id, status: review.status, validFrom: review.validFrom, validTo: review.validTo },
  origin,
  action: "REGISTRAR_DECISAO_DO_PERIODO" as const,
});
export type PendencyView = ReturnType<typeof pendencyView>;

/** Projeção: uma pendência por decisão final com notas pendentes fora da sua vigência. */
async function listPendencies(db: Database, where: SQL, limit: number, offset = 0): Promise<PendencyView[]> {
  const rows = await db
    .select({
      review: reviewItems,
      companyName: companies.legalName,
      items: sql<number>`count(${nfeItems.id})::int`,
      documents: sql<number>`count(distinct ${nfeItems.documentId})::int`,
      firstIssueDate: sql<string>`min(${issueDay})`,
      lastIssueDate: sql<string>`max(${issueDay})`,
    })
    .from(reviewItems)
    .innerJoin(companies, eq(companies.id, reviewItems.companyId))
    .innerJoin(nfeItems, eq(nfeItems.reviewItemId, reviewItems.id))
    .innerJoin(nfeDocuments, eq(nfeDocuments.id, nfeItems.documentId))
    .where(and(where, outOfValidity))
    .groupBy(reviewItems.id, companies.legalName)
    .orderBy(desc(sql`max(${nfeDocuments.importedAt})`), reviewItems.id)
    .limit(limit)
    .offset(offset);
  return rows.map((r) => pendencyView(r.review, r.companyName, { items: r.items, documents: r.documents, firstIssueDate: r.firstIssueDate, lastIssueDate: r.lastIssueDate }));
}

async function loadPendency(db: Database, reviewId: string): Promise<PendencyView | null> {
  return (await listPendencies(db, eq(reviewItems.id, reviewId), 1))[0] ?? null;
}

/** Total de pendências no escopo (para a listagem nunca truncar em silêncio). */
async function countPendencies(db: Database, where: SQL): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(distinct ${reviewItems.id})::int` })
    .from(reviewItems)
    .innerJoin(nfeItems, eq(nfeItems.reviewItemId, reviewItems.id))
    .where(and(where, outOfValidity));
  return row?.count ?? 0;
}

const pageOf = (limit: number, offset: number, total: number) => ({ limit, offset, total, hasMore: offset + limit < total });

const resolveSchema = z
  .object({
    status: z.enum(["HOMOLOGADO", "REJEITADO"]),
    validFrom: isoDate,
    /** Opcional: padrão = fim da lacuna de vigência que contém `validFrom`. */
    validTo: isoDate.optional(),
    decision: decisionSchema.optional(),
    justification: z.string().trim().min(3).max(2000),
  })
  .refine((b) => (b.status === "HOMOLOGADO" ? !!b.decision : true), {
    message: "Homologar o período exige decisão (enquadramento + fundamento legal).",
  });

const overlaps = (a: Period, b: Period) => (a.from === null || b.to === null || a.from <= b.to) && (b.from === null || a.to === null || b.from <= a.to);

export async function temporalPendencyRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/api/temporal-pendencies",
    {
      schema: {
        querystring: z.object({
          companyId: z.uuid().optional(),
          limit: z.coerce.number().int().min(1).max(200).default(100),
          offset: z.coerce.number().int().min(0).default(0),
        }),
      },
    },
    async (request) => {
      const principal = requireAuth(request);
      const { limit, offset } = request.query;
      const companyIds = await staffCompanyScope(app.db, principal, request.query.companyId);
      if (!companyIds.length) return { items: [], page: pageOf(limit, offset, 0) };
      const scope = inArray(reviewItems.companyId, companyIds);
      return { items: await listPendencies(app.db, scope, limit, offset), page: pageOf(limit, offset, await countPendencies(app.db, scope)) };
    },
  );

  app.get(
    "/api/temporal-pendencies/:id",
    {
      schema: {
        params: idParams,
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(500).default(100),
          offset: z.coerce.number().int().min(0).default(0),
        }),
      },
    },
    async (request) => {
    const principal = requireAuth(request);
    // Escopo antes do papel; sem pendência = mesmo corpo de inexistente.
    const row = await loadReviewForStaff(app.db, principal, request.params.id, PENDENCY_NOT_FOUND);
    const pendency = await loadPendency(app.db, row.id);
    if (!pendency) throw notFound(PENDENCY_NOT_FOUND);
    const { limit, offset } = request.query;
    const pending = and(eq(nfeItems.reviewItemId, row.id), outOfValidity);
    // Ocorrências paginadas, em ordem estável (emissão, documento, linha, item).
    const occurrences = await app.db
      .select({ nfeItemId: nfeItems.id, documentId: nfeDocuments.id, number: nfeDocuments.number, issuedAt: nfeDocuments.issuedAt, issuerName: nfeDocuments.issuerName, line: nfeItems.line, productCents: nfeItems.productCents })
      .from(nfeItems)
      .innerJoin(nfeDocuments, eq(nfeDocuments.id, nfeItems.documentId))
      .innerJoin(reviewItems, eq(reviewItems.id, nfeItems.reviewItemId))
      .where(pending)
      .orderBy(nfeDocuments.issuedAt, nfeDocuments.id, nfeItems.line, nfeItems.id)
      .limit(limit)
      .offset(offset);
    // Lacunas calculadas sobre TODAS as notas pendentes (agregadas por dia), nunca sobre a
    // página: a visão administrativa não pode omitir intervalos (auditoria do PR #10, P2).
    const days = await app.db
      .select({ issueDate: issueDay, items: sql<number>`count(*)::int` })
      .from(nfeItems)
      .innerJoin(nfeDocuments, eq(nfeDocuments.id, nfeItems.documentId))
      .innerJoin(reviewItems, eq(reviewItems.id, nfeItems.reviewItemId))
      .where(pending)
      .groupBy(issueDay);
    const timeline = await loadTimeline(app.db, row.companyId, row.fingerprint);
    return {
      pendency,
      // Onde uma decisão do período pode ser registrada sem tocar em decisão existente.
      uncoveredPeriods: uncoveredPeriods(timeline, days),
      occurrences,
      page: pageOf(limit, offset, pendency.origin.items),
      decisions: timeline
        .filter(isFinalDecision)
        .sort((a, b) => (a.validFrom ?? "").localeCompare(b.validFrom ?? ""))
        .map((d) => ({ id: d.id, status: d.status, validFrom: d.validFrom, validTo: d.validTo })),
    };
  },
  );

  /**
   * Resolve a pendência registrando uma decisão final para um período sem
   * decisão. A homologação que originou a pendência não é alterada; as notas
   * do período passam a seguir a nova decisão (mesma regra classificationFor).
   */
  app.post("/api/temporal-pendencies/:id/resolve", { schema: { params: idParams, body: resolveSchema } }, async (request, reply) => {
    const principal = requireAuth(request);
    const row = await loadReviewForStaff(app.db, principal, request.params.id, PENDENCY_NOT_FOUND);
    // Só uma decisão final tem vigência e pode deixar notas fora dela (status final: não muda).
    if (!isFinalDecision(row)) throw notFound(PENDENCY_NOT_FOUND);
    const body = request.body;

    const created = await app.db.transaction(async (tx) => {
      // Mesmo lock de decisões, reaberturas e importações do produto: a linha do
      // tempo lida aqui não muda até o commit.
      // Se uma reabertura concorrente encerrou o item aberto enquanto esperávamos, o
      // FOR UPDATE não devolve linha (a versão nova não casa mais) e não há lock: conflito.
      const open = await lockOpenReview(tx, row.companyId, row.fingerprint);
      if (!open) throw conflict("A decisão foi alterada por outra pessoa. Recarregue e tente novamente.");
      const timeline = await loadTimeline(tx, row.companyId, row.fingerprint);
      const current = timeline.find((r) => r.id === row.id);
      if (!current || current.validFrom !== row.validFrom || current.validTo !== row.validTo) {
        throw conflict("A decisão foi alterada por outra pessoa. Recarregue e tente novamente.");
      }

      const from = body.validFrom;
      const gap = freePeriods(timeline).find((p) => periodContains(p, from));
      const to = body.validTo ?? gap?.to ?? null;
      if (to === null) throw unprocessable("Informe o fim do período da decisão.");
      if (from > to) throw unprocessable("O início do período não pode ser posterior ao fim.");
      const period = { from, to };
      if (overlaps(period, { from: current.validFrom, to: current.validTo })) {
        throw unprocessable(
          "O período deve ficar fora da vigência da decisão que originou a pendência (" + (current.validFrom ?? "sem início") + " a " + (current.validTo ?? "em aberto") + "), que não é alterada.",
        );
      }
      // Vigências de decisões finais são disjuntas: o período inteiro tem de caber numa lacuna.
      if (!gap || (gap.to !== null && to > gap.to)) {
        throw conflict("O período se sobrepõe à vigência de outra decisão deste produto. Recarregue e escolha um período sem decisão.");
      }

      // Itens do produto emitidos no período. Nenhum é coberto por outra decisão (o período
      // está numa lacuna), logo todos passam a pertencer à decisão do período (selectReviewFor).
      const inPeriod = await tx
        .select({ id: nfeItems.id, documentId: nfeItems.documentId, reviewItemId: nfeItems.reviewItemId, classificationStatus: nfeItems.classificationStatus, issuedAt: nfeDocuments.issuedAt })
        .from(nfeItems)
        .innerJoin(nfeDocuments, eq(nfeDocuments.id, nfeItems.documentId))
        .where(and(eq(nfeItems.companyId, row.companyId), eq(nfeItems.fingerprint, row.fingerprint), sql`${issueDay} between ${from} and ${to}`))
        .orderBy(nfeDocuments.issuedAt);
      const resolved = inPeriod.filter((i) => i.reviewItemId === row.id && i.classificationStatus === "PENDENTE_REVISAO");
      if (!resolved.length) throw unprocessable("Nenhuma nota desta pendência foi emitida no período informado.");

      const documentIds = [...new Set(inPeriod.map((i) => i.documentId))];
      const [decision] = await tx
        .insert(reviewItems)
        .values({
          organizationId: row.organizationId,
          companyId: row.companyId,
          fingerprint: row.fingerprint,
          ncm: row.ncm,
          cest: row.cest,
          description: row.description,
          status: body.status,
          occurrences: documentIds.length,
          firstDocumentId: documentIds[0]!,
          lastDocumentId: documentIds[documentIds.length - 1]!,
          decision: body.decision ?? null,
          justification: body.justification,
          decidedBy: principal.userId,
          decidedAt: new Date(),
          validFrom: from,
          validTo: to,
        })
        .returning();

      const byStatus = new Map<ClassificationStatus, string[]>();
      for (const item of inPeriod) {
        const status = classificationFor(decision!, issueDateOf(item.issuedAt));
        byStatus.set(status, [...(byStatus.get(status) ?? []), item.id]);
      }
      for (const [status, ids] of byStatus) {
        for (let i = 0; i < ids.length; i += 500) {
          await tx.update(nfeItems).set({ reviewItemId: decision!.id, classificationStatus: status }).where(inArray(nfeItems.id, ids.slice(i, i + 500)));
        }
      }
      await refreshDocumentStatuses(tx, decision!.id);

      await audit(tx, {
        actorUserId: principal.userId,
        organizationId: row.organizationId,
        companyId: row.companyId,
        action: "TEMPORAL_PENDENCY_RESOLVED",
        entityType: "temporal_pendency",
        entityId: row.id,
        metadata: {
          decisionId: decision!.id,
          status: body.status,
          validFrom: from,
          validTo: to,
          fingerprint: row.fingerprint,
          items: inPeriod.length,
          resolvedItems: resolved.map((i) => i.id),
          documentIds,
          decision: body.decision ?? null,
        },
        ip: clientIp(request),
      });
      return decision!;
    });

    reply.code(201);
    return { decision: reviewView(created), pendency: await loadPendency(app.db, row.id) };
  });
}
