/**
 * Contratos do motor tributário da Calculadora Fiscal.
 *
 * ATENÇÃO: este módulo define APENAS interfaces e tipos. Nenhuma fórmula de
 * ICMS-ST, antecipação, MVA, alíquota ou rateio está implementada aqui, e
 * nenhuma deve ser implementada sem caso real conferido e homologação expressa
 * do setor Fiscal (ver Issue #3 e docs/VALIDACAO_FISCAL.md).
 *
 * As implementações concretas entram em módulos separados, uma por regra
 * homologada, com testes de regressão item a item.
 */

import type { Invoice, InvoiceItem } from "../nfe/parser.ts";

/** Valores monetários em centavos inteiros. Nunca usar ponto flutuante para dinheiro. */
export type Cents = number;

/** Percentuais em "pontos-base de centésimo": 18,00% => 1800. Evita frações binárias. */
export type BasisPoints = number;

export type UF =
  | "AC" | "AL" | "AP" | "AM" | "BA" | "CE" | "DF" | "ES" | "GO" | "MA" | "MT" | "MS" | "MG"
  | "PA" | "PB" | "PR" | "PE" | "PI" | "RJ" | "RN" | "RS" | "RO" | "RR" | "SC" | "SP" | "SE" | "TO";

export type RegimeTributario =
  | "SIMPLES_NACIONAL"
  | "LUCRO_PRESUMIDO"
  | "LUCRO_REAL"
  | "MEI"
  | "OUTRO";

/** Finalidade declarada pelo cliente para cada produto. Afeta o enquadramento. */
export type FinalidadeProduto =
  | "REVENDA"
  | "USO_CONSUMO"
  | "INSUMO_INDUSTRIALIZACAO"
  | "ATIVO_IMOBILIZADO"
  | "NAO_INFORMADA";

/**
 * Estado de uma classificação tributária. Enquanto não houver homologação,
 * o cliente só pode ver `PENDENTE_REVISAO` — nunca um valor definitivo.
 */
export type ClassificationStatus =
  | "PENDENTE_REVISAO"
  | "EM_ANALISE"
  | "HOMOLOGADO"
  | "REJEITADO";

/** Intervalo de vigência. `validTo` nulo significa vigente até nova decisão. */
export interface Vigencia {
  validFrom: string; // ISO date (YYYY-MM-DD)
  validTo: string | null;
}

/** Contexto fiscal da empresa destinatária, vindo do cadastro controlado pela contabilidade. */
export interface FiscalContext {
  companyId: string;
  uf: UF;
  regime: RegimeTributario;
  cnaes: string[];
  contribuinteIcms: boolean;
  /** Parâmetros adicionais definidos pelo Fiscal (regimes especiais, TTDs, etc.). */
  parameters: Record<string, unknown>;
  vigencia: Vigencia;
}

/** 1. Identificação de produto — reduz um item de NF-e a uma identidade comparável. */
export interface ProductIdentity {
  /** Chave estável derivada de NCM + CEST + descrição normalizada (+ código do fornecedor quando houver). */
  fingerprint: string;
  code: string;
  description: string;
  ncm: string;
  cest: string | null;
  cfop: string;
  origin: string;
}

export interface ProductIdentifier {
  identify(item: InvoiceItem, invoice: Invoice): ProductIdentity;
}

/** 2. Classificação tributária — decide o enquadramento OU encaminha para revisão. */
export interface ClassificationRequest {
  identity: ProductIdentity;
  finalidade: FinalidadeProduto;
  context: FiscalContext;
  /** Data do fato gerador (emissão/entrada), usada para escolher a regra vigente. */
  referenceDate: string;
  issuerUf: UF;
}

export interface ClassificationResult {
  status: ClassificationStatus;
  /** Regras aplicáveis identificadas (pode ser vazio quando pendente). */
  ruleIds: string[];
  /** Motivo legível para o Fiscal quando `PENDENTE_REVISAO`/`REJEITADO`. */
  reason: string | null;
  /** Classificação anterior reaproveitada (memória), se houver e ainda vigente. */
  reusedDecisionId: string | null;
}

export interface TaxClassifier {
  classify(request: ClassificationRequest): Promise<ClassificationResult>;
}

/** 3. Catálogo de regras legais com vigência e fundamento. */
export type LegalRuleKind = "ICMS_ST" | "ANTECIPACAO" | "ALIQUOTA_INTERNA" | "MVA" | "ISENCAO" | "REDUCAO_BASE" | "OUTRO";

export interface LegalRule {
  id: string;
  kind: LegalRuleKind;
  uf: UF;
  /** Fundamento legal obrigatório: norma, artigo/anexo, link oficial. */
  legalBasis: { norma: string; artigo: string; url: string | null };
  vigencia: Vigencia;
  /** Condições de aplicação (NCM, CEST, regime, finalidade, UF origem...). */
  conditions: Record<string, unknown>;
  /** Parâmetros numéricos da regra (alíquotas, MVA...), em BasisPoints. */
  parameters: Record<string, BasisPoints | number | string | boolean>;
  /** Quem homologou e quando. Regras sem homologação não podem ser usadas em cálculo. */
  approval: { approvedBy: string; approvedAt: string } | null;
}

export interface LegalRuleQuery {
  uf: UF;
  issuerUf: UF;
  ncm: string;
  cest: string | null;
  regime: RegimeTributario;
  finalidade: FinalidadeProduto;
  referenceDate: string;
  kinds?: LegalRuleKind[];
}

export interface LegalRuleCatalog {
  find(query: LegalRuleQuery): Promise<LegalRule[]>;
  getById(id: string): Promise<LegalRule | null>;
}

/** 8. Memória de cálculo — cada passo auditável, com valores de entrada/saída. */
export interface CalculationStep {
  order: number;
  label: string;
  formula: string;
  inputs: Record<string, Cents | BasisPoints | string>;
  output: Cents | BasisPoints;
  ruleId: string | null;
}

export type RoundingPolicy = "HALF_UP_CENTS" | "TRUNCATE_CENTS" | "HALF_EVEN_CENTS";

export interface CalculationMemory {
  steps: CalculationStep[];
  rounding: RoundingPolicy;
  ruleIds: string[];
  /** Hash determinístico de inputs+regras, para reprocessamento e comparação. */
  fingerprint: string;
}

export interface CalculationResult<TValues extends Record<string, Cents>> {
  status: ClassificationStatus;
  values: TValues | null;
  memory: CalculationMemory | null;
  reason: string | null;
}

/** 4. Cálculo de ICMS-ST. */
export interface IcmsStInput {
  item: InvoiceItem;
  invoice: Invoice;
  identity: ProductIdentity;
  context: FiscalContext;
  rules: LegalRule[];
  finalidade: FinalidadeProduto;
}

export type IcmsStValues = {
  baseCents: Cents;
  icmsStCents: Cents;
  icmsProprioCreditoCents: Cents;
};

export interface IcmsStCalculator {
  calculate(input: IcmsStInput): Promise<CalculationResult<IcmsStValues>>;
}

/** 5. Cálculo de antecipação tributária. */
export type AntecipacaoValues = {
  baseCents: Cents;
  antecipacaoCents: Cents;
};

export interface AntecipacaoCalculator {
  calculate(input: IcmsStInput): Promise<CalculationResult<AntecipacaoValues>>;
}

/** 6. Rateio de frete e despesas — distingue frete por item, frete global da NF-e e CT-e separado. */
export type FreightSource = "ITEM_NFE" | "TOTAL_NFE" | "CTE";

export interface FreightDocument {
  source: FreightSource;
  reference: string; // chave do CT-e ou da NF-e
  amountCents: Cents;
}

export type AllocationBasis = "VALOR_PRODUTO" | "PESO" | "QUANTIDADE";

export interface FreightAllocationInput {
  invoice: Invoice;
  documents: FreightDocument[];
  basis: AllocationBasis;
  rounding: RoundingPolicy;
}

export interface FreightAllocationLine {
  line: number;
  freightCents: Cents;
  otherExpensesCents: Cents;
}

export interface FreightAllocationResult {
  lines: FreightAllocationLine[];
  /** Diferença de arredondamento absorvida (e em qual item). */
  roundingAdjustment: { line: number; cents: Cents } | null;
  /** Fontes ignoradas para evitar dupla contagem, com justificativa. */
  excludedSources: { source: FreightSource; reference: string; reason: string }[];
  memory: CalculationMemory;
}

export interface FreightAllocator {
  allocate(input: FreightAllocationInput): Promise<FreightAllocationResult>;
}

/** 7. Composição do custo unitário — separa imposto a recolher de custo de estoque. */
export interface UnitCostInput {
  item: InvoiceItem;
  icmsSt: CalculationResult<IcmsStValues> | null;
  antecipacao: CalculationResult<AntecipacaoValues> | null;
  freight: FreightAllocationLine | null;
  context: FiscalContext;
  finalidade: FinalidadeProduto;
}

export type UnitCostValues = {
  /** Custo total do item apropriável ao estoque. */
  totalCostCents: Cents;
  unitCostCents: Cents;
  /** Tributos recuperáveis (crédito), que NÃO compõem o custo. */
  recoverableTaxesCents: Cents;
  /** Tributos não recuperáveis incorporados ao custo. */
  nonRecoverableTaxesCents: Cents;
};

export interface UnitCostComposer {
  compose(input: UnitCostInput): Promise<CalculationResult<UnitCostValues>>;
}

/** 9. Aprovação e auditoria. */
export interface ApprovalDecision {
  id: string;
  subjectType: "CLASSIFICATION" | "LEGAL_RULE" | "CALCULATION";
  subjectId: string;
  decision: "HOMOLOGADO" | "REJEITADO";
  decidedBy: string;
  decidedAt: string;
  justification: string;
  vigencia: Vigencia;
}

export interface ApprovalWorkflow {
  submit(subjectType: ApprovalDecision["subjectType"], subjectId: string, submittedBy: string): Promise<void>;
  decide(decision: Omit<ApprovalDecision, "id">): Promise<ApprovalDecision>;
}

export interface AuditTrail {
  record(event: {
    actorId: string | null;
    action: string;
    entityType: string;
    entityId: string;
    organizationId: string | null;
    companyId: string | null;
    metadata: Record<string, unknown>;
  }): Promise<void>;
}

/**
 * Implementação padrão: nada homologado. Mantém o fluxo íntegro enquanto o
 * motor real não existe — tudo volta como PENDENTE_REVISAO, sem valores.
 */
export const pendingReview = <T extends Record<string, Cents>>(reason: string): CalculationResult<T> => ({
  status: "PENDENTE_REVISAO",
  values: null,
  memory: null,
  reason,
});

export class NotHomologatedClassifier implements TaxClassifier {
  async classify(request: ClassificationRequest): Promise<ClassificationResult> {
    return {
      status: "PENDENTE_REVISAO",
      ruleIds: [],
      reason:
        "Nenhuma regra homologada para NCM " + request.identity.ncm +
        (request.identity.cest ? " / CEST " + request.identity.cest : "") +
        " em " + request.context.uf + ". Encaminhado ao Fiscal.",
      reusedDecisionId: null,
    };
  }
}
