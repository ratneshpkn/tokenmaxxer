ALTER TYPE "public"."sync_job" ADD VALUE 'pr_files' BEFORE 'recommendations';--> statement-breakpoint
ALTER TABLE "github_pr_enrichments" ADD COLUMN "eff_lines_changed" integer;--> statement-breakpoint
ALTER TABLE "github_pr_enrichments" ADD COLUMN "eff_files" integer;--> statement-breakpoint
ALTER TABLE "github_pr_enrichments" ADD COLUMN "breadth" integer;--> statement-breakpoint
ALTER TABLE "github_pr_enrichments" ADD COLUMN "lang_span" integer;--> statement-breakpoint
ALTER TABLE "github_pr_enrichments" ADD COLUMN "mechanical" boolean;--> statement-breakpoint
ALTER TABLE "github_pr_enrichments" ADD COLUMN "sensitive" boolean;--> statement-breakpoint
ALTER TABLE "github_pr_enrichments" ADD COLUMN "content_kind" varchar(30);--> statement-breakpoint
ALTER TABLE "github_pull_requests" ADD COLUMN "body" text;--> statement-breakpoint
ALTER TABLE "github_pull_requests" ADD COLUMN "files" jsonb;