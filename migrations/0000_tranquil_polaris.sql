CREATE TYPE "public"."alert_scope" AS ENUM('global', 'user');--> statement-breakpoint
CREATE TYPE "public"."alert_status" AS ENUM('open', 'acknowledged', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."app_user_role" AS ENUM('viewer', 'admin');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('claude_code', 'cursor');--> statement-breakpoint
CREATE TYPE "public"."sync_job" AS ENUM('anthropic', 'cursor', 'alerts', 'slack_digest');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('success', 'failed', 'running');--> statement-breakpoint
CREATE TABLE "alert_thresholds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" "alert_scope" NOT NULL,
	"email" varchar(320),
	"platform" "platform" NOT NULL,
	"daily_cents" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"email" varchar(320) NOT NULL,
	"platform" "platform" NOT NULL,
	"amount_cents" integer NOT NULL,
	"threshold_cents" integer NOT NULL,
	"status" "alert_status" DEFAULT 'open' NOT NULL,
	"channels_sent" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "anthropic_api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" text,
	"workspace_id" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "anthropic_users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" varchar(320) NOT NULL,
	"name" text,
	"role" text,
	"added_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_config" (
	"id" integer PRIMARY KEY NOT NULL,
	"org_name" text DEFAULT '' NOT NULL,
	"allowed_email_domain" text,
	"open_signup_enabled" boolean DEFAULT false NOT NULL,
	"google_oauth_enabled" boolean DEFAULT false NOT NULL,
	"google_client_id" text,
	"google_client_secret_enc" text,
	"google_oauth_redirect_uri" text,
	"anthropic_admin_api_key_enc" text,
	"cursor_admin_api_key_enc" text,
	"slack_bot_token_enc" text,
	"slack_channel_id" text,
	"claude_code_daily_threshold_cents" integer DEFAULT 5000 NOT NULL,
	"cursor_daily_threshold_cents" integer DEFAULT 5000 NOT NULL,
	"claude_code_workspace_id" text,
	"bootstrap_admin_user_id" uuid,
	"setup_completed_at" timestamp with time zone,
	"encryption_key_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"name" text,
	"role" "app_user_role" DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	"password_hash" text,
	"google_id" text
);
--> statement-breakpoint
CREATE TABLE "cursor_members" (
	"id" text PRIMARY KEY NOT NULL,
	"email" varchar(320) NOT NULL,
	"name" text,
	"role" text,
	"is_removed" boolean DEFAULT false NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cursor_spend_snapshots" (
	"snapshot_date" date NOT NULL,
	"email" varchar(320) NOT NULL,
	"spend_cents" integer DEFAULT 0 NOT NULL,
	"overall_spend_cents" integer DEFAULT 0 NOT NULL,
	"fast_premium_requests" integer DEFAULT 0 NOT NULL,
	"hard_limit_dollars" integer,
	"monthly_limit_dollars" integer,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cursor_spend_snapshots_snapshot_date_email_pk" PRIMARY KEY("snapshot_date","email")
);
--> statement-breakpoint
CREATE TABLE "daily_anthropic_cost_totals" (
	"date" date NOT NULL,
	"workspace_id" text DEFAULT '' NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"service_tier" text DEFAULT '' NOT NULL,
	"context_window" text DEFAULT '' NOT NULL,
	"inference_geo" text DEFAULT '' NOT NULL,
	"token_type" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_anthropic_cost_totals_date_workspace_id_model_service_tier_context_window_inference_geo_token_type_pk" PRIMARY KEY("date","workspace_id","model","service_tier","context_window","inference_geo","token_type")
);
--> statement-breakpoint
CREATE TABLE "daily_claude_code_attribution" (
	"date" date NOT NULL,
	"email" varchar(320) NOT NULL,
	"model" text NOT NULL,
	"uncached_input_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_read_input_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_creation_5m_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_creation_1h_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"attributed_cents" integer DEFAULT 0 NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_claude_code_attribution_date_email_model_pk" PRIMARY KEY("date","email","model")
);
--> statement-breakpoint
CREATE TABLE "daily_cursor_usage" (
	"date" date NOT NULL,
	"email" varchar(320) NOT NULL,
	"model" text NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_read_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_write_tokens" bigint DEFAULT 0 NOT NULL,
	"charged_cents" integer DEFAULT 0 NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_cursor_usage_date_email_model_pk" PRIMARY KEY("date","email","model")
);
--> statement-breakpoint
CREATE TABLE "daily_message_usage" (
	"date" date NOT NULL,
	"workspace_id" text DEFAULT '' NOT NULL,
	"api_key_id" text NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"service_tier" text DEFAULT '' NOT NULL,
	"context_window" text DEFAULT '' NOT NULL,
	"uncached_input_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_read_input_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_creation_5m_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_creation_1h_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"web_search_requests" integer DEFAULT 0 NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_message_usage_date_workspace_id_api_key_id_model_service_tier_context_window_pk" PRIMARY KEY("date","workspace_id","api_key_id","model","service_tier","context_window")
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"role" "app_user_role" NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consumed_at" timestamp with time zone,
	"consumed_user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job" "sync_job" NOT NULL,
	"status" "sync_status" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"rows_upserted" integer DEFAULT 0 NOT NULL,
	"error" text,
	"triggered_by" text
);
--> statement-breakpoint
CREATE TABLE "tracked_users" (
	"email" varchar(320) PRIMARY KEY NOT NULL,
	"name" text,
	"anthropic_user_id" text,
	"cursor_user_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_consumed_user_id_app_users_id_fk" FOREIGN KEY ("consumed_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "at_scope_platform_idx" ON "alert_thresholds" USING btree ("scope","platform");--> statement-breakpoint
CREATE INDEX "at_user_platform_idx" ON "alert_thresholds" USING btree ("email","platform");--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_date_email_platform_idx" ON "alerts" USING btree ("date","email","platform");--> statement-breakpoint
CREATE INDEX "alerts_status_idx" ON "alerts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "alerts_email_idx" ON "alerts" USING btree ("email");--> statement-breakpoint
CREATE INDEX "anthropic_api_keys_name_idx" ON "anthropic_api_keys" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "app_users_email_idx" ON "app_users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "app_users_google_id_idx" ON "app_users" USING btree ("google_id") WHERE "app_users"."google_id" is not null;--> statement-breakpoint
CREATE INDEX "dact_date_ws_idx" ON "daily_anthropic_cost_totals" USING btree ("date","workspace_id");--> statement-breakpoint
CREATE INDEX "dcca_email_date_idx" ON "daily_claude_code_attribution" USING btree ("email","date");--> statement-breakpoint
CREATE INDEX "dcca_date_idx" ON "daily_claude_code_attribution" USING btree ("date");--> statement-breakpoint
CREATE INDEX "dcu_email_date_idx" ON "daily_cursor_usage" USING btree ("email","date");--> statement-breakpoint
CREATE INDEX "dcu_date_idx" ON "daily_cursor_usage" USING btree ("date");--> statement-breakpoint
CREATE INDEX "dmu_date_ws_idx" ON "daily_message_usage" USING btree ("date","workspace_id");--> statement-breakpoint
CREATE INDEX "dmu_api_key_idx" ON "daily_message_usage" USING btree ("api_key_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_idx" ON "invitations" USING btree ("token");--> statement-breakpoint
CREATE INDEX "invitations_email_idx" ON "invitations" USING btree ("email");--> statement-breakpoint
CREATE INDEX "sync_runs_job_started_idx" ON "sync_runs" USING btree ("job","started_at");