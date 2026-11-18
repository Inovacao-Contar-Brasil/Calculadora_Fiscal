/**
 * Workflow das versões de regra tributária do catálogo legal (Sprint 2A.1).
 *
 * Domínio puro: define estados, operações, transições e a regra dos quatro
 * olhos. O backend aplica estas definições dentro de transação, e o banco
 * repete as mesmas restrições (CHECK + triggers na migração 0004_catalogo_legal_integridade) como última
 * linha de defesa. Qualquer mudança aqui exige migração correspondente.
 *
 * ATENÇÃO: "ATIVA" significa apenas que a versão poderá contar como cobertura
 * quando o motor de triagem existir (2A.4+). Nada aqui calcula tributo, e a
 * capacidade técnica de ativar não equivale à autorização de negócio para usar
 * uma regra real (decisão pendente nº 2 da especificação 2A).
 */

export const RULE_VERSION_STATUSES = [
  "RASCUNHO",
  "EM_REVISAO_TECNICA",
  "APROVADA",
  "ATIVA",
  "SUSPENSA",
  "SUBSTITUIDA",
  "REVOGADA",
] as const;
export type RuleVersionStatus = (typeof RULE_VERSION_STATUSES)[number];

/** Ações registradas na trilha do workflow (`tax_rule_approvals.action`). */
export const RULE_WORKFLOW_ACTIONS = [
  "SUBMETE",
  "APROVA",
  "DEVOLVE",
  "ATIVA",
  "SUSPENDE",
  "REATIVA",
  "REVOGA",
  "SUBSTITUI",
] as const;
export type RuleWorkflowAction = (typeof RULE_WORKFLOW_ACTIONS)[number];

/** Operações que uma pessoa pode pedir explicitamente (SUBSTITUI é sempre consequência de outra operação). */
export type RuleUserOperation = Exclude<RuleWorkflowAction, "SUBSTITUI">;

export type StaffRole = "admin" | "fiscal";

export interface TransitionDefinition {
  from: readonly RuleVersionStatus[];
  to: RuleVersionStatus;
  /** Papéis que podem executar a operação. */
  roles: readonly StaffRole[];
  /** Quem escreveu a versão não pode executar (princípio dos quatro olhos). */
  forbidsAuthor: boolean;
  /** Exige justificativa registrada. */
  requiresJustification: boolean;
  /** Exige referência ao registro de autorização de negócio (ata, decisão, e-mail formal). */
  requiresAuthorizationReference: boolean;
}

/**
 * Tabela única de transições. Ativação, reativação, suspensão e revogação são
 * restritas a `admin` (provisório até a decisão nº 2: quem aprova e quem ativa).
 */
export const RULE_TRANSITIONS: Readonly<Record<RuleWorkflowAction, TransitionDefinition>> = {
  SUBMETE: { from: ["RASCUNHO"], to: "EM_REVISAO_TECNICA", roles: ["admin", "fiscal"], forbidsAuthor: false, requiresJustification: false, requiresAuthorizationReference: false },
  APROVA: { from: ["EM_REVISAO_TECNICA"], to: "APROVADA", roles: ["admin", "fiscal"], forbidsAuthor: true, requiresJustification: true, requiresAuthorizationReference: false },
  DEVOLVE: { from: ["EM_REVISAO_TECNICA"], to: "RASCUNHO", roles: ["admin", "fiscal"], forbidsAuthor: true, requiresJustification: true, requiresAuthorizationReference: false },
  ATIVA: { from: ["APROVADA"], to: "ATIVA", roles: ["admin"], forbidsAuthor: true, requiresJustification: true, requiresAuthorizationReference: true },
  SUSPENDE: { from: ["ATIVA"], to: "SUSPENSA", roles: ["admin"], forbidsAuthor: false, requiresJustification: true, requiresAuthorizationReference: false },
  REATIVA: { from: ["SUSPENSA"], to: "ATIVA", roles: ["admin"], forbidsAuthor: true, requiresJustification: true, requiresAuthorizationReference: true },
  REVOGA: { from: ["ATIVA", "SUSPENSA"], to: "REVOGADA", roles: ["admin"], forbidsAuthor: false, requiresJustification: true, requiresAuthorizationReference: false },
  SUBSTITUI: { from: ["RASCUNHO", "APROVADA", "ATIVA", "SUSPENSA"], to: "SUBSTITUIDA", roles: ["admin", "fiscal"], forbidsAuthor: false, requiresJustification: true, requiresAuthorizationReference: false },
};

export const TERMINAL_STATUSES: readonly RuleVersionStatus[] = ["SUBSTITUIDA", "REVOGADA"];

/** Estados que bloqueiam a criação de nova versão (há uma revisão em curso). */
export const IN_REVIEW_STATUSES: readonly RuleVersionStatus[] = ["EM_REVISAO_TECNICA"];

export type TransitionDenial =
  | { code: "INVALID_TRANSITION"; message: string }
  | { code: "ROLE_NOT_ALLOWED"; message: string }
  | { code: "FOUR_EYES"; message: string };

const LABEL: Record<RuleWorkflowAction, string> = {
  SUBMETE: "submeter à revisão",
  APROVA: "aprovar",
  DEVOLVE: "devolver",
  ATIVA: "ativar",
  SUSPENDE: "suspender",
  REATIVA: "reativar",
  REVOGA: "revogar",
  SUBSTITUI: "substituir",
};

/**
 * Avalia se `actor` pode executar `action` sobre uma versão em `status`.
 * A ordem das verificações é deliberada: estado, papel e quatro olhos.
 */
export function checkTransition(input: {
  action: RuleWorkflowAction;
  status: RuleVersionStatus;
  role: StaffRole;
  actorId: string;
  authorId: string;
}): TransitionDenial | null {
  const definition = RULE_TRANSITIONS[input.action];
  if (!definition.from.includes(input.status)) {
    return { code: "INVALID_TRANSITION", message: "Não é possível " + LABEL[input.action] + " uma versão em " + input.status + "." };
  }
  if (!definition.roles.includes(input.role)) {
    return { code: "ROLE_NOT_ALLOWED", message: "Seu papel não permite " + LABEL[input.action] + " versões de regra." };
  }
  if (definition.forbidsAuthor && input.actorId === input.authorId) {
    return { code: "FOUR_EYES", message: "Quem escreveu a versão não pode " + LABEL[input.action] + " a própria versão (quatro olhos)." };
  }
  return null;
}

/** Operações disponíveis para o ator na versão (para a interface; o backend revalida). */
export function availableOperations(input: { status: RuleVersionStatus; role: StaffRole; actorId: string; authorId: string }): RuleUserOperation[] {
  return (Object.keys(RULE_TRANSITIONS) as RuleWorkflowAction[])
    .filter((action): action is RuleUserOperation => action !== "SUBSTITUI")
    .filter((action) => checkTransition({ ...input, action }) === null);
}
