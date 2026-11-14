CREATE TABLE "ops_alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"check_id" text,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"opened_at" text NOT NULL,
	"closed_at" text,
	"closed_how" text,
	"acknowledged_by" text,
	"acknowledged_at" text,
	"silenced_until" text,
	"silenced_by" text,
	"escalation" integer DEFAULT 0 NOT NULL,
	"notified_at" text
);
--> statement-breakpoint
CREATE TABLE "ops_check_hours" (
	"check_id" text NOT NULL,
	"hour" text NOT NULL,
	"runs" integer DEFAULT 0 NOT NULL,
	"passed" integer DEFAULT 0 NOT NULL,
	"total_ms" integer DEFAULT 0 NOT NULL,
	"slowest_ms" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_checks" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"kind" text NOT NULL,
	"target" text NOT NULL,
	"title" text NOT NULL,
	"params" text DEFAULT '{}' NOT NULL,
	"every_seconds" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"origin" text DEFAULT 'records' NOT NULL,
	"state" text DEFAULT 'unknown' NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"failing_since" text,
	"last_detail" text,
	"last_checked_at" text,
	"normal_ms" integer,
	"switched_off_by" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ops_alerts" ADD CONSTRAINT "ops_alerts_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_alerts" ADD CONSTRAINT "ops_alerts_check_id_ops_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."ops_checks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_alerts" ADD CONSTRAINT "ops_alerts_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_alerts" ADD CONSTRAINT "ops_alerts_silenced_by_users_id_fk" FOREIGN KEY ("silenced_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_check_hours" ADD CONSTRAINT "ops_check_hours_check_id_ops_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."ops_checks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_checks" ADD CONSTRAINT "ops_checks_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ops_alerts_team_idx" ON "ops_alerts" USING btree ("team_id","closed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ops_check_hours_idx" ON "ops_check_hours" USING btree ("check_id","hour");--> statement-breakpoint
CREATE INDEX "ops_checks_team_idx" ON "ops_checks" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ops_checks_target_idx" ON "ops_checks" USING btree ("team_id","kind","target");