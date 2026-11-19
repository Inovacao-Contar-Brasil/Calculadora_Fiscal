import type { ClassificationStatus } from "../db/schema.ts";

/** Campos do item de revisão que determinam a classificação de um item de NF-e. */
export interface ReviewDecisionState {
  status: ClassificationStatus;
  validFrom: string | null;
  validTo: string | null;
}

/**
 * Regra ÚNICA que diz qual classificação um item de NF-e recebe a partir do
 * item de revisão ao qual está vinculado (ver `selectReviewFor`). Usada na
 * importação (`importNfe`), na propagação após cada decisão
 * (`applyReviewToItems`), na reabertura e na resolução de pendência temporal.
 * Nunca calcula imposto.
 *
 * - Sem item de revisão: PENDENTE_REVISAO.
 * - PENDENTE_REVISAO / EM_ANALISE: estado de fluxo, vale para todos os itens.
 * - REJEITADO: vale para todos os itens vinculados (é o lado seguro; nunca libera valor).
 * - HOMOLOGADO: só para notas emitidas dentro de [validFrom, validTo]
 *   (datas YYYY-MM-DD, inclusivas). Fora da vigência: PENDENTE_REVISAO — uma
 *   homologação com início em dezembro não homologa nota de outubro, e uma
 *   decisão encerrada por mudança legal não cobre notas posteriores. Essas
 *   notas formam a pendência temporal (`temporal-pendencies.ts`).
 */
export function classificationFor(review: ReviewDecisionState | undefined, issueDate: string): ClassificationStatus {
  if (!review) return "PENDENTE_REVISAO";
  if (review.status !== "HOMOLOGADO") return review.status;
  const startsBefore = !review.validFrom || review.validFrom <= issueDate;
  const endsAfter = !review.validTo || review.validTo >= issueDate;
  return startsBefore && endsAfter ? "HOMOLOGADO" : "PENDENTE_REVISAO";
}

const FINAL: ReadonlySet<ClassificationStatus> = new Set(["HOMOLOGADO", "REJEITADO"]);

export function isFinalDecision(review: Pick<ReviewDecisionState, "status">): boolean {
  return FINAL.has(review.status);
}

/** Uma decisão final (homologada ou rejeitada) cobre as notas emitidas dentro da sua vigência. */
export function decisionCovers(review: ReviewDecisionState, issueDate: string): boolean {
  if (!isFinalDecision(review)) return false;
  return (!review.validFrom || review.validFrom <= issueDate) && (!review.validTo || review.validTo >= issueDate);
}

/**
 * Regra ÚNICA de VÍNCULO: a qual item de revisão um item de NF-e pertence.
 *
 * 1. À decisão final do produto cuja vigência contém a data de emissão;
 * 2. senão, ao item aberto do produto (`valid_to IS NULL`), a análise em curso.
 *
 * As vigências das decisões finais de um mesmo produto e empresa são
 * disjuntas (garantido em todas as escritas, sob lock do item aberto), então
 * no máximo uma cobre a data e o resultado não depende da ordem em que as
 * notas foram importadas nem de quando a decisão foi tomada. Se dados antigos
 * violarem isso (duas decisões encerradas cobrindo a data), nenhuma é
 * escolhida: a nota fica com o item aberto, sem homologação presumida.
 */
export function selectReviewFor<T extends ReviewDecisionState>(open: T, others: readonly T[], issueDate: string): T {
  if (decisionCovers(open, issueDate)) return open;
  const covering = others.filter((review) => review !== open && decisionCovers(review, issueDate));
  return covering.length === 1 ? covering[0]! : open;
}

/** Data de emissão (YYYY-MM-DD) a partir de `dhEmi` ISO com fuso, sem conversão de fuso. */
export function issueDateOf(issuedAt: string): string {
  return issuedAt.slice(0, 10);
}

/** Desloca uma data ISO (YYYY-MM-DD) em dias, em UTC. */
export function shiftDay(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

/** Intervalo fechado de datas; `null` = sem limite (−∞ em `from`, +∞ em `to`). */
export interface Period {
  from: string | null;
  to: string | null;
}

/**
 * Períodos sem decisão final: o complemento da união das vigências das
 * decisões homologadas/rejeitadas do produto. É onde uma decisão do período
 * pode ser registrada sem tocar em nenhuma decisão existente.
 */
export function freePeriods(decisions: readonly ReviewDecisionState[]): Period[] {
  const intervals = decisions
    .filter(isFinalDecision)
    .map((d) => ({ from: d.validFrom, to: d.validTo }))
    .sort((a, b) => (a.from === b.from ? 0 : a.from === null ? -1 : b.from === null ? 1 : a.from.localeCompare(b.from)));
  const free: Period[] = [];
  // `cursor` = primeiro dia ainda não coberto; null = −∞ (antes da primeira decisão).
  let cursor: string | null = null;
  for (const interval of intervals) {
    if (interval.from !== null && (cursor === null || interval.from > cursor)) free.push({ from: cursor, to: shiftDay(interval.from, -1) });
    if (interval.to === null) return free;
    const next = shiftDay(interval.to, 1);
    if (cursor === null || next > cursor) cursor = next;
  }
  free.push({ from: cursor, to: null });
  return free;
}

export function periodContains(period: Period, date: string): boolean {
  return (period.from === null || period.from <= date) && (period.to === null || period.to >= date);
}

/** Lacunas de vigência que contêm notas pendentes, com a quantidade de itens em cada uma. */
export function uncoveredPeriods(decisions: readonly ReviewDecisionState[], pendingIssueDates: readonly string[]): (Period & { items: number })[] {
  return freePeriods(decisions)
    .map((period) => ({ ...period, items: pendingIssueDates.filter((date) => periodContains(period, date)).length }))
    .filter((period) => period.items > 0);
}
