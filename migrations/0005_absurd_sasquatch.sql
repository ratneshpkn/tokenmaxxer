ALTER TYPE "public"."sync_job" ADD VALUE 'recommendations';--> statement-breakpoint
CREATE TABLE "model_recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"computed_date" date NOT NULL,
	"type" text DEFAULT 'cost_optimization' NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"suggested_model" text,
	"potential_savings_cents" integer,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "mr_email_date_idx" ON "model_recommendations" USING btree ("email","computed_date");