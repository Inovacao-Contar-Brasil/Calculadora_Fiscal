import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
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

export type Role = (typeof roleEnum.enumValues)[number];
export type Regime = (typeof regimeEnum.enumValues)[number];
export type ClassificationStatus = (typeof classificationStatusEnum.enumValues)[number];
