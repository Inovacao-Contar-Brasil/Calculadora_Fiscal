-- CF-FOUND-08-R2 (auditoria do PR #10, achado P1).
-- Até esta versão, REJEITADO ignorava a vigência: itens emitidos fora de
-- [valid_from, valid_to] da rejeição recebiam REJEITADO sem decisão que os
-- cobrisse. A regra corrigida (classificationFor) aplica toda decisão final só
-- dentro da vigência; fora dela o item fica PENDENTE_REVISAO e entra na
-- pendência temporal. Esta migração alinha o estado já gravado à regra, apenas
-- no sentido conservador (REJEITADO -> PENDENTE_REVISAO; nunca homologa), sem
-- alterar nenhuma decisão, e registra auditoria por empresa. Idempotente.
-- O status do documento não muda: documento com item REJEITADO já era
-- COM_PENDENCIAS e continua com pendência.
WITH reclassified AS (
  UPDATE "nfe_items" AS i
  SET "classification_status" = 'PENDENTE_REVISAO'
  FROM "review_items" AS r, "nfe_documents" AS d
  WHERE r."id" = i."review_item_id"
    AND d."id" = i."document_id"
    AND r."status" = 'REJEITADO'
    AND i."classification_status" = 'REJEITADO'
    AND (
      (r."valid_from" IS NOT NULL AND substr(d."issued_at", 1, 10) < to_char(r."valid_from", 'YYYY-MM-DD'))
      OR (r."valid_to" IS NOT NULL AND substr(d."issued_at", 1, 10) > to_char(r."valid_to", 'YYYY-MM-DD'))
    )
  RETURNING i."id", i."company_id", i."document_id"
)
INSERT INTO "audit_events" ("organization_id", "company_id", "action", "entity_type", "entity_id", "metadata")
SELECT
  c."organization_id",
  x."company_id",
  'MIGRATION_REJECTION_OUT_OF_VALIDITY_RECLASSIFIED',
  'company',
  x."company_id"::text,
  jsonb_build_object(
    'migration', '0002_rejeicao_fora_da_vigencia',
    'items', count(*),
    'itemIds', jsonb_agg(x."id" ORDER BY x."id"),
    'documentIds', jsonb_agg(DISTINCT x."document_id")
  )
FROM reclassified AS x
JOIN "companies" AS c ON c."id" = x."company_id"
GROUP BY c."organization_id", x."company_id";
