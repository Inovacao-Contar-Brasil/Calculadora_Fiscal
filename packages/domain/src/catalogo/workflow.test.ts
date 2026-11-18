import { describe, expect, it } from "vitest";
import { canonicalJson } from "./canonical.ts";
import { semanticConditionIssues, type ClassificationConditionsV1 } from "./conditions.ts";
import { availableOperations, checkTransition, RULE_TRANSITIONS, RULE_VERSION_STATUSES, RULE_WORKFLOW_ACTIONS, TERMINAL_STATUSES, type RuleVersionStatus } from "./workflow.ts";

const AUTHOR = "autor";
const OTHER = "revisor";

describe("workflow de versões de regra (domínio puro)", () => {
  it("segue RASCUNHO → EM_REVISAO_TECNICA → APROVADA → ATIVA, com estados posteriores", () => {
    expect(RULE_TRANSITIONS.SUBMETE).toMatchObject({ from: ["RASCUNHO"], to: "EM_REVISAO_TECNICA" });
    expect(RULE_TRANSITIONS.APROVA).toMatchObject({ from: ["EM_REVISAO_TECNICA"], to: "APROVADA" });
    expect(RULE_TRANSITIONS.ATIVA).toMatchObject({ from: ["APROVADA"], to: "ATIVA" });
    expect(RULE_TRANSITIONS.SUSPENDE.to).toBe("SUSPENSA");
    expect(RULE_TRANSITIONS.REVOGA.to).toBe("REVOGADA");
    expect(RULE_TRANSITIONS.SUBSTITUI.to).toBe("SUBSTITUIDA");
  });

  it("estados terminais não têm saída e só se chega a ATIVA a partir de APROVADA ou SUSPENSA", () => {
    for (const action of RULE_WORKFLOW_ACTIONS) {
      for (const terminal of TERMINAL_STATUSES) expect(RULE_TRANSITIONS[action].from).not.toContain(terminal);
    }
    const intoActive = RULE_WORKFLOW_ACTIONS.filter((a) => RULE_TRANSITIONS[a].to === "ATIVA").flatMap((a) => RULE_TRANSITIONS[a].from);
    expect(intoActive.sort()).toEqual(["APROVADA", "SUSPENSA"]);
  });

  it("matriz completa: toda combinação fora da tabela é recusada como transição inválida", () => {
    for (const action of RULE_WORKFLOW_ACTIONS) {
      for (const status of RULE_VERSION_STATUSES) {
        const denial = checkTransition({ action, status, role: "admin", actorId: OTHER, authorId: AUTHOR });
        if ((RULE_TRANSITIONS[action].from as readonly RuleVersionStatus[]).includes(status)) expect(denial).toBeNull();
        else expect(denial?.code).toBe("INVALID_TRANSITION");
      }
    }
  });

  it("quatro olhos: autor não aprova, não devolve, não ativa nem reativa a própria versão", () => {
    for (const [action, status] of [["APROVA", "EM_REVISAO_TECNICA"], ["DEVOLVE", "EM_REVISAO_TECNICA"], ["ATIVA", "APROVADA"], ["REATIVA", "SUSPENSA"]] as const) {
      expect(checkTransition({ action, status, role: "admin", actorId: AUTHOR, authorId: AUTHOR })?.code).toBe("FOUR_EYES");
      expect(checkTransition({ action, status, role: "admin", actorId: OTHER, authorId: AUTHOR })).toBeNull();
    }
    // O autor pode submeter a própria versão.
    expect(checkTransition({ action: "SUBMETE", status: "RASCUNHO", role: "fiscal", actorId: AUTHOR, authorId: AUTHOR })).toBeNull();
  });

  it("fiscal revisa e aprova, mas não ativa, suspende, reativa nem revoga (provisório, decisão nº 2)", () => {
    expect(checkTransition({ action: "APROVA", status: "EM_REVISAO_TECNICA", role: "fiscal", actorId: OTHER, authorId: AUTHOR })).toBeNull();
    for (const [action, status] of [["ATIVA", "APROVADA"], ["SUSPENDE", "ATIVA"], ["REATIVA", "SUSPENSA"], ["REVOGA", "ATIVA"]] as const) {
      expect(checkTransition({ action, status, role: "fiscal", actorId: OTHER, authorId: AUTHOR })?.code).toBe("ROLE_NOT_ALLOWED");
    }
  });

  it("operações disponíveis refletem estado, papel e autoria", () => {
    expect(availableOperations({ status: "EM_REVISAO_TECNICA", role: "fiscal", actorId: AUTHOR, authorId: AUTHOR })).toEqual([]);
    expect(availableOperations({ status: "EM_REVISAO_TECNICA", role: "fiscal", actorId: OTHER, authorId: AUTHOR })).toEqual(["APROVA", "DEVOLVE"]);
    expect(availableOperations({ status: "ATIVA", role: "admin", actorId: OTHER, authorId: AUTHOR })).toEqual(["SUSPENDE", "REVOGA"]);
    expect(availableOperations({ status: "REVOGADA", role: "admin", actorId: OTHER, authorId: AUTHOR })).toEqual([]);
  });
});

