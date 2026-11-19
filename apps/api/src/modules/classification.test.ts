import { describe, expect, it } from "vitest";
import { classificationFor, decisionCovers, freePeriods, issueDateOf, selectReviewFor, shiftDay, uncoveredPeriods, type ReviewDecisionState } from "./classification.ts";

type Row = ReviewDecisionState & { id: string };

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

describe("vínculo temporal: a nota pertence à decisão que cobre a sua emissão", () => {
  const open: Row = { id: "aberto", status: "HOMOLOGADO", validFrom: "2026-11-01", validTo: null };
  const closed: Row = { id: "encerrado", status: "HOMOLOGADO", validFrom: "2026-06-01", validTo: "2026-08-31" };
  const period: Row = { id: "periodo", status: "REJEITADO", validFrom: "2026-09-01", validTo: "2026-09-30" };

  it("decisão final cobre só a própria vigência; estados de fluxo não cobrem datas", () => {
    expect(decisionCovers(closed, "2026-06-01")).toBe(true);
    expect(decisionCovers(closed, "2026-09-01")).toBe(false);
    expect(decisionCovers(period, "2026-09-15")).toBe(true);
    expect(decisionCovers({ status: "PENDENTE_REVISAO", validFrom: null, validTo: null }, "2026-01-01")).toBe(false);
    expect(decisionCovers({ status: "EM_ANALISE", validFrom: null, validTo: null }, "2026-01-01")).toBe(false);
  });

  it("escolhe a decisão que cobre a data; sem cobertura, o item aberto", () => {
    expect(selectReviewFor(open, [closed, period], "2026-12-01").id).toBe("aberto");
    expect(selectReviewFor(open, [closed, period], "2026-07-01").id).toBe("encerrado");
    expect(selectReviewFor(open, [closed, period], "2026-09-10").id).toBe("periodo");
    expect(selectReviewFor(open, [closed, period], "2026-10-10").id).toBe("aberto");
    expect(selectReviewFor(open, [closed, period], "2026-01-10").id).toBe("aberto");
    // O resultado independe da ordem das decisões.
    expect(selectReviewFor(open, [period, closed], "2026-07-01").id).toBe("encerrado");
  });

  it("decisões sobrepostas (dados inconsistentes) nunca geram homologação presumida", () => {
    const overlap: Row = { id: "sobreposta", status: "HOMOLOGADO", validFrom: "2026-08-01", validTo: "2026-08-31" };
    const pending: Row = { id: "aberto", status: "PENDENTE_REVISAO", validFrom: null, validTo: null };
    const chosen = selectReviewFor(pending, [closed, overlap], "2026-08-15");
    expect(chosen.id).toBe("aberto");
    expect(classificationFor(chosen, "2026-08-15")).toBe("PENDENTE_REVISAO");
  });

  it("lacunas de vigência: complemento das decisões finais, com notas pendentes", () => {
    expect(freePeriods([])).toEqual([{ from: null, to: null }]);
    expect(freePeriods([open])).toEqual([{ from: null, to: "2026-10-31" }]);
    expect(freePeriods([open, closed, period])).toEqual([
      { from: null, to: "2026-05-31" },
      { from: "2026-10-01", to: "2026-10-31" },
    ]);
    expect(freePeriods([{ ...closed, validTo: "2026-12-31" }, { status: "PENDENTE_REVISAO", validFrom: null, validTo: null }])).toEqual([
      { from: null, to: "2026-05-31" },
      { from: "2027-01-01", to: null },
    ]);
    expect(uncoveredPeriods([open, closed, period], ["2026-10-05", "2026-10-20", "2026-01-02"])).toEqual([
      { from: null, to: "2026-05-31", items: 1 },
      { from: "2026-10-01", to: "2026-10-31", items: 2 },
    ]);
  });

  it("aritmética de datas atravessa mês, ano e fevereiro bissexto", () => {
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDay("2028-03-01", -1)).toBe("2028-02-29");
  });
});
