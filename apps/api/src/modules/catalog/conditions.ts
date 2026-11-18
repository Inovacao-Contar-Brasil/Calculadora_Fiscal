import { z } from "zod";
import {
  CEST_PATTERN,
  CFOP_PATTERN,
  NCM_PATTERN,
  PARAMETER_KEY_PATTERN,
  SEGMENT_PATTERN,
  semanticConditionIssues,
  type RuleConditions,
} from "@calculadora-fiscal/domain";

/**
 * Schema versionado das condições de aplicação (RuleConditions v1).
 *
 * - `z.strictObject` em todos os níveis: campo desconhecido (inclusive
 *   `cnae`, `aliquota`, `mva`...) é recusado, nunca ignorado.
 * - A camada (`layer`) discrimina o formato; o backend também confere que ela
 *   bate com a camada da regra.
 * - As regras semânticas (NCM isolado, exclusões fora do escopo, repetições)
 *   vêm do domínio (`semanticConditionIssues`).
 * Esta sprint só cadastra e valida: ninguém interpreta estas condições sobre
 * itens de NF-e antes da 2A.4.
 */

const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"] as const;
const REGIMES = ["SIMPLES_NACIONAL", "LUCRO_PRESUMIDO", "LUCRO_REAL", "MEI", "OUTRO"] as const;
const FINALIDADES = ["REVENDA", "USO_CONSUMO", "INSUMO_INDUSTRIALIZACAO", "ATIVO_IMOBILIZADO"] as const;

const list = <T extends z.ZodType>(item: T, max: number) => z.array(item).min(1).max(max);
const ncm = z.string().regex(NCM_PATTERN, "NCM: 8 dígitos ou prefixo explícito de 4 a 7 dígitos (capítulo isolado não é aceito).");
const cest = z.string().regex(CEST_PATTERN, "CEST deve ter 7 dígitos.");
const segment = z.string().regex(SEGMENT_PATTERN, "Segmento: letras maiúsculas, dígitos e _, de 3 a 64 caracteres, começando por letra.");
const term = z.string().trim().min(2, "Termo de descrição com ao menos 2 caracteres.").max(80);
const cfop = z.string().regex(CFOP_PATTERN, "CFOP: 4 dígitos iniciando por 1, 2, 3, 5, 6 ou 7.");
const parameterKey = z.string().regex(PARAMETER_KEY_PATTERN, "Parâmetro do perfil fiscal: identificador camelCase/snake_case.");

export const classificationConditionsV1 = z.strictObject({
  schemaVersion: z.literal(1),
  layer: z.literal("CLASSIFICACAO"),
  ncm: z.strictObject({ include: list(ncm, 200), exclude: list(ncm, 200).optional() }),
  cest: z.union([z.strictObject({ include: list(cest, 200) }), z.strictObject({ required: z.literal(false) })]).optional(),
  descriptionSignals: z
    .strictObject({
      mustMatchAny: list(term, 50).optional(),
      mustNotMatch: list(term, 50).optional(),
      acceptedAsCriterion: z.boolean().optional(),
    })
    .optional(),
  segment,
});

export const incidenceConditionsV1 = z.strictObject({
  schemaVersion: z.literal(1),
  layer: z.literal("INCIDENCIA"),
  segmentIn: list(segment, 50),
  ufOrigem: list(z.enum(UFS), 27).optional(),
  // Incidência é sempre de uma legislação estadual: UF de destino é obrigatória (salvaguarda; ver docs/CATALOGO_LEGAL.md).
  ufDestino: list(z.enum(UFS), 27),
  regimeDestinatario: list(z.enum(REGIMES), REGIMES.length).optional(),
  contribuinteIcms: z.boolean().optional(),
  finalidade: list(z.enum(FINALIDADES, { message: "Finalidade inválida (NAO_INFORMADA nunca casa e não pode ser condição)." }), FINALIDADES.length).optional(),
  cfop: list(cfop, 100).optional(),
  regimeEspecial: z.strictObject({ requires: list(parameterKey, 30).optional(), excludes: list(parameterKey, 30).optional() }).optional(),
});

export const ruleConditionsSchema = z
  .discriminatedUnion("layer", [classificationConditionsV1, incidenceConditionsV1])
  .superRefine((value, ctx) => {
    for (const issue of semanticConditionIssues(value as RuleConditions)) ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
  });

export type ParsedRuleConditions = z.infer<typeof ruleConditionsSchema>;

// Garantia em tempo de compilação: o schema produz exatamente o tipo do domínio.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _schemaMatchesDomain: Same<ParsedRuleConditions, RuleConditions> = true;
void _schemaMatchesDomain;
