CREATE TABLE "ops_guards" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"lesson_id" text,
	"kind" text NOT NULL,
	"params" text DEFAULT '{}' NOT NULL,
	"scope" text DEFAULT 'team' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"switched_off_by" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_lessons" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"what" text NOT NULL,
	"why" text NOT NULL,
	"rule" text NOT NULL,
	"scope" text DEFAULT 'team' NOT NULL,
	"strength" text DEFAULT 'reminder' NOT NULL,
	"source" text NOT NULL,
	"evidence_job_id" text,
	"evidence" text,
	"status" text DEFAULT 'active' NOT NULL,
	"retired_reason" text,
	"last_matched_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_preferences" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"text" text NOT NULL,
	"scope" text DEFAULT 'team' NOT NULL,
	"source" text NOT NULL,
	"job_id" text,
	"created_by" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_sheet_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"sheet_id" text NOT NULL,
	"version" integer NOT NULL,
	"body" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_sheets" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ops_guards" ADD CONSTRAINT "ops_guards_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_guards" ADD CONSTRAINT "ops_guards_lesson_id_ops_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."ops_lessons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_lessons" ADD CONSTRAINT "ops_lessons_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_preferences" ADD CONSTRAINT "ops_preferences_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_preferences" ADD CONSTRAINT "ops_preferences_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_sheet_versions" ADD CONSTRAINT "ops_sheet_versions_sheet_id_ops_sheets_id_fk" FOREIGN KEY ("sheet_id") REFERENCES "public"."ops_sheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_sheets" ADD CONSTRAINT "ops_sheets_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ops_guards_team_idx" ON "ops_guards" USING btree ("team_id","active");--> statement-breakpoint
CREATE INDEX "ops_lessons_team_idx" ON "ops_lessons" USING btree ("team_id","status");--> statement-breakpoint
CREATE INDEX "ops_preferences_team_idx" ON "ops_preferences" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "ops_sheet_versions_sheet_idx" ON "ops_sheet_versions" USING btree ("sheet_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "ops_sheets_subject_idx" ON "ops_sheets" USING btree ("team_id","subject");