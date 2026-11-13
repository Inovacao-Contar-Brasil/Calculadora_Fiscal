import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { MAX_XML_BYTES, parseNfe, productFingerprint, type Invoice } from "@calculadora-fiscal/domain";
import { audit } from "../audit/audit.ts";
import { loadAccessibleCompany, type Company } from "../auth/authorize.ts";
import type { Principal } from "../auth/session.ts";
import type { Database } from "../db/client.ts";
import { nfeDocuments, nfeItems, reviewItems } from "../db/schema.ts";
import type { ClassificationStatus } from "../db/schema.ts";
import { badRequest, unprocessable } from "../errors.ts";
import { clientIp, idParams, requireAuth } from "../http.ts";

type DocumentRow = typeof nfeDocuments.$inferSelect;
type ItemRow = typeof nfeItems.$inferSelect;

export const documentView = (d: DocumentRow) => ({
  id: d.id,
  companyId: d.companyId,
  accessKey: d.accessKey,
  sha256: d.sha256,
  fileName: d.fileName,
  number: d.number,
  series: d.series,
  issuedAt: d.issuedAt,
  operation: d.operation,
  issuer: { document: d.issuerDocument, name: d.issuerName, state: d.issuerUf },
  recipient: { document: d.recipientDocument, name: d.recipientName, state: d.recipientUf },
  totals: d.totals,
  warnings: d.warnings,
  itemCount: d.itemCount,
  status: d.status,
  importedBy: d.importedBy,
  importedAt: d.importedAt.toISOString(),
});

export const itemView = (i: ItemRow) => ({
  id: i.id,
  line: i.line,
  code: i.code,
  description: i.description,
  ncm: i.ncm,
  cest: i.cest,
  cfop: i.cfop,
  quantity: i.quantity,
  unit: i.unit,
  unitPrice: i.unitPrice,
  productCents: i.productCents,
  freightCents: i.freightCents,
  insuranceCents: i.insuranceCents,
  discountCents: i.discountCents,
  otherCents: i.otherCents,
  declaredTaxes: i.declaredTaxes,
  fingerprint: i.fingerprint,
  classificationStatus: i.classificationStatus,
  reviewItemId: i.reviewItemId,
});

export interface ImportResult {
  document: DocumentRow;
  duplicate: boolean;
  contentDiffers: boolean;
  pendingCount: number;
}

/** Retorna a classificação a aplicar a um item a partir da decisão vigente (memória) — nunca um cálculo. */
function statusFromReview(review: typeof reviewItems.$inferSelect | undefined, issueDate: string): ClassificationStatus {
  if (!review) return "PENDENTE_REVISAO";
  if (review.status === "HOMOLOGADO" || review.status === "REJEITADO") {
    const startsBefore = !review.validFrom || review.validFrom <= issueDate;
    const endsAfter = !review.validTo || review.validTo >= issueDate;
    return startsBefore && endsAfter ? review.status : "PENDENTE_REVISAO";
  }
  return review.status;
}

/**
 * Importa uma NF-e para a empresa. Idempotente por (empresa, chave de acesso):
 * reimportar a mesma nota devolve o documento já existente, sem gravar nada.
 */
