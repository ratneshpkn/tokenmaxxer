ALTER TYPE "public"."sync_job" ADD VALUE 'github';--> statement-breakpoint
CREATE TABLE "daily_github_activity" (
	"date" date NOT NULL,
	"email" varchar(320) NOT NULL,
	"prs_opened" integer DEFAULT 0 NOT NULL,
	"prs_merged" integer DEFAULT 0 NOT NULL,
	"additions" integer DEFAULT 0 NOT NULL,
	"deletions" integer DEFAULT 0 NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_github_activity_date_email_pk" PRIMARY KEY("date","email")
);
--> statement-breakpoint
CREATE TABLE "github_pull_requests" (
	"repo" text NOT NULL,
	"number" integer NOT NULL,
	"email" varchar(320) NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"additions" integer DEFAULT 0 NOT NULL,
	"deletions" integer DEFAULT 0 NOT NULL,
	"merged_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_pull_requests_repo_number_pk" PRIMARY KEY("repo","number")
);
--> statement-breakpoint
ALTER TABLE "app_config" ADD COLUMN "github_access_token_enc" text;--> statement-breakpoint
ALTER TABLE "app_config" ADD COLUMN "github_org" text;--> statement-breakpoint
ALTER TABLE "tracked_users" ADD COLUMN "github_username" text;--> statement-breakpoint
CREATE INDEX "dga_email_date_idx" ON "daily_github_activity" USING btree ("email","date");--> statement-breakpoint
CREATE INDEX "dga_date_idx" ON "daily_github_activity" USING btree ("date");--> statement-breakpoint
CREATE INDEX "gpr_email_merged_idx" ON "github_pull_requests" USING btree ("email","merged_at");--> statement-breakpoint
CREATE INDEX "gpr_email_opened_idx" ON "github_pull_requests" USING btree ("email","opened_at");