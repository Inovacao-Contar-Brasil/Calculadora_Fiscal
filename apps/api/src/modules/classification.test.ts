import { describe, expect, it } from "vitest";
import { classificationFor, issueDateOf } from "./classification.ts";

describe("regra única de classificação de item a partir da decisão", () => {
  const homologado = { status: "HOMOLOGADO" as const, validFrom: "2026-12-01", validTo: "2027-05-31" };

  it("sem decisão: pendente", () => {
    expect(classificationFor(undefined, "2026-12-10")).toBe("PENDENTE_REVISAO");
  });

  it("estados de fluxo e rejeição valem para qualquer data", () => {
    for (const status of ["PENDENTE_REVISAO", "EM_ANALISE", "REJEITADO"] as const) {
      expect(classificationFor({ status, validFrom: "2026-12-01", validTo: null }, "2020-01-01")).toBe(status);
    }
  });

  it("homologação só dentro da vigência, limites inclusivos", () => {
    expect(classificationFor(homologado, "2026-11-30")).toBe("PENDENTE_REVISAO");
    expect(classificationFor(homologado, "2026-12-01")).toBe("HOMOLOGADO");
    expect(classificationFor(homologado, "2027-05-31")).toBe("HOMOLOGADO");
    expect(classificationFor(homologado, "2027-06-01")).toBe("PENDENTE_REVISAO");
    expect(classificationFor({ ...homologado, validFrom: null, validTo: null }, "1999-01-01")).toBe("HOMOLOGADO");
  });

  it("data de emissão ignora hora e fuso", () => {
    expect(issueDateOf("2026-11-10T23:59:00-03:00")).toBe("2026-11-10");
  });
});