export async function importNfe(
  db: Database,
  principal: Principal,
  company: Company,
  rawXml: string,
  fileName: string | null,
  ip: string | null,
): Promise<ImportResult> {
  let invoice: Invoice;
  try {
    invoice = parseNfe(rawXml);
  } catch (error) {
    throw unprocessable(error instanceof Error ? error.message : "XML inválido.");
  }
  if (!/^\d{44}$/.test(invoice.accessKey)) throw unprocessable("NF-e sem chave de acesso válida; não é possível registrar o documento.");
  if (invoice.recipient.document.replace(/\D/g, "") !== company.cnpj) {
    throw unprocessable("O destinatário da NF-e (" + invoice.recipient.document + ") não corresponde ao CNPJ da empresa selecionada.");
  }

  const sha256 = createHash("sha256").update(rawXml, "utf8").digest("hex");
  const issueDate = invoice.issuedAt.slice(0, 10);

  const findExisting = () =>
    db
      .select()
      .from(nfeDocuments)
      .where(and(eq(nfeDocuments.companyId, company.id), eq(nfeDocuments.accessKey, invoice.accessKey)))
      .limit(1)
      .then((rows) => rows[0]);

  const existing = await findExisting();
  if (existing) {
    await audit(db, { actorUserId: principal.userId, organizationId: company.organizationId, companyId: company.id, action: "NFE_IMPORT_DUPLICATE", entityType: "nfe_document", entityId: existing.id, metadata: { accessKey: invoice.accessKey, contentDiffers: existing.sha256 !== sha256 }, ip });
    const pending = await countPending(db, existing.id);
    return { document: existing, duplicate: true, contentDiffers: existing.sha256 !== sha256, pendingCount: pending };
  }

  try {
    return await db.transaction(async (tx) => {
      const [doc] = await tx
        .insert(nfeDocuments)
        .values({
          organizationId: company.organizationId,
          companyId: company.id,
          accessKey: invoice.accessKey,
          sha256,
          rawXml,
          fileName,
          number: invoice.number,
          series: invoice.series,
          issuedAt: invoice.issuedAt,
          operation: invoice.operation,
          issuerDocument: invoice.issuer.document,
          issuerName: invoice.issuer.name,
          issuerUf: invoice.issuer.state,
          recipientDocument: invoice.recipient.document,
          recipientName: invoice.recipient.name,
          recipientUf: invoice.recipient.state,
          totals: invoice.totals,
          warnings: invoice.warnings,
          itemCount: invoice.items.length,
          status: "IMPORTADA",
          importedBy: principal.userId,
        })
        .returning();

      // Um review_item por produto distinto (fingerprint) e empresa, enquanto vigente.
      const byFingerprint = new Map<string, typeof reviewItems.$inferSelect>();
      let pendingCount = 0;
      for (const item of invoice.items) {
        const fingerprint = productFingerprint(item);
        let review = byFingerprint.get(fingerprint);
        if (!review) {
          const open = (
            await tx
              .select()
              .from(reviewItems)
              .where(and(eq(reviewItems.companyId, company.id), eq(reviewItems.fingerprint, fingerprint), isNull(reviewItems.validTo)))
              .limit(1)
          )[0];
          if (open) {
            const [updated] = await tx
              .update(reviewItems)
              .set({ occurrences: sql`${reviewItems.occurrences} + 1`, lastDocumentId: doc!.id, updatedAt: new Date() })
              .where(eq(reviewItems.id, open.id))
              .returning();
            review = updated!;
          } else {
            const [created] = await tx
              .insert(reviewItems)
              .values({
                organizationId: company.organizationId,
                companyId: company.id,
                fingerprint,
                ncm: item.ncm,
                cest: item.cest,
                description: item.description,
                status: "PENDENTE_REVISAO",
                firstDocumentId: doc!.id,
                lastDocumentId: doc!.id,
              })
              .returning();
            review = created!;
          }
          byFingerprint.set(fingerprint, review);
        }
        const status = statusFromReview(review, issueDate);
        if (status !== "HOMOLOGADO") pendingCount += 1;
        await tx.insert(nfeItems).values({
          documentId: doc!.id,
          companyId: company.id,
          line: item.line,
          code: item.code,
          description: item.description,
          ncm: item.ncm,
          cest: item.cest,
          cfop: item.cfop,
          quantity: item.quantity,
          unit: item.unit,
          unitPrice: item.unitPrice,
          productCents: item.productCents,
          freightCents: item.freightCents,
          insuranceCents: item.insuranceCents,
          discountCents: item.discountCents,
          otherCents: item.otherCents,
          declaredTaxes: { ...item.declaredTaxes },
          fingerprint,
          classificationStatus: status,
          reviewItemId: review.id,
        });
      }

      const [finalDoc] = await tx
        .update(nfeDocuments)
        .set({ status: pendingCount > 0 ? "COM_PENDENCIAS" : "REVISADA" })
        .where(eq(nfeDocuments.id, doc!.id))
        .returning();

      await audit(tx, {
        actorUserId: principal.userId,
        organizationId: company.organizationId,
        companyId: company.id,
        action: "NFE_IMPORTED",
        entityType: "nfe_document",
        entityId: doc!.id,
        metadata: { accessKey: invoice.accessKey, sha256, items: invoice.items.length, pendingItems: pendingCount, warnings: invoice.warnings.length },
        ip,
      });
      return { document: finalDoc!, duplicate: false, contentDiffers: false, pendingCount };
    });
  } catch (error) {
    // Corrida entre duas importações da mesma nota: a segunda bate no índice único.
    const raced = await findExisting();
    if (raced) return { document: raced, duplicate: true, contentDiffers: raced.sha256 !== sha256, pendingCount: await countPending(db, raced.id) };
    throw error;
  }
}

async function countPending(db: Database, documentId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(nfeItems)
    .where(and(eq(nfeItems.documentId, documentId), sql`${nfeItems.classificationStatus} <> 'HOMOLOGADO'`));
  return row?.count ?? 0;
}

export async function documentRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post(
    "/api/companies/:id/documents",
    {
      bodyLimit: MAX_XML_BYTES + 64 * 1024,
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      schema: { params: idParams, querystring: z.object({ fileName: z.string().max(255).optional() }) },
    },
    async (request, reply) => {
      const principal = requireAuth(request);
      const { company } = await loadAccessibleCompany(app.db, principal, request.params.id);
      if (typeof request.body !== "string") throw badRequest("Envie o XML no corpo da requisição com Content-Type application/xml.");
      if (!company.active) throw unprocessable("Empresa inativa.");
      const result = await importNfe(app.db, principal, company, request.body, request.query.fileName ?? null, clientIp(request));
      reply.code(result.duplicate ? 200 : 201);
      return { document: documentView(result.document), duplicate: result.duplicate, contentDiffers: result.contentDiffers, pendingCount: result.pendingCount };
    },
  );

  app.get(
    "/api/companies/:id/documents",
    { schema: { params: idParams, querystring: z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), offset: z.coerce.number().int().min(0).default(0) }) } },
    async (request) => {
      const principal = requireAuth(request);
      const { company } = await loadAccessibleCompany(app.db, principal, request.params.id);
      const rows = await app.db
        .select()
        .from(nfeDocuments)
        .where(eq(nfeDocuments.companyId, company.id))
        .orderBy(desc(nfeDocuments.importedAt))
        .limit(request.query.limit)
        .offset(request.query.offset);
      const [total] = await app.db.select({ count: sql<number>`count(*)::int` }).from(nfeDocuments).where(eq(nfeDocuments.companyId, company.id));
      return { documents: rows.map(documentView), total: total?.count ?? 0 };
    },
  );

  app.get("/api/documents/:id", { schema: { params: idParams } }, async (request) => {
    const principal = requireAuth(request);
    const doc = (await app.db.select().from(nfeDocuments).where(eq(nfeDocuments.id, request.params.id)).limit(1))[0];
    // Verifica o escopo pela empresa do documento; fora dele, 404.
    const { company } = await loadAccessibleCompany(app.db, principal, doc?.companyId ?? "00000000-0000-0000-0000-000000000000");
    const items = await app.db.select().from(nfeItems).where(eq(nfeItems.documentId, doc!.id)).orderBy(nfeItems.line);
    return { document: documentView(doc!), company: { id: company.id, legalName: company.legalName }, items: items.map(itemView) };
  });

  app.get("/api/documents/:id/xml", { schema: { params: idParams } }, async (request, reply) => {
    const principal = requireAuth(request);
    const doc = (await app.db.select().from(nfeDocuments).where(eq(nfeDocuments.id, request.params.id)).limit(1))[0];
    const { company } = await loadAccessibleCompany(app.db, principal, doc?.companyId ?? "00000000-0000-0000-0000-000000000000");
    await audit(app.db, { actorUserId: principal.userId, organizationId: company.organizationId, companyId: company.id, action: "NFE_XML_DOWNLOADED", entityType: "nfe_document", entityId: doc!.id, ip: clientIp(request) });
    reply.header("Content-Type", "application/xml; charset=utf-8");
    reply.header("Content-Disposition", 'attachment; filename="' + doc!.accessKey + '.xml"');
    return doc!.rawXml;
  });
}
