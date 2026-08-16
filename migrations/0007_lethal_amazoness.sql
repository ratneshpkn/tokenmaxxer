CREATE TABLE "team_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"user_email" varchar(320) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_user_email_tracked_users_email_fk" FOREIGN KEY ("user_email") REFERENCES "public"."tracked_users"("email") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "team_memberships_unique_idx" ON "team_memberships" USING btree ("team_id","user_email");--> statement-breakpoint
CREATE INDEX "team_memberships_team_id_idx" ON "team_memberships" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "team_memberships_user_email_idx" ON "team_memberships" USING btree ("user_email");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_name_idx" ON "teams" USING btree ("name");