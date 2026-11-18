import { expect } from "vitest";
import type { Harness } from "./harness.ts";

/**
 * Fixtures do catálogo legal — EXCLUSIVAMENTE sintéticas: normas fictícias
 * ("Norma Sintética nº N/2099"), URLs sob o TLD reservado `.invalid`,
 * segmentos SEGMENTO_TESTE_*. Nunca citar norma, órgão ou URL reais.
 */

export const SYNTHETIC_URL = (path: string) => "https://normas.example.invalid/" + path;

export const CLASSIFICATION_CONDITIONS = {
  schemaVersion: 1,
  layer: "CLASSIFICACAO",
  ncm: { include: ["87083090"] },
  cest: { include: ["0100100"] },
  segment: "SEGMENTO_TESTE_AUTOPECAS",
} as const;

export const INCIDENCE_CONDITIONS = {
  schemaVersion: 1,
  layer: "INCIDENCIA",
  segmentIn: ["SEGMENTO_TESTE_AUTOPECAS"],
  ufOrigem: ["SP"],
  ufDestino: ["MG"],
  regimeDestinatario: ["LUCRO_REAL"],
  contribuinteIcms: true,
  finalidade: ["REVENDA"],
  cfop: ["6102"],
} as const;

export interface SyntheticNorm {
  sourceId: string;
  snapshotId: string;
  provisionId: string;
}

/** Cadastra fonte normativa sintética + snapshot + dispositivo pela API. */
export async function createSyntheticNorm(
  h: Harness,
  cookie: string,
  orgId: string,
  options: { number: string; licenseStatus?: "OFICIAL_PUBLICO" | "LICENCIADO_CONFIRMADO" | "LICENCA_NAO_VERIFICADA"; licenseReference?: string; effectsFrom?: string; effectsTo?: string; kind?: string; reference?: string } = { number: "1" },
): Promise<SyntheticNorm> {
  const kind = options.kind ?? "DECRETO";
  const source = await h.request({
    method: "POST",
    url: "/api/organizations/" + orgId + "/legal-sources",
    cookie,
    payload: {
      kind,
      jurisdiction: "UF",
      uf: "MG",
      issuer: "Assembleia Sintética",
      number: options.number + "/2099",
      title: "Norma Sintética nº " + options.number + "/2099",
      publishedAt: "2099-01-02",
      officialUrl: SYNTHETIC_URL("norma-" + options.number),
      licenseStatus: options.licenseStatus ?? "OFICIAL_PUBLICO",
      ...(options.licenseReference ? { licenseReference: options.licenseReference } : {}),
    },
  });
  expect(source.status, JSON.stringify(source.body)).toBe(201);
  const snapshot = await h.request({
    method: "POST",
    url: "/api/legal-sources/" + source.body.source.id + "/snapshots",
    cookie,
    payload: { retrievedAt: "2026-11-01T10:00:00-03:00", url: SYNTHETIC_URL("norma-" + options.number), method: "MANUAL", contentSha256: (options.number.charCodeAt(0) % 10).toString(16).repeat(64) },
  });
  expect(snapshot.status, JSON.stringify(snapshot.body)).toBe(201);
  const provision = await h.request({
    method: "POST",
    url: "/api/legal-sources/" + source.body.source.id + "/provisions",
    cookie,
    payload: { snapshotId: snapshot.body.snapshot.id, reference: options.reference ?? "art. 1º, Anexo Sintético, item 1", effectsFrom: options.effectsFrom ?? "2099-02-01", ...(options.effectsTo ? { effectsTo: options.effectsTo } : {}) },
  });
  expect(provision.status, JSON.stringify(provision.body)).toBe(201);
  return { sourceId: source.body.source.id, snapshotId: snapshot.body.snapshot.id, provisionId: provision.body.provision.id };
}

/** Cria regra de classificação com a versão 1 citando o dispositivo como FUNDAMENTO. */
export async function createSyntheticRule(h: Harness, cookie: string, orgId: string, code: string, provisionId: string, overrides: Record<string, unknown> = {}) {
  const response = await h.request({
    method: "POST",
    url: "/api/organizations/" + orgId + "/tax-rules",
    cookie,
    payload: {
      code,
      title: "Regra sintética " + code,
      layer: "CLASSIFICACAO",
      kind: "SEGMENTO_ST",
      version: { conditions: CLASSIFICATION_CONDITIONS, effectsFrom: "2099-02-01", changeReason: "Versão inicial sintética", provisions: [{ provisionId, role: "FUNDAMENTO" }], ...overrides },
    },
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return { ruleId: response.body.rule.id as string, versionId: response.body.version.id as string };
}

export const op = (h: Harness, cookie: string, versionId: string, operation: string, payload: Record<string, unknown> = {}) =>
  h.request({ method: "POST", url: "/api/tax-rule-versions/" + versionId + "/" + operation, cookie, payload });

export const APPROVE = { justification: "Conferido contra a Norma Sintética; condições coerentes." };
export const ACTIVATE = { justification: "Ativação sintética para teste.", authorizationReference: "Ata Sintética de Homologação nº 1/2099" };
