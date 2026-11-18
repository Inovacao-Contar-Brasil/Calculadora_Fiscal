import type { FinalidadeProduto, RegimeTributario, UF } from "../tributario/index.ts";

/**
 * Condições de aplicação das regras do catálogo — schema versionado v1
 * (seção 3.3 de docs/SPRINT2A_ESPECIFICACAO.md).
 *
 * Este módulo define os TIPOS e as regras semânticas puras. A validação de
 * forma (campos desconhecidos, formatos) é feita pelo schema Zod da API
 * (`apps/api/src/modules/catalog/conditions.ts`), que é tipado contra estes
 * tipos. A 2A.1 apenas cadastra e valida condições: nenhuma interpretação
 * automática sobre itens de NF-e acontece aqui (isso é a 2A.4).
 *
 * Deliberadamente NÃO há campos numéricos (alíquota, MVA, base): a 2A não calcula.
 * Deliberadamente NÃO há critério por CNAE: classificação nunca depende só do CNAE.
 */

export const CONDITIONS_SCHEMA_VERSION = 1 as const;

export const RULE_LAYERS = ["CLASSIFICACAO", "INCIDENCIA"] as const;
export type RuleLayer = (typeof RULE_LAYERS)[number];

/** NCM completo (8 dígitos) ou prefixo explícito de 4 a 7 dígitos. Capítulo isolado (2 dígitos) é amplo demais. */
export type NcmPattern = string;

export interface ClassificationConditionsV1 {
  schemaVersion: 1;
  layer: "CLASSIFICACAO";
  ncm: { include: NcmPattern[]; exclude?: NcmPattern[] };
  /** CEST exigido (lista) ou declaração explícita de que o CEST não é critério. */
  cest?: { include: string[] } | { required: false };
  /**
   * Sinais de descrição: termos literais (sem expressão regular). Só servem
   * como segundo critério quando `acceptedAsCriterion` for verdadeiro — a
   * aprovação da versão é a "aprovação explícita" exigida pela especificação.
   */
  descriptionSignals?: { mustMatchAny?: string[]; mustNotMatch?: string[]; acceptedAsCriterion?: boolean };
  /** Segmento normativo resultante da classificação. */
  segment: string;
}

export interface IncidenceConditionsV1 {
  schemaVersion: 1;
  layer: "INCIDENCIA";
  segmentIn: string[];
  ufOrigem?: UF[];
  ufDestino: UF[];
  regimeDestinatario?: RegimeTributario[];
  contribuinteIcms?: boolean;
  /** `NAO_INFORMADA` nunca casa e por isso não é aceita aqui. */
  finalidade?: Exclude<FinalidadeProduto, "NAO_INFORMADA">[];
  cfop?: string[];
  regimeEspecial?: { requires?: string[]; excludes?: string[] };
}

export type RuleConditionsV1 = ClassificationConditionsV1 | IncidenceConditionsV1;
export type RuleConditions = RuleConditionsV1;

export interface ConditionIssue {
  path: (string | number)[];
  message: string;
}

export const NCM_PATTERN = /^\d{4,8}$/;
export const CEST_PATTERN = /^\d{7}$/;
export const SEGMENT_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/;
/** CFOP: 4 dígitos; primeiro dígito 1/2/3 (entradas) ou 5/6/7 (saídas). */
export const CFOP_PATTERN = /^[123567]\d{3}$/;
export const PARAMETER_KEY_PATTERN = /^[a-z][a-zA-Z0-9_]{1,63}$/;

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    const key = value.toLocaleUpperCase("pt-BR");
    if (seen.has(key)) repeated.add(value);
    seen.add(key);
  }
  return [...repeated];
}

function checkUnique(issues: ConditionIssue[], path: (string | number)[], values: readonly string[] | undefined): void {
  if (!values) return;
  const repeated = duplicates(values);
  if (repeated.length) issues.push({ path, message: "Valores repetidos: " + repeated.join(", ") + "." });
}

