import type { ClassificationStatus } from "../db/schema.ts";

/** Campos do item de revisão que determinam a classificação de um item de NF-e. */
export interface ReviewDecisionState {
  status: ClassificationStatus;
  validFrom: string | null;
  validTo: string | null;
}

/**
 * Regra ÚNICA que diz qual classificação um item de NF-e recebe a partir do
 * item de revisão (memória de decisão) do mesmo produto. Usada na importação
 * (`importNfe`) e na propagação após cada decisão (`applyReviewToItems`), para
 * que o mesmo produto nunca fique com status contraditórios conforme a ordem
 * em que as notas chegaram. Nunca calcula imposto.
 *
 * - Sem item de revisão: PENDENTE_REVISAO.
 * - PENDENTE_REVISAO / EM_ANALISE: estado de fluxo, vale para todos os itens.
 * - REJEITADO: vale para todos os itens (é o lado seguro; nunca libera valor).
 * - HOMOLOGADO: só para notas emitidas dentro de [validFrom, validTo]
 *   (datas YYYY-MM-DD, inclusivas). Fora da vigência: PENDENTE_REVISAO — uma
 *   homologação com início em dezembro não homologa nota de outubro, e uma
 *   decisão encerrada por mudança legal não cobre notas posteriores.
 */
export function classificationFor(review: ReviewDecisionState | undefined, issueDate: string): ClassificationStatus {
  if (!review) return "PENDENTE_REVISAO";
  if (review.status !== "HOMOLOGADO") return review.status;
  const startsBefore = !review.validFrom || review.validFrom <= issueDate;
  const endsAfter = !review.validTo || review.validTo >= issueDate;
  return startsBefore && endsAfter ? "HOMOLOGADO" : "PENDENTE_REVISAO";
}

/** Data de emissão (YYYY-MM-DD) a partir de `dhEmi` ISO com fuso, sem conversão de fuso. */
export function issueDateOf(issuedAt: string): string {
  return issuedAt.slice(0, 10);
}
