import { describe, expect, it } from "vitest";
import { CLASSIFICATION_CONDITIONS, INCIDENCE_CONDITIONS } from "../../test/catalog-fixtures.ts";
import { ruleConditionsSchema } from "./conditions.ts";

const messages = (value: unknown) => {
  const result = ruleConditionsSchema.safeParse(value);
  return result.success ? [] : result.error.issues.map((i) => i.path.join(".") + ": " + i.message);
};

describe("RuleConditions v1 (schema versionado)", () => {
  it("aceita classificação NCM + CEST e incidência completa", () => {
    expect(messages(CLASSIFICATION_CONDITIONS)).toEqual([]);
    expect(messages(INCIDENCE_CONDITIONS)).toEqual([]);
    expect(messages({ ...CLASSIFICATION_CONDITIONS, cest: { required: false }, descriptionSignals: { mustMatchAny: ["PASTILHA DE FREIO"], acceptedAsCriterion: true } })).toEqual([]);
  });

  it("recusa NCM isolado como critério suficiente", () => {
    const { cest: _cest, ...onlyNcm } = CLASSIFICATION_CONDITIONS;
    expect(messages(onlyNcm).join()).toMatch(/só do NCM/);
    expect(messages({ ...onlyNcm, cest: { required: false } }).join()).toMatch(/só do NCM/);
    expect(messages({ ...onlyNcm, descriptionSignals: { mustMatchAny: ["PASTILHA"] } }).join()).toMatch(/só do NCM/);
  });

  it("recusa critério por CNAE (nunca classificar só por CNAE) e campos desconhecidos em qualquer nível", () => {
    expect(messages({ ...CLASSIFICATION_CONDITIONS, cnae: ["4530703"] }).join()).toMatch(/cnae|Unrecognized/i);
    expect(messages({ ...INCIDENCE_CONDITIONS, cnae: ["4530703"] }).length).toBeGreaterThan(0);
    expect(messages({ ...CLASSIFICATION_CONDITIONS, ncm: { include: ["87083090"], extra: true } }).length).toBeGreaterThan(0);
    expect(messages({ ...INCIDENCE_CONDITIONS, regimeEspecial: { requires: ["ttdTeste"], qualquer: 1 } }).length).toBeGreaterThan(0);
  });

  it("guarda contra cálculo: campos numéricos de alíquota/MVA/base são recusados", () => {
    for (const key of ["aliquota", "mva", "baseCalculo", "aliquotaInterna", "percentual", "valor"]) {
      expect(messages({ ...INCIDENCE_CONDITIONS, [key]: 1800 }).length, key).toBeGreaterThan(0);
      expect(messages({ ...CLASSIFICATION_CONDITIONS, [key]: 1800 }).length, key).toBeGreaterThan(0);
    }
  });

  it("recusa formatos inválidos", () => {
    expect(messages({ ...CLASSIFICATION_CONDITIONS, ncm: { include: ["87"] } }).length).toBeGreaterThan(0); // capítulo isolado
    expect(messages({ ...CLASSIFICATION_CONDITIONS, ncm: { include: ["8708309A"] } }).length).toBeGreaterThan(0);
    expect(messages({ ...CLASSIFICATION_CONDITIONS, ncm: { include: [] } }).length).toBeGreaterThan(0);
    expect(messages({ ...CLASSIFICATION_CONDITIONS, cest: { include: ["123"] } }).length).toBeGreaterThan(0);
    expect(messages({ ...CLASSIFICATION_CONDITIONS, segment: "autopecas" }).length).toBeGreaterThan(0);
    expect(messages({ ...INCIDENCE_CONDITIONS, ufDestino: ["XX"] }).length).toBeGreaterThan(0);
    expect(messages({ ...INCIDENCE_CONDITIONS, cfop: ["4102"] }).length).toBeGreaterThan(0);
    expect(messages({ ...INCIDENCE_CONDITIONS, finalidade: ["NAO_INFORMADA"] }).join()).toMatch(/NAO_INFORMADA/);
    expect(messages({ ...INCIDENCE_CONDITIONS, regimeDestinatario: ["SUPER_SIMPLES"] }).length).toBeGreaterThan(0);
    expect(messages({ ...INCIDENCE_CONDITIONS, contribuinteIcms: "sim" }).length).toBeGreaterThan(0);
  });

  it("recusa combinações incoerentes", () => {
    expect(messages({ ...CLASSIFICATION_CONDITIONS, ncm: { include: ["8708"], exclude: ["8421"] } }).join()).toMatch(/não está contida/);
    expect(messages({ ...CLASSIFICATION_CONDITIONS, ncm: { include: ["87083090", "87083090"] } }).join()).toMatch(/repetidos/);
    expect(messages({ ...CLASSIFICATION_CONDITIONS, descriptionSignals: { mustMatchAny: ["FREIO"], mustNotMatch: ["freio"] } }).join()).toMatch(/exigido e proibido/);
    expect(messages({ ...INCIDENCE_CONDITIONS, regimeEspecial: { requires: ["ttd"], excludes: ["ttd"] } }).length).toBeGreaterThan(0);
    const { ufDestino: _uf, ...withoutDestination } = INCIDENCE_CONDITIONS;
    expect(messages(withoutDestination).length).toBeGreaterThan(0);
  });

  it("exige schemaVersion 1 e camada declarada", () => {
    expect(messages({ ...CLASSIFICATION_CONDITIONS, schemaVersion: 2 }).length).toBeGreaterThan(0);
    const { schemaVersion: _v, ...noVersion } = CLASSIFICATION_CONDITIONS;
    expect(messages(noVersion).length).toBeGreaterThan(0);
    expect(messages({ ...CLASSIFICATION_CONDITIONS, layer: "CALCULO" }).length).toBeGreaterThan(0);
    // Mistura de camadas: critério de incidência numa regra de classificação.
    expect(messages({ ...CLASSIFICATION_CONDITIONS, ufDestino: ["MG"] }).length).toBeGreaterThan(0);
  });
});
