CREATE TYPE "public"."legal_jurisdiction" AS ENUM('FEDERAL', 'CONFAZ', 'UF');--> statement-breakpoint
CREATE TYPE "public"."legal_source_kind" AS ENUM('LEI', 'DECRETO', 'CONVENIO', 'PROTOCOLO', 'AJUSTE_SINIEF', 'PORTARIA', 'RESOLUCAO', 'ATO_TABELA', 'FERRAMENTA_CONFRONTO', 'INTERPRETACAO_ESCRITORIO', 'BASE_LICENCIADA');--> statement-breakpoint
CREATE TYPE "public"."legal_license_status" AS ENUM('OFICIAL_PUBLICO', 'LICENCIADO_CONFIRMADO', 'LICENCA_NAO_VERIFICADA', 'INTERNO');--> statement-breakpoint
CREATE TYPE "public"."tax_rule_provision_role" AS ENUM('FUNDAMENTO', 'EXCECAO', 'CONFRONTO', 'INTERPRETACAO');--> statement-breakpoint
CREATE TYPE "public"."tax_rule_kind" AS ENUM('SEGMENTO_ST', 'INCIDENCIA_ST', 'INCIDENCIA_ANTECIPACAO', 'INCIDENCIA_DIFAL', 'INCIDENCIA_ST_INTERNA', 'OUTRO');--> statement-breakpoint
CREATE TYPE "public"."tax_rule_layer" AS ENUM('CLASSIFICACAO', 'INCIDENCIA');--> statement-breakpoint
CREATE TYPE "public"."tax_rule_version_status" AS ENUM('RASCUNHO', 'EM_REVISAO_TECNICA', 'APROVADA', 'ATIVA', 'SUSPENSA', 'SUBSTITUIDA', 'REVOGADA');--> statement-breakpoint
CREATE TYPE "public"."tax_rule_workflow_action" AS ENUM('SUBMETE', 'APROVA', 'DEVOLVE', 'ATIVA', 'SUSPENDE', 'REATIVA', 'REVOGA', 'SUBSTITUI');--> statement-breakpoint
CREATE TYPE "public"."legal_snapshot_method" AS ENUM('MANUAL', 'IMPORTACAO_ASSISTIDA');--> statement-breakpoint
CREATE TABLE "legal_provisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"heading" text,
	"official_text" text,
	"official_text_sha256" char(64),
	"published_at" date NOT NULL,
	"effects_from" date NOT NULL,
	"effects_to" date,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"effects_closed_by" uuid,
	"effects_closed_at" timestamp with time zone,
	"effects_closed_reason" text,
	CONSTRAINT "legal_provisions_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "legal_provisions_effects_ck" CHECK ("legal_provisions"."effects_to" is null or "legal_provisions"."effects_to" >= "legal_provisions"."effects_from"),
	CONSTRAINT "legal_provisions_text_hash_ck" CHECK (("legal_provisions"."official_text" is null) = ("legal_provisions"."official_text_sha256" is null)),
	CONSTRAINT "legal_provisions_closed_ck" CHECK (("legal_provisions"."effects_closed_at" is null) = ("legal_provisions"."effects_closed_by" is null))
);
--> statement-breakpoint
CREATE TABLE "legal_source_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	"retrieved_by" uuid NOT NULL,
	"url" text,
	"method" "legal_snapshot_method" NOT NULL,
	"content_sha256" char(64) NOT NULL,
	"storage_ref" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legal_source_snapshots_org_source_id_uq" UNIQUE("organization_id","source_id","id"),
	CONSTRAINT "legal_source_snapshots_sha_ck" CHECK ("legal_source_snapshots"."content_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "legal_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" "legal_source_kind" NOT NULL,
	"jurisdiction" "legal_jurisdiction" NOT NULL,
	"uf" char(2),
	"issuer" text NOT NULL,
	"number" text,
	"title" text NOT NULL,
	"published_at" date NOT NULL,
	"official_url" text,
	"normative" boolean NOT NULL,
	"license_status" "legal_license_status" NOT NULL,
	"license_reference" text,
	"notes" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"license_updated_by" uuid,
	"license_updated_at" timestamp with time zone,
	CONSTRAINT "legal_sources_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "legal_sources_normative_ck" CHECK ("legal_sources"."normative" = ("legal_sources"."kind" in ('LEI', 'DECRETO', 'CONVENIO', 'PROTOCOLO', 'AJUSTE_SINIEF', 'PORTARIA', 'RESOLUCAO', 'ATO_TABELA'))),
	CONSTRAINT "legal_sources_uf_ck" CHECK (("legal_sources"."jurisdiction" = 'UF') = ("legal_sources"."uf" is not null)),
	CONSTRAINT "legal_sources_url_ck" CHECK (not "legal_sources"."normative" or "legal_sources"."official_url" is not null),
	CONSTRAINT "legal_sources_license_ref_ck" CHECK ("legal_sources"."license_status" <> 'LICENCIADO_CONFIRMADO' or length(trim(coalesce("legal_sources"."license_reference", ''))) >= 3),
	CONSTRAINT "legal_sources_interno_ck" CHECK (("legal_sources"."license_status" = 'INTERNO') = ("legal_sources"."kind" = 'INTERPRETACAO_ESCRITORIO')),
	CONSTRAINT "legal_sources_licenciada_ck" CHECK ("legal_sources"."kind" <> 'BASE_LICENCIADA' or "legal_sources"."license_status" in ('LICENCIADO_CONFIRMADO', 'LICENCA_NAO_VERIFICADA'))
);
--> statement-breakpoint
CREATE TABLE "tax_rule_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"rule_version_id" uuid NOT NULL,
	"version_author_id" uuid NOT NULL,
	"action" "tax_rule_workflow_action" NOT NULL,
	"from_status" "tax_rule_version_status" NOT NULL,
	"to_status" "tax_rule_version_status" NOT NULL,
	"decided_by" uuid NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"justification" text,
	"authorization_reference" text,
	CONSTRAINT "tax_rule_approvals_transition_ck" CHECK (("tax_rule_approvals"."action" = 'SUBMETE' and "tax_rule_approvals"."from_status" = 'RASCUNHO' and "tax_rule_approvals"."to_status" = 'EM_REVISAO_TECNICA')
        or ("tax_rule_approvals"."action" = 'APROVA' and "tax_rule_approvals"."from_status" = 'EM_REVISAO_TECNICA' and "tax_rule_approvals"."to_status" = 'APROVADA')
        or ("tax_rule_approvals"."action" = 'DEVOLVE' and "tax_rule_approvals"."from_status" = 'EM_REVISAO_TECNICA' and "tax_rule_approvals"."to_status" = 'RASCUNHO')
        or ("tax_rule_approvals"."action" = 'ATIVA' and "tax_rule_approvals"."from_status" = 'APROVADA' and "tax_rule_approvals"."to_status" = 'ATIVA')
        or ("tax_rule_approvals"."action" = 'SUSPENDE' and "tax_rule_approvals"."from_status" = 'ATIVA' and "tax_rule_approvals"."to_status" = 'SUSPENSA')
        or ("tax_rule_approvals"."action" = 'REATIVA' and "tax_rule_approvals"."from_status" = 'SUSPENSA' and "tax_rule_approvals"."to_status" = 'ATIVA')
        or ("tax_rule_approvals"."action" = 'REVOGA' and "tax_rule_approvals"."from_status" in ('ATIVA', 'SUSPENSA') and "tax_rule_approvals"."to_status" = 'REVOGADA')
        or ("tax_rule_approvals"."action" = 'SUBSTITUI' and "tax_rule_approvals"."from_status" in ('RASCUNHO', 'APROVADA', 'ATIVA', 'SUSPENSA') and "tax_rule_approvals"."to_status" = 'SUBSTITUIDA')),
	CONSTRAINT "tax_rule_approvals_four_eyes_ck" CHECK ("tax_rule_approvals"."action" not in ('APROVA', 'DEVOLVE', 'ATIVA', 'REATIVA') or "tax_rule_approvals"."decided_by" <> "tax_rule_approvals"."version_author_id"),
	CONSTRAINT "tax_rule_approvals_justification_ck" CHECK ("tax_rule_approvals"."action" = 'SUBMETE' or length(trim(coalesce("tax_rule_approvals"."justification", ''))) >= 3),
	CONSTRAINT "tax_rule_approvals_authorization_ck" CHECK ("tax_rule_approvals"."action" not in ('ATIVA', 'REATIVA') or length(trim(coalesce("tax_rule_approvals"."authorization_reference", ''))) >= 3)
);
--> statement-breakpoint
CREATE TABLE "tax_rule_version_provisions" (
	"organization_id" uuid NOT NULL,
	"rule_version_id" uuid NOT NULL,
	"provision_id" uuid NOT NULL,
	"role" "tax_rule_provision_role" NOT NULL,
	CONSTRAINT "tax_rule_version_provisions_pk" PRIMARY KEY("rule_version_id","provision_id")
);
--> statement-breakpoint
CREATE TABLE "tax_rule_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "tax_rule_version_status" DEFAULT 'RASCUNHO' NOT NULL,
	"conditions_schema_version" integer NOT NULL,
	"conditions" jsonb NOT NULL,
	"content_sha256" char(64) NOT NULL,
	"effects_from" date NOT NULL,
	"effects_to" date,
	"effects_ended_on" date,
	"change_reason" text NOT NULL,
	"author_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_by_version_id" uuid,
	CONSTRAINT "tax_rule_versions_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "tax_rule_versions_org_id_author_uq" UNIQUE("organization_id","id","author_id"),
	CONSTRAINT "tax_rule_versions_org_rule_id_uq" UNIQUE("organization_id","rule_id","id"),
	CONSTRAINT "tax_rule_versions_version_ck" CHECK ("tax_rule_versions"."version" >= 1),
	CONSTRAINT "tax_rule_versions_effects_ck" CHECK ("tax_rule_versions"."effects_to" is null or "tax_rule_versions"."effects_to" >= "tax_rule_versions"."effects_from"),
	CONSTRAINT "tax_rule_versions_sha_ck" CHECK ("tax_rule_versions"."content_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "tax_rule_versions_schema_ck" CHECK ("tax_rule_versions"."conditions_schema_version" = 1 and ("tax_rule_versions"."conditions" ->> 'schemaVersion') = '1'),
	CONSTRAINT "tax_rule_versions_reason_ck" CHECK (length(trim("tax_rule_versions"."change_reason")) >= 3)
);
--> statement-breakpoint
CREATE TABLE "tax_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"layer" "tax_rule_layer" NOT NULL,
	"kind" "tax_rule_kind" NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_rules_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "tax_rules_code_ck" CHECK ("tax_rules"."code" ~ '^[A-Z0-9][A-Z0-9_.-]{2,63}$'),
	CONSTRAINT "tax_rules_layer_kind_ck" CHECK (("tax_rules"."layer" = 'CLASSIFICACAO' and "tax_rules"."kind" in ('SEGMENTO_ST', 'OUTRO')) or ("tax_rules"."layer" = 'INCIDENCIA' and "tax_rules"."kind" <> 'SEGMENTO_ST'))
);
--> statement-breakpoint
ALTER TABLE "legal_provisions" ADD CONSTRAINT "legal_provisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_provisions" ADD CONSTRAINT "legal_provisions_effects_closed_by_users_id_fk" FOREIGN KEY ("effects_closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_provisions" ADD CONSTRAINT "legal_provisions_snapshot_fk" FOREIGN KEY ("organization_id","source_id","snapshot_id") REFERENCES "public"."legal_source_snapshots"("organization_id","source_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_source_snapshots" ADD CONSTRAINT "legal_source_snapshots_retrieved_by_users_id_fk" FOREIGN KEY ("retrieved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_source_snapshots" ADD CONSTRAINT "legal_source_snapshots_source_fk" FOREIGN KEY ("organization_id","source_id") REFERENCES "public"."legal_sources"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_sources" ADD CONSTRAINT "legal_sources_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_sources" ADD CONSTRAINT "legal_sources_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_sources" ADD CONSTRAINT "legal_sources_license_updated_by_users_id_fk" FOREIGN KEY ("license_updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rule_approvals" ADD CONSTRAINT "tax_rule_approvals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rule_approvals" ADD CONSTRAINT "tax_rule_approvals_version_fk" FOREIGN KEY ("organization_id","rule_version_id","version_author_id") REFERENCES "public"."tax_rule_versions"("organization_id","id","author_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rule_version_provisions" ADD CONSTRAINT "tax_rule_version_provisions_version_fk" FOREIGN KEY ("organization_id","rule_version_id") REFERENCES "public"."tax_rule_versions"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rule_version_provisions" ADD CONSTRAINT "tax_rule_version_provisions_provision_fk" FOREIGN KEY ("organization_id","provision_id") REFERENCES "public"."legal_provisions"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rule_versions" ADD CONSTRAINT "tax_rule_versions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rule_versions" ADD CONSTRAINT "tax_rule_versions_rule_fk" FOREIGN KEY ("organization_id","rule_id") REFERENCES "public"."tax_rules"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rule_versions" ADD CONSTRAINT "tax_rule_versions_superseded_fk" FOREIGN KEY ("organization_id","rule_id","superseded_by_version_id") REFERENCES "public"."tax_rule_versions"("organization_id","rule_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rules" ADD CONSTRAINT "tax_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rules" ADD CONSTRAINT "tax_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "legal_provisions_identity_idx" ON "legal_provisions" USING btree ("organization_id","source_id","reference","effects_from");--> statement-breakpoint
CREATE INDEX "legal_provisions_source_idx" ON "legal_provisions" USING btree ("source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "legal_source_snapshots_hash_idx" ON "legal_source_snapshots" USING btree ("source_id","content_sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "legal_sources_identity_idx" ON "legal_sources" USING btree ("organization_id","kind","jurisdiction",coalesce("uf", ''),"number","published_at") WHERE "legal_sources"."number" is not null;--> statement-breakpoint
CREATE INDEX "legal_sources_org_idx" ON "legal_sources" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "tax_rule_approvals_version_idx" ON "tax_rule_approvals" USING btree ("rule_version_id","decided_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_rule_approvals_one_approval_idx" ON "tax_rule_approvals" USING btree ("rule_version_id") WHERE "tax_rule_approvals"."action" = 'APROVA';--> statement-breakpoint
CREATE UNIQUE INDEX "tax_rule_approvals_one_activation_idx" ON "tax_rule_approvals" USING btree ("rule_version_id") WHERE "tax_rule_approvals"."action" = 'ATIVA';--> statement-breakpoint
CREATE INDEX "tax_rule_version_provisions_provision_idx" ON "tax_rule_version_provisions" USING btree ("provision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_rule_versions_rule_version_idx" ON "tax_rule_versions" USING btree ("rule_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_rule_versions_one_active_idx" ON "tax_rule_versions" USING btree ("rule_id") WHERE "tax_rule_versions"."status" = 'ATIVA';--> statement-breakpoint
CREATE UNIQUE INDEX "tax_rule_versions_one_review_idx" ON "tax_rule_versions" USING btree ("rule_id") WHERE "tax_rule_versions"."status" = 'EM_REVISAO_TECNICA';--> statement-breakpoint
CREATE INDEX "tax_rule_versions_org_status_idx" ON "tax_rule_versions" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_rules_org_code_idx" ON "tax_rules" USING btree ("organization_id","code");