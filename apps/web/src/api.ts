/** Cliente HTTP da API. Mesmo origin (proxy do Vite em dev); cookie de sessão HttpOnly. */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  xml?: string;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (options.xml !== undefined) {
    headers["content-type"] = "application/xml";
    body = options.xml;
  } else if (options.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  const response = await fetch(path, { method: options.method ?? "GET", headers, body, credentials: "same-origin" });
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("json") ? await response.json() : await response.text();
  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string; details?: unknown } }).error;
    throw new ApiError(response.status, error?.code ?? "HTTP_" + response.status, error?.message ?? "Falha na comunicação com a API.", error?.details);
  }
  return payload as T;
}

export const money = (value: number | null | undefined) =>
  value === null || value === undefined ? "Não informado" : (value / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const formatCnpj = (digits: string) =>
  digits.length === 14 ? digits.slice(0, 2) + "." + digits.slice(2, 5) + "." + digits.slice(5, 8) + "/" + digits.slice(8, 12) + "-" + digits.slice(12) : digits;

export const formatDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const date = new Date(iso.length === 10 ? iso + "T00:00:00" : iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString("pt-BR");
};

export const formatDateTime = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString("pt-BR");
};

// --- Tipos das respostas da API ---

export type Role = "admin" | "fiscal" | "cliente";
export type ClassificationStatus = "PENDENTE_REVISAO" | "EM_ANALISE" | "HOMOLOGADO" | "REJEITADO";
export type DocumentStatus = "IMPORTADA" | "COM_PENDENCIAS" | "REVISADA";

export interface Me {
  user: { id: string; email: string; name: string };
  memberships: { organizationId: string; role: Role; organizationName: string }[];
}

export interface Company {
  id: string;
  organizationId: string;
  cnpj: string;
  legalName: string;
  tradeName: string | null;
  uf: string;
  active: boolean;
  createdAt: string;
}

export interface FiscalProfile {
  id: string;
  companyId: string;
  version: number;
  regime: string;
  cnaes: string[];
  contribuinteIcms: boolean;
  parameters: Record<string, unknown>;
  source: string;
  notes: string | null;
  validFrom: string;
  validTo: string | null;
  createdAt: string;
  createdBy: string;
  supersededAt: string | null;
  supersededById: string | null;
}

export interface DocumentSummary {
  id: string;
  companyId: string;
  accessKey: string;
  sha256: string;
  fileName: string | null;
  number: string;
  series: string;
  issuedAt: string;
  operation: string;
  issuer: { document: string; name: string; state: string };
  recipient: { document: string; name: string; state: string };
  totals: Record<string, number | null>;
  warnings: string[];
  itemCount: number;
  status: DocumentStatus;
  importedBy: string;
  importedAt: string;
}

export interface DocumentItem {
  id: string;
  line: number;
  code: string;
  description: string;
  ncm: string;
  cest: string;
  cfop: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  productCents: number;
  freightCents: number | null;
  insuranceCents: number | null;
  discountCents: number | null;
  otherCents: number | null;
  declaredTaxes: { origin: string; cst: string; csosn: string; icmsCents: number | null; icmsStCents: number | null; ipiCents: number | null };
  fingerprint: string;
  classificationStatus: ClassificationStatus;
  reviewItemId: string | null;
}

export interface ReviewItem {
  id: string;
  organizationId: string;
  companyId: string;
  companyName?: string;
  fingerprint: string;
  ncm: string;
  cest: string;
  description: string;
  status: ClassificationStatus;
  occurrences: number;
  firstDocumentId: string | null;
  lastDocumentId: string | null;
  assignedTo: string | null;
  decision: { enquadramento?: string; fundamentoLegal?: string; observacoes?: string } | null;
  justification: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  validFrom: string | null;
  validTo: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Pendência temporal: notas fora da vigência da homologação (somente staff). */
export interface TemporalPendency {
  id: string;
  kind: "FORA_DA_VIGENCIA";
  reasonCode: "EMISSAO_ANTERIOR_A_VIGENCIA" | "EMISSAO_POSTERIOR_A_VIGENCIA" | "EMISSAO_FORA_DA_VIGENCIA";
  reason: string;
  organizationId: string;
  companyId: string;
  companyName: string;
  product: { fingerprint: string; ncm: string; cest: string; description: string };
  decision: { id: string; status: ClassificationStatus; validFrom: string | null; validTo: string | null };
  origin: { items: number; documents: number; firstIssueDate: string; lastIssueDate: string };
  action: "REGISTRAR_DECISAO_DO_PERIODO";
}

export interface TemporalPendencyDetail {
  pendency: TemporalPendency;
  occurrences: { nfeItemId: string; documentId: string; number: string; issuedAt: string; issuerName: string; line: number; productCents: number }[];
  /** Calculadas sobre todas as notas pendentes (não sobre a página de ocorrências). */
  uncoveredPeriods: { from: string | null; to: string | null; items: number; firstIssueDate: string; lastIssueDate: string }[];
  page: { limit: number; offset: number; total: number; hasMore: boolean };
  decisions: { id: string; status: ClassificationStatus; validFrom: string | null; validTo: string | null }[];
}

export interface OrgUser {
  id: string;
  email: string;
  name: string;
  active: boolean;
  role: Role;
  lastLoginAt: string | null;
}

// --- Catálogo legal (Sprint 2A.1) ---

export type RuleVersionStatus = "RASCUNHO" | "EM_REVISAO_TECNICA" | "APROVADA" | "ATIVA" | "SUSPENSA" | "SUBSTITUIDA" | "REVOGADA";
export type RuleOperation = "SUBMETE" | "APROVA" | "DEVOLVE" | "ATIVA" | "SUSPENDE" | "REATIVA" | "REVOGA";
export type LicenseStatus = "OFICIAL_PUBLICO" | "LICENCIADO_CONFIRMADO" | "LICENCA_NAO_VERIFICADA" | "INTERNO";
export type ProvisionRole = "FUNDAMENTO" | "EXCECAO" | "CONFRONTO" | "INTERPRETACAO";

export interface LegalSource {
  id: string;
  organizationId: string;
  kind: string;
  category: "NORMATIVA_OFICIAL" | "FERRAMENTA_CONFRONTO" | "INTERPRETACAO_INTERNA" | "CONTEUDO_LICENCIADO";
  jurisdiction: "FEDERAL" | "CONFAZ" | "UF";
  uf: string | null;
  issuer: string;
  number: string | null;
  title: string;
  publishedAt: string;
  officialUrl: string | null;
  normative: boolean;
  licenseStatus: LicenseStatus;
  licenseReference: string | null;
  notes: string | null;
  createdBy: string;
  createdAt: string;
  provisionCount?: number;
}

export interface LegalSnapshot {
  id: string;
  sourceId: string;
  retrievedAt: string;
  retrievedBy: string;
  url: string | null;
  method: "MANUAL" | "IMPORTACAO_ASSISTIDA";
  contentSha256: string;
  storageRef: string | null;
  notes: string | null;
}

export interface LegalProvision {
  id: string;
  sourceId: string;
  snapshotId: string;
  reference: string;
  heading: string | null;
  officialText: string | null;
  publishedAt: string;
  effectsFrom: string;
  effectsTo: string | null;
  effectsClosedAt: string | null;
  effectsClosedReason: string | null;
  source?: LegalSource;
  usedBy?: { versionId: string; version: number; status: RuleVersionStatus; ruleId: string; ruleCode: string; role: ProvisionRole }[];
}

export interface TaxRule {
  id: string;
  organizationId: string;
  layer: "CLASSIFICACAO" | "INCIDENCIA";
  kind: string;
  code: string;
  title: string;
  createdBy: string;
  createdAt: string;
}

export interface RuleVersionSummary {
  id: string;
  ruleId: string;
  version: number;
  status: RuleVersionStatus;
  effectsFrom: string;
  effectsTo: string | null;
  effectsEndedOn: string | null;
  contentSha256: string;
  changeReason: string;
  authorId: string;
  createdAt: string;
  statusChangedAt: string;
  supersededByVersionId: string | null;
}

export interface RuleVersion extends RuleVersionSummary {
  conditionsSchemaVersion: number;
  conditions: Record<string, unknown>;
}

export interface WorkflowEntry {
  id: string;
  ruleVersionId: string;
  version?: number | null;
  action: RuleOperation | "SUBSTITUI";
  fromStatus: RuleVersionStatus;
  toStatus: RuleVersionStatus;
  decidedBy: string;
  decidedAt: string;
  justification: string | null;
  authorizationReference: string | null;
}
