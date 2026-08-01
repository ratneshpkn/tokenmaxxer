ALTER TYPE "public"."sync_job" ADD VALUE 'prs_enrich';--> statement-breakpoint
CREATE TABLE "github_pr_enrichments" (
	"repo" text NOT NULL,
	"number" integer NOT NULL,
	"category" varchar(50) DEFAULT 'other' NOT NULL,
	"complexity_score" integer DEFAULT 3 NOT NULL,
	"complexity_reason" text,
	"summary" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_pr_enrichments_repo_number_pk" PRIMARY KEY("repo","number")
);
--> statement-breakpoint
ALTER TABLE "app_config" ADD COLUMN "enrichment_provider" text;--> statement-breakpoint
ALTER TABLE "app_config" ADD COLUMN "enrichment_api_key_enc" text;--> statement-breakpoint
ALTER TABLE "app_config" ADD COLUMN "enrichment_model_name" text;--> statement-breakpoint
ALTER TABLE "app_config" ADD COLUMN "enrichment_base_url" text;--> statement-breakpoint
CREATE INDEX "gpe_category_idx" ON "github_pr_enrichments" USING btree ("category");--> statement-breakpoint
CREATE INDEX "gpe_complexity_idx" ON "github_pr_enrichments" USING btree ("complexity_score");