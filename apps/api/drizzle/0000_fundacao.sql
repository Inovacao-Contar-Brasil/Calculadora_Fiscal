CREATE TYPE "public"."classification_status" AS ENUM('PENDENTE_REVISAO', 'EM_ANALISE', 'HOMOLOGADO', 'REJEITADO');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('IMPORTADA', 'COM_PENDENCIAS', 'REVISADA');--> statement-breakpoint
CREATE TYPE "public"."regime_tributario" AS ENUM('SIMPLES_NACIONAL', 'LUCRO_PRESUMIDO', 'LUCRO_REAL', 'MEI', 'OUTRO');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('admin', 'fiscal', 'cliente');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"organization_id" uuid,
	"company_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"cnpj" char(14) NOT NULL,
	"legal_name" text NOT NULL,
	"trade_name" text,
	"uf" char(2) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "company_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"granted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_fiscal_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"regime" "regime_tributario" NOT NULL,
	"cnaes" jsonb NOT NULL,
	"contribuinte_icms" boolean NOT NULL,
	"parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" text NOT NULL,
	"notes" text,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"superseded_at" timestamp with time zone,
	"superseded_by_id" uuid
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"role" "membership_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "nfe_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"access_key" char(44) NOT NULL,
	"sha256" char(64) NOT NULL,
	"raw_xml" text NOT NULL,
	"file_name" text,
	"number" text NOT NULL,
	"series" text NOT NULL,
	"issued_at" text NOT NULL,
	"operation" text NOT NULL,
	"issuer_document" text NOT NULL,
	"issuer_name" text NOT NULL,
	"issuer_uf" text NOT NULL,
	"recipient_document" text NOT NULL,
	"recipient_name" text NOT NULL,
	"recipient_uf" text NOT NULL,
	"totals" jsonb NOT NULL,
	"warnings" jsonb NOT NULL,
	"item_count" integer NOT NULL,
	"status" "document_status" DEFAULT 'IMPORTADA' NOT NULL,
	"imported_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nfe_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"line" integer NOT NULL,
	"code" text NOT NULL,
	"description" text NOT NULL,
	"ncm" text NOT NULL,
	"cest" text NOT NULL,
	"cfop" text NOT NULL,
	"quantity" text NOT NULL,
	"unit" text NOT NULL,
	"unit_price" text NOT NULL,
	"product_cents" bigint NOT NULL,
	"freight_cents" bigint,
	"insurance_cents" bigint,
	"discount_cents" bigint,
	"other_cents" bigint,
	"declared_taxes" jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"classification_status" "classification_status" DEFAULT 'PENDENTE_REVISAO' NOT NULL,
	"review_item_id" uuid
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "review_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"ncm" text NOT NULL,
	"cest" text NOT NULL,
	"description" text NOT NULL,
	"status" "classification_status" DEFAULT 'PENDENTE_REVISAO' NOT NULL,
	"occurrences" integer DEFAULT 1 NOT NULL,
	"first_document_id" uuid,
	"last_document_id" uuid,
	"assigned_to" uuid,
	"decision" jsonb,
	"justification" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"valid_from" date,
	"valid_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" char(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip" text,
	"user_agent" text,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_access" ADD CONSTRAINT "company_access_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_access" ADD CONSTRAINT "company_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_access" ADD CONSTRAINT "company_access_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_fiscal_profiles" ADD CONSTRAINT "company_fiscal_profiles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_fiscal_profiles" ADD CONSTRAINT "company_fiscal_profiles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfe_documents" ADD CONSTRAINT "nfe_documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfe_documents" ADD CONSTRAINT "nfe_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfe_documents" ADD CONSTRAINT "nfe_documents_imported_by_users_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfe_items" ADD CONSTRAINT "nfe_items_document_id_nfe_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."nfe_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfe_items" ADD CONSTRAINT "nfe_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_first_document_id_nfe_documents_id_fk" FOREIGN KEY ("first_document_id") REFERENCES "public"."nfe_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_last_document_id_nfe_documents_id_fk" FOREIGN KEY ("last_document_id") REFERENCES "public"."nfe_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_org_at_idx" ON "audit_events" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "companies_org_cnpj_idx" ON "companies" USING btree ("organization_id","cnpj");--> statement-breakpoint
CREATE INDEX "companies_org_idx" ON "companies" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_access_company_user_idx" ON "company_access" USING btree ("company_id","user_id");--> statement-breakpoint
CREATE INDEX "company_access_user_idx" ON "company_access" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_profiles_company_version_idx" ON "company_fiscal_profiles" USING btree ("company_id","version");--> statement-breakpoint
CREATE INDEX "fiscal_profiles_company_idx" ON "company_fiscal_profiles" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_user_org_idx" ON "memberships" USING btree ("user_id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "nfe_documents_company_key_idx" ON "nfe_documents" USING btree ("company_id","access_key");--> statement-breakpoint
CREATE INDEX "nfe_documents_company_imported_idx" ON "nfe_documents" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "nfe_items_document_idx" ON "nfe_items" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "nfe_items_company_fingerprint_idx" ON "nfe_items" USING btree ("company_id","fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "review_items_open_idx" ON "review_items" USING btree ("company_id","fingerprint") WHERE "review_items"."valid_to" is null;--> statement-breakpoint
CREATE INDEX "review_items_org_status_idx" ON "review_items" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_idx" ON "users" USING btree (lower("email"));