import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Esquema relacional da Calculadora Fiscal.
 *
 * Isolamento: toda entidade de negócio carrega `organization_id` e, quando
 * aplicável, `company_id`. O backend filtra por esses escopos em todas as
 * consultas (ver authorize.ts); o banco é a última linha de defesa via FKs.
 *
 * Histórico: perfis fiscais e decisões de revisão são append-only com vigência
 * (`valid_from`/`valid_to`) e autoria. Nunca se faz UPDATE destrutivo neles.
 */

export const roleEnum = pgEnum("membership_role", ["admin", "fiscal", "cliente"]);
export const regimeEnum = pgEnum("regime_tributario", [
  "SIMPLES_NACIONAL",
  "LUCRO_PRESUMIDO",
  "LUCRO_REAL",
  "MEI",
  "OUTRO",
]);
export const classificationStatusEnum = pgEnum("classification_status", [
  "PENDENTE_REVISAO",
  "EM_ANALISE",
  "HOMOLOGADO",
  "REJEITADO",
]);
export const documentStatusEnum = pgEnum("document_status", ["IMPORTADA", "COM_PENDENCIAS", "REVISADA"]);

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: createdAt(),
});

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("users_email_lower_idx").on(sql`lower(${t.email})`)],
);

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull(),
    createdAt: createdAt(),
    createdBy: uuid("created_by").references(() => users.id),
  },
  (t) => [uniqueIndex("memberships_user_org_idx").on(t.userId, t.organizationId)],
);

export const companies = pgTable(
  "companies",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    cnpj: char("cnpj", { length: 14 }).notNull(),
    legalName: text("legal_name").notNull(),
    tradeName: text("trade_name"),
    uf: char("uf", { length: 2 }).notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    createdBy: uuid("created_by").references(() => users.id),
  },
  (t) => [uniqueIndex("companies_org_cnpj_idx").on(t.organizationId, t.cnpj), index("companies_org_idx").on(t.organizationId)],
);