function checkDisjoint(issues: ConditionIssue[], path: (string | number)[], a: readonly string[] | undefined, b: readonly string[] | undefined, label: string): void {
  if (!a || !b) return;
  const upper = new Set(a.map((v) => v.toLocaleUpperCase("pt-BR")));
  const both = b.filter((v) => upper.has(v.toLocaleUpperCase("pt-BR")));
  if (both.length) issues.push({ path, message: label + ": " + both.join(", ") + "." });
}

/**
 * Regras semânticas que a forma do schema não expressa. Retorna lista vazia
 * quando a condição é aceitável. Função pura e determinística.
 */
export function semanticConditionIssues(conditions: RuleConditions): ConditionIssue[] {
  const issues: ConditionIssue[] = [];
  if (conditions.layer === "CLASSIFICACAO") {
    const { ncm, cest, descriptionSignals } = conditions;
    checkUnique(issues, ["ncm", "include"], ncm.include);
    checkUnique(issues, ["ncm", "exclude"], ncm.exclude);
    checkDisjoint(issues, ["ncm", "exclude"], ncm.include, ncm.exclude, "NCM incluído e excluído ao mesmo tempo");
    for (const [index, pattern] of (ncm.exclude ?? []).entries()) {
      // Exclusão só faz sentido dentro de algum padrão incluído e mais específica que ele.
      if (!ncm.include.some((included) => pattern.startsWith(included) && pattern.length > included.length)) {
        issues.push({ path: ["ncm", "exclude", index], message: "A exclusão " + pattern + " não está contida em nenhum NCM incluído (deve ser mais específica)." });
      }
    }
    if (cest && "include" in cest) checkUnique(issues, ["cest", "include"], cest.include);
    checkUnique(issues, ["descriptionSignals", "mustMatchAny"], descriptionSignals?.mustMatchAny);
    checkUnique(issues, ["descriptionSignals", "mustNotMatch"], descriptionSignals?.mustNotMatch);
    checkDisjoint(issues, ["descriptionSignals"], descriptionSignals?.mustMatchAny, descriptionSignals?.mustNotMatch, "Termo exigido e proibido ao mesmo tempo");

    // Nunca classificar só por NCM (Issue #4): é preciso NCM e mais um critério positivo.
    const hasCest = !!cest && "include" in cest && cest.include.length > 0;
    const hasDescriptionCriterion = !!descriptionSignals?.acceptedAsCriterion && (descriptionSignals.mustMatchAny?.length ?? 0) > 0;
    if (!hasCest && !hasDescriptionCriterion) {
      issues.push({
        path: ["cest"],
        message:
          "Regra de classificação não pode depender só do NCM: informe CEST exigido ou sinais de descrição (mustMatchAny) aceitos expressamente como critério (acceptedAsCriterion: true).",
      });
    }
    if (descriptionSignals?.acceptedAsCriterion && !(descriptionSignals.mustMatchAny?.length)) {
      issues.push({ path: ["descriptionSignals", "acceptedAsCriterion"], message: "Aceitar a descrição como critério exige ao menos um termo em mustMatchAny." });
    }
  } else {
    checkUnique(issues, ["segmentIn"], conditions.segmentIn);
    checkUnique(issues, ["ufOrigem"], conditions.ufOrigem);
    checkUnique(issues, ["ufDestino"], conditions.ufDestino);
    checkUnique(issues, ["regimeDestinatario"], conditions.regimeDestinatario);
    checkUnique(issues, ["finalidade"], conditions.finalidade);
    checkUnique(issues, ["cfop"], conditions.cfop);
    checkUnique(issues, ["regimeEspecial", "requires"], conditions.regimeEspecial?.requires);
    checkUnique(issues, ["regimeEspecial", "excludes"], conditions.regimeEspecial?.excludes);
    checkDisjoint(issues, ["regimeEspecial"], conditions.regimeEspecial?.requires, conditions.regimeEspecial?.excludes, "Parâmetro exigido e excluído ao mesmo tempo");
    if (conditions.regimeEspecial && !conditions.regimeEspecial.requires?.length && !conditions.regimeEspecial.excludes?.length) {
      issues.push({ path: ["regimeEspecial"], message: "regimeEspecial vazio: informe requires ou excludes, ou remova o campo." });
    }
  }
  return issues;
}