describe("condições: regras semânticas puras", () => {
  const base: ClassificationConditionsV1 = { schemaVersion: 1, layer: "CLASSIFICACAO", ncm: { include: ["87083090"] }, cest: { include: ["0100100"] }, segment: "SEGMENTO_TESTE_AUTOPECAS" };

  it("NCM + CEST é aceito; NCM isolado é recusado", () => {
    expect(semanticConditionIssues(base)).toEqual([]);
    const onlyNcm = { ...base, cest: undefined };
    expect(semanticConditionIssues(onlyNcm).map((i) => i.message).join()).toMatch(/só do NCM/);
    expect(semanticConditionIssues({ ...base, cest: { required: false } }).length).toBeGreaterThan(0);
  });

  it("descrição só conta como segundo critério com aceite explícito", () => {
    const withSignals = { ...base, cest: { required: false as const }, descriptionSignals: { mustMatchAny: ["PASTILHA"] } };
    expect(semanticConditionIssues(withSignals).length).toBeGreaterThan(0);
    expect(semanticConditionIssues({ ...withSignals, descriptionSignals: { mustMatchAny: ["PASTILHA"], acceptedAsCriterion: true } })).toEqual([]);
    // Termos apenas negativos nunca bastam.
    expect(semanticConditionIssues({ ...withSignals, descriptionSignals: { mustNotMatch: ["USADA"], acceptedAsCriterion: true } }).length).toBeGreaterThan(0);
  });

  it("exclusão de NCM precisa estar contida num padrão incluído; repetição e conflito são recusados", () => {
    expect(semanticConditionIssues({ ...base, ncm: { include: ["8708"], exclude: ["870830"] } })).toEqual([]);
    expect(semanticConditionIssues({ ...base, ncm: { include: ["8708"], exclude: ["8421"] } }).length).toBe(1);
    expect(semanticConditionIssues({ ...base, ncm: { include: ["8708", "8708"] } }).length).toBe(1);
    expect(semanticConditionIssues({ ...base, descriptionSignals: { mustMatchAny: ["freio"], mustNotMatch: ["FREIO"] } }).length).toBe(1);
  });

  it("incidência: regime especial contraditório ou vazio é recusado", () => {
    const inc = { schemaVersion: 1 as const, layer: "INCIDENCIA" as const, segmentIn: ["SEGMENTO_TESTE_AUTOPECAS"], ufDestino: ["MG" as const] };
    expect(semanticConditionIssues(inc)).toEqual([]);
    expect(semanticConditionIssues({ ...inc, regimeEspecial: { requires: ["ttdTeste"], excludes: ["ttdTeste"] } }).length).toBe(1);
    expect(semanticConditionIssues({ ...inc, regimeEspecial: {} }).length).toBe(1);
    expect(semanticConditionIssues({ ...inc, ufDestino: ["MG", "MG"] }).length).toBe(1);
  });
});

describe("JSON canônico", () => {
  it("independe da ordem das chaves e ignora undefined", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: null, c: "x" }], e: undefined })).toBe('{"a":[2,{"c":"x","d":null}],"b":1}');
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
    expect(() => canonicalJson({ a: Number.NaN })).toThrow();
  });
});