/** Acesso explícito de usuário a empresa. Obrigatório para o papel `cliente`. */
export const companyAccess = pgTable(
  "company_access",
  {
    id: id(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    grantedBy: uuid("granted_by").references(() => users.id),
    grantedAt: createdAt(),
  },
  (t) => [uniqueIndex("company_access_company_user_idx").on(t.companyId, t.userId), index("company_access_user_idx").on(t.userId)],
);

/** Perfil fiscal versionado. Uma nova versão encerra a anterior (valid_to) sem apagá-la. */
export const companyFiscalProfiles = pgTable(
  "company_fiscal_profiles",
  {
    id: id(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    regime: regimeEnum("regime").notNull(),
    cnaes: jsonb("cnaes").$type<string[]>().notNull(),
    contribuinteIcms: boolean("contribuinte_icms").notNull(),
    parameters: jsonb("parameters").$type<Record<string, unknown>>().notNull().default({}),
    /** Origem da informação (ex.: cartão CNPJ, contrato social, declaração do cliente). */
    source: text("source").notNull(),
    notes: text("notes"),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    createdAt: createdAt(),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    supersededById: uuid("superseded_by_id"),
  },
  (t) => [uniqueIndex("fiscal_profiles_company_version_idx").on(t.companyId, t.version), index("fiscal_profiles_company_idx").on(t.companyId)],
);

export const nfeDocuments = pgTable(
  "nfe_documents",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    accessKey: char("access_key", { length: 44 }).notNull(),
    sha256: char("sha256", { length: 64 }).notNull(),
    /** XML original, byte a byte como recebido. Nunca é alterado. */
    rawXml: text("raw_xml").notNull(),
    fileName: text("file_name"),
    number: text("number").notNull(),
    series: text("series").notNull(),
    issuedAt: text("issued_at").notNull(),
    operation: text("operation").notNull(),
    issuerDocument: text("issuer_document").notNull(),
    issuerName: text("issuer_name").notNull(),
    issuerUf: text("issuer_uf").notNull(),
    recipientDocument: text("recipient_document").notNull(),
    recipientName: text("recipient_name").notNull(),
    recipientUf: text("recipient_uf").notNull(),
    totals: jsonb("totals").$type<Record<string, number | null>>().notNull(),
    warnings: jsonb("warnings").$type<string[]>().notNull(),
    itemCount: integer("item_count").notNull(),
    status: documentStatusEnum("status").notNull().default("IMPORTADA"),
    importedBy: uuid("imported_by").notNull().references(() => users.id),
    importedAt: createdAt(),
  },
  (t) => [
    uniqueIndex("nfe_documents_company_key_idx").on(t.companyId, t.accessKey),
    index("nfe_documents_company_imported_idx").on(t.companyId, t.importedAt),
  ],
);

export const nfeItems = pgTable(
  "nfe_items",
  {
    id: id(),
    documentId: uuid("document_id").notNull().references(() => nfeDocuments.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    line: integer("line").notNull(),
    code: text("code").notNull(),
    description: text("description").notNull(),
    ncm: text("ncm").notNull(),
    cest: text("cest").notNull(),
    cfop: text("cfop").notNull(),
    quantity: text("quantity").notNull(),
    unit: text("unit").notNull(),
    unitPrice: text("unit_price").notNull(),
    productCents: bigint("product_cents", { mode: "number" }).notNull(),
    freightCents: bigint("freight_cents", { mode: "number" }),
    insuranceCents: bigint("insurance_cents", { mode: "number" }),
    discountCents: bigint("discount_cents", { mode: "number" }),
    otherCents: bigint("other_cents", { mode: "number" }),
    declaredTaxes: jsonb("declared_taxes").$type<Record<string, string | number | null>>().notNull(),
    fingerprint: text("fingerprint").notNull(),
    classificationStatus: classificationStatusEnum("classification_status").notNull().default("PENDENTE_REVISAO"),
    reviewItemId: uuid("review_item_id"),
  },
  (t) => [index("nfe_items_document_idx").on(t.documentId), index("nfe_items_company_fingerprint_idx").on(t.companyId, t.fingerprint)],
);

/**
 * Produto pendente de classificação tributária (fila do Fiscal). Um por
 * (empresa, fingerprint) enquanto vigente; a decisão homologada é a "memória"
 * reaproveitada em importações futuras até ser encerrada por `valid_to`.
 */
export const reviewItems = pgTable(
  "review_items",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
    fingerprint: text("fingerprint").notNull(),
    ncm: text("ncm").notNull(),
    cest: text("cest").notNull(),
    description: text("description").notNull(),
    status: classificationStatusEnum("status").notNull().default("PENDENTE_REVISAO"),
    occurrences: integer("occurrences").notNull().default(1),
    firstDocumentId: uuid("first_document_id").references(() => nfeDocuments.id),
    lastDocumentId: uuid("last_document_id").references(() => nfeDocuments.id),
    assignedTo: uuid("assigned_to").references(() => users.id),
    /** Decisão do Fiscal: enquadramento, fundamento legal e observações. Nunca contém cálculo. */
    decision: jsonb("decision").$type<Record<string, unknown>>(),
    justification: text("justification"),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    validFrom: date("valid_from"),
    validTo: date("valid_to"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("review_items_open_idx").on(t.companyId, t.fingerprint).where(sql`${t.validTo} is null`),
    index("review_items_org_status_idx").on(t.organizationId, t.status),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 do token opaco entregue no cookie. O token em claro nunca é persistido. */
    tokenHash: char("token_hash", { length: 64 }).notNull().unique(),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    at: createdAt(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    organizationId: uuid("organization_id").references(() => organizations.id),
    companyId: uuid("company_id").references(() => companies.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ip: text("ip"),
  },
  (t) => [index("audit_events_org_at_idx").on(t.organizationId, t.at), index("audit_events_entity_idx").on(t.entityType, t.entityId)],
);

// ---------------------------------------------------------------------------
// Catálogo legal versionado (Sprint 2A.1 — ADR-007, docs/CATALOGO_LEGAL.md)
//
// Tudo é do escritório (organization_id). As referências entre tabelas usam
// chaves estrangeiras COMPOSTAS com organization_id: o banco impede que uma
// versão de regra da organização A cite um dispositivo da organização B.
// Append-only: triggers da migração 0002 bloqueiam DELETE e alteração de
// conteúdo; só colunas de ciclo de vida (status, encerramento) mudam.
// Sem colunas de alíquota, MVA, base ou valor: a 2A não calcula.
// ---------------------------------------------------------------------------

export const legalSourceKindEnum = pgEnum("legal_source_kind", [
  "LEI",
  "DECRETO",
  "CONVENIO",
  "PROTOCOLO",
  "AJUSTE_SINIEF",
  "PORTARIA",
  "RESOLUCAO",
  "ATO_TABELA",
  "FERRAMENTA_CONFRONTO",
  "INTERPRETACAO_ESCRITORIO",
  "BASE_LICENCIADA",
]);
/** Espécies normativas oficiais: as únicas que podem fundamentar uma regra. */
export const NORMATIVE_SOURCE_KINDS = ["LEI", "DECRETO", "CONVENIO", "PROTOCOLO", "AJUSTE_SINIEF", "PORTARIA", "RESOLUCAO", "ATO_TABELA"] as const;
export const jurisdictionEnum = pgEnum("legal_jurisdiction", ["FEDERAL", "CONFAZ", "UF"]);
export const licenseStatusEnum = pgEnum("legal_license_status", ["OFICIAL_PUBLICO", "LICENCIADO_CONFIRMADO", "LICENCA_NAO_VERIFICADA", "INTERNO"]);
export const snapshotMethodEnum = pgEnum("legal_snapshot_method", ["MANUAL", "IMPORTACAO_ASSISTIDA"]);
export const ruleLayerEnum = pgEnum("tax_rule_layer", ["CLASSIFICACAO", "INCIDENCIA"]);
export const ruleKindEnum = pgEnum("tax_rule_kind", [
  "SEGMENTO_ST",
  "INCIDENCIA_ST",
  "INCIDENCIA_ANTECIPACAO",
  "INCIDENCIA_DIFAL",
  "INCIDENCIA_ST_INTERNA",
  "OUTRO",
]);
export const ruleVersionStatusEnum = pgEnum("tax_rule_version_status", [
  "RASCUNHO",
  "EM_REVISAO_TECNICA",
  "APROVADA",
  "ATIVA",
  "SUSPENSA",
  "SUBSTITUIDA",
  "REVOGADA",
]);
export const ruleWorkflowActionEnum = pgEnum("tax_rule_workflow_action", ["SUBMETE", "APROVA", "DEVOLVE", "ATIVA", "SUSPENDE", "REATIVA", "REVOGA", "SUBSTITUI"]);
export const provisionRoleEnum = pgEnum("tax_rule_provision_role", ["FUNDAMENTO", "EXCECAO", "CONFRONTO", "INTERPRETACAO"]);

const normativeKindsSql = sql.raw(NORMATIVE_SOURCE_KINDS.map((k) => "'" + k + "'").join(", "));

/** A norma (ou ferramenta/interpretação/base registrada como tal). */
export const legalSources = pgTable(
  "legal_sources",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    kind: legalSourceKindEnum("kind").notNull(),
    jurisdiction: jurisdictionEnum("jurisdiction").notNull(),
    uf: char("uf", { length: 2 }),
    /** Órgão emissor (ex.: "Assembleia Sintética", "CONFAZ"). */
    issuer: text("issuer").notNull(),
    number: text("number"),
    title: text("title").notNull(),
    /** Data de publicação oficial — distinta do início de efeitos dos dispositivos. */
    publishedAt: date("published_at").notNull(),
    officialUrl: text("official_url"),
    /** Derivado da espécie e garantido por CHECK: só espécies oficiais são normativas. */
    normative: boolean("normative").notNull(),
    licenseStatus: licenseStatusEnum("license_status").notNull(),
    /** Instrumento que autoriza o uso (contrato, termo). Obrigatório se LICENCIADO_CONFIRMADO. */
    licenseReference: text("license_reference"),
    notes: text("notes"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    licenseUpdatedBy: uuid("license_updated_by").references(() => users.id),
    licenseUpdatedAt: timestamp("license_updated_at", { withTimezone: true }),
  },
  (t) => [
    unique("legal_sources_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("legal_sources_identity_idx")
      .on(t.organizationId, t.kind, t.jurisdiction, sql`coalesce(${t.uf}, '')`, t.number, t.publishedAt)
      .where(sql`${t.number} is not null`),
    index("legal_sources_org_idx").on(t.organizationId, t.createdAt),
    check("legal_sources_normative_ck", sql`${t.normative} = (${t.kind} in (${normativeKindsSql}))`),
    check("legal_sources_uf_ck", sql`(${t.jurisdiction} = 'UF') = (${t.uf} is not null)`),
    check("legal_sources_url_ck", sql`not ${t.normative} or ${t.officialUrl} is not null`),
    check("legal_sources_license_ref_ck", sql`${t.licenseStatus} <> 'LICENCIADO_CONFIRMADO' or length(trim(coalesce(${t.licenseReference}, ''))) >= 3`),
    check("legal_sources_interno_ck", sql`(${t.licenseStatus} = 'INTERNO') = (${t.kind} = 'INTERPRETACAO_ESCRITORIO')`),
    check("legal_sources_licenciada_ck", sql`${t.kind} <> 'BASE_LICENCIADA' or ${t.licenseStatus} in ('LICENCIADO_CONFIRMADO', 'LICENCA_NAO_VERIFICADA')`),
  ],
);

/** Proveniência: o que exatamente foi consultado, quando, por quem e com qual hash. */
export const legalSourceSnapshots = pgTable(
  "legal_source_snapshots",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull(),
    sourceId: uuid("source_id").notNull(),
    retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull(),
    retrievedBy: uuid("retrieved_by").notNull().references(() => users.id),
    url: text("url"),
    method: snapshotMethodEnum("method").notNull(),
    contentSha256: char("content_sha256", { length: 64 }).notNull(),
    /** Referência à área restrita onde a cópia fica guardada (nunca no Git). */
    storageRef: text("storage_ref"),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "legal_source_snapshots_source_fk", columns: [t.organizationId, t.sourceId], foreignColumns: [legalSources.organizationId, legalSources.id] }).onDelete("restrict"),
    unique("legal_source_snapshots_org_source_id_uq").on(t.organizationId, t.sourceId, t.id),
    uniqueIndex("legal_source_snapshots_hash_idx").on(t.sourceId, t.contentSha256),
    check("legal_source_snapshots_sha_ck", sql`${t.contentSha256} ~ '^[0-9a-f]{64}$'`),
  ],
);

/** O dispositivo citado (artigo, anexo, item), com vigência própria. */
export const legalProvisions = pgTable(
  "legal_provisions",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull(),
    sourceId: uuid("source_id").notNull(),
    snapshotId: uuid("snapshot_id").notNull(),
    reference: text("reference").notNull(),
    heading: text("heading"),
    /** Texto oficial: só para fonte OFICIAL_PUBLICO (atos oficiais, Lei 9.610/1998, art. 8º, IV). */
    officialText: text("official_text"),
    officialTextSha256: char("official_text_sha256", { length: 64 }),
    publishedAt: date("published_at").notNull(),
    effectsFrom: date("effects_from").notNull(),
    effectsTo: date("effects_to"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    effectsClosedBy: uuid("effects_closed_by").references(() => users.id),
    effectsClosedAt: timestamp("effects_closed_at", { withTimezone: true }),
    effectsClosedReason: text("effects_closed_reason"),
  },
  (t) => [
    foreignKey({ name: "legal_provisions_snapshot_fk", columns: [t.organizationId, t.sourceId, t.snapshotId], foreignColumns: [legalSourceSnapshots.organizationId, legalSourceSnapshots.sourceId, legalSourceSnapshots.id] }).onDelete("restrict"),
    unique("legal_provisions_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("legal_provisions_identity_idx").on(t.organizationId, t.sourceId, t.reference, t.effectsFrom),
    index("legal_provisions_source_idx").on(t.sourceId),
    check("legal_provisions_effects_ck", sql`${t.effectsTo} is null or ${t.effectsTo} >= ${t.effectsFrom}`),
    check("legal_provisions_text_hash_ck", sql`(${t.officialText} is null) = (${t.officialTextSha256} is null)`),
    check("legal_provisions_closed_ck", sql`(${t.effectsClosedAt} is null) = (${t.effectsClosedBy} is null)`),
  ],
);

/** Cabeçalho estável da regra curada pelo escritório. */
export const taxRules = pgTable(
  "tax_rules",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    layer: ruleLayerEnum("layer").notNull(),
    kind: ruleKindEnum("kind").notNull(),
    code: text("code").notNull(),
    title: text("title").notNull(),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique("tax_rules_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("tax_rules_org_code_idx").on(t.organizationId, t.code),
    check("tax_rules_code_ck", sql`${t.code} ~ '^[A-Z0-9][A-Z0-9_.-]{2,63}$'`),
    check(
      "tax_rules_layer_kind_ck",
      sql`(${t.layer} = 'CLASSIFICACAO' and ${t.kind} in ('SEGMENTO_ST', 'OUTRO')) or (${t.layer} = 'INCIDENCIA' and ${t.kind} <> 'SEGMENTO_ST')`,
    ),
  ],
);

/** Versões append-only: o conteúdo nunca é reescrito; mudança material = nova versão. */
export const taxRuleVersions = pgTable(
  "tax_rule_versions",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull(),
    ruleId: uuid("rule_id").notNull(),
    version: integer("version").notNull(),
    status: ruleVersionStatusEnum("status").notNull().default("RASCUNHO"),
    conditionsSchemaVersion: integer("conditions_schema_version").notNull(),
    /** Validado pelo schema Zod versionado (apps/api/src/modules/catalog/conditions.ts) antes de gravar. */
    conditions: jsonb("conditions").$type<Record<string, unknown>>().notNull(),
    /** SHA-256 do JSON canônico de condições + vigência + dispositivos citados. */
    contentSha256: char("content_sha256", { length: 64 }).notNull(),
    effectsFrom: date("effects_from").notNull(),
    effectsTo: date("effects_to"),
    /** Encerramento de vigência por substituição/revogação; o `effects_to` original fica intacto. */
    effectsEndedOn: date("effects_ended_on"),
    changeReason: text("change_reason").notNull(),
    authorId: uuid("author_id").notNull().references(() => users.id),
    createdAt: createdAt(),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).notNull().defaultNow(),
    supersededByVersionId: uuid("superseded_by_version_id"),
  },
  (t) => [
    foreignKey({ name: "tax_rule_versions_rule_fk", columns: [t.organizationId, t.ruleId], foreignColumns: [taxRules.organizationId, taxRules.id] }).onDelete("restrict"),
    unique("tax_rule_versions_org_id_uq").on(t.organizationId, t.id),
    unique("tax_rule_versions_org_id_author_uq").on(t.organizationId, t.id, t.authorId),
    unique("tax_rule_versions_org_rule_id_uq").on(t.organizationId, t.ruleId, t.id),
    foreignKey({ name: "tax_rule_versions_superseded_fk", columns: [t.organizationId, t.ruleId, t.supersededByVersionId], foreignColumns: [t.organizationId, t.ruleId, t.id] }).onDelete("restrict"),
    uniqueIndex("tax_rule_versions_rule_version_idx").on(t.ruleId, t.version),
    /** Uma única versão ATIVA por regra — garantia final contra ativações concorrentes. */
    uniqueIndex("tax_rule_versions_one_active_idx").on(t.ruleId).where(sql`${t.status} = 'ATIVA'`),
    /** No máximo uma versão em revisão técnica por regra. */
    uniqueIndex("tax_rule_versions_one_review_idx").on(t.ruleId).where(sql`${t.status} = 'EM_REVISAO_TECNICA'`),
    index("tax_rule_versions_org_status_idx").on(t.organizationId, t.status),
    check("tax_rule_versions_version_ck", sql`${t.version} >= 1`),
    check("tax_rule_versions_effects_ck", sql`${t.effectsTo} is null or ${t.effectsTo} >= ${t.effectsFrom}`),
    check("tax_rule_versions_sha_ck", sql`${t.contentSha256} ~ '^[0-9a-f]{64}$'`),
    check("tax_rule_versions_schema_ck", sql`${t.conditionsSchemaVersion} = 1 and (${t.conditions} ->> 'schemaVersion') = '1'`),
    check("tax_rule_versions_reason_ck", sql`length(trim(${t.changeReason})) >= 3`),
  ],
);

/** Dispositivos citados por uma versão (n:m). Gravados só na criação da versão. */
export const taxRuleVersionProvisions = pgTable(
  "tax_rule_version_provisions",
  {
    organizationId: uuid("organization_id").notNull(),
    ruleVersionId: uuid("rule_version_id").notNull(),
    provisionId: uuid("provision_id").notNull(),
    role: provisionRoleEnum("role").notNull(),
  },
  (t) => [
    primaryKey({ name: "tax_rule_version_provisions_pk", columns: [t.ruleVersionId, t.provisionId] }),
    foreignKey({ name: "tax_rule_version_provisions_version_fk", columns: [t.organizationId, t.ruleVersionId], foreignColumns: [taxRuleVersions.organizationId, taxRuleVersions.id] }).onDelete("restrict"),
    foreignKey({ name: "tax_rule_version_provisions_provision_fk", columns: [t.organizationId, t.provisionId], foreignColumns: [legalProvisions.organizationId, legalProvisions.id] }).onDelete("restrict"),
    index("tax_rule_version_provisions_provision_idx").on(t.provisionId),
  ],
);

/**
 * Trilha do workflow: toda transição de status de uma versão grava uma linha
 * aqui, na mesma transação (o trigger da 0002 recusa mudança de status sem ela).
 * `version_author_id` é cópia do autor garantida por FK composta, e o CHECK
 * de quatro olhos impede que o autor aprove, devolva ou ative a própria versão.
 */
export const taxRuleApprovals = pgTable(
  "tax_rule_approvals",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull(),
    ruleVersionId: uuid("rule_version_id").notNull(),
    versionAuthorId: uuid("version_author_id").notNull(),
    action: ruleWorkflowActionEnum("action").notNull(),
    fromStatus: ruleVersionStatusEnum("from_status").notNull(),
    toStatus: ruleVersionStatusEnum("to_status").notNull(),
    decidedBy: uuid("decided_by").notNull().references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
    justification: text("justification"),
    /** Registro externo da autorização de negócio (ata, decisão formal). Exigido em ATIVA/REATIVA. */
    authorizationReference: text("authorization_reference"),
  },
  (t) => [
    foreignKey({ name: "tax_rule_approvals_version_fk", columns: [t.organizationId, t.ruleVersionId, t.versionAuthorId], foreignColumns: [taxRuleVersions.organizationId, taxRuleVersions.id, taxRuleVersions.authorId] }).onDelete("restrict"),
    index("tax_rule_approvals_version_idx").on(t.ruleVersionId, t.decidedAt),
    uniqueIndex("tax_rule_approvals_one_approval_idx").on(t.ruleVersionId).where(sql`${t.action} = 'APROVA'`),
    uniqueIndex("tax_rule_approvals_one_activation_idx").on(t.ruleVersionId).where(sql`${t.action} = 'ATIVA'`),
    check(
      "tax_rule_approvals_transition_ck",
      sql`(${t.action} = 'SUBMETE' and ${t.fromStatus} = 'RASCUNHO' and ${t.toStatus} = 'EM_REVISAO_TECNICA')
        or (${t.action} = 'APROVA' and ${t.fromStatus} = 'EM_REVISAO_TECNICA' and ${t.toStatus} = 'APROVADA')
        or (${t.action} = 'DEVOLVE' and ${t.fromStatus} = 'EM_REVISAO_TECNICA' and ${t.toStatus} = 'RASCUNHO')
        or (${t.action} = 'ATIVA' and ${t.fromStatus} = 'APROVADA' and ${t.toStatus} = 'ATIVA')
        or (${t.action} = 'SUSPENDE' and ${t.fromStatus} = 'ATIVA' and ${t.toStatus} = 'SUSPENSA')
        or (${t.action} = 'REATIVA' and ${t.fromStatus} = 'SUSPENSA' and ${t.toStatus} = 'ATIVA')
        or (${t.action} = 'REVOGA' and ${t.fromStatus} in ('ATIVA', 'SUSPENSA') and ${t.toStatus} = 'REVOGADA')
        or (${t.action} = 'SUBSTITUI' and ${t.fromStatus} in ('RASCUNHO', 'APROVADA', 'ATIVA', 'SUSPENSA') and ${t.toStatus} = 'SUBSTITUIDA')`,
    ),
    check("tax_rule_approvals_four_eyes_ck", sql`${t.action} not in ('APROVA', 'DEVOLVE', 'ATIVA', 'REATIVA') or ${t.decidedBy} <> ${t.versionAuthorId}`),
    check("tax_rule_approvals_justification_ck", sql`${t.action} = 'SUBMETE' or length(trim(coalesce(${t.justification}, ''))) >= 3`),
    check("tax_rule_approvals_authorization_ck", sql`${t.action} not in ('ATIVA', 'REATIVA') or length(trim(coalesce(${t.authorizationReference}, ''))) >= 3`),
  ],
);

export type Role = (typeof roleEnum.enumValues)[number];
export type Regime = (typeof regimeEnum.enumValues)[number];
export type ClassificationStatus = (typeof classificationStatusEnum.enumValues)[number];
export type LegalSourceKind = (typeof legalSourceKindEnum.enumValues)[number];
export type LicenseStatus = (typeof licenseStatusEnum.enumValues)[number];
export type ProvisionRole = (typeof provisionRoleEnum.enumValues)[number];
