CREATE TABLE "pipeline_plugins" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"plugin_id" text NOT NULL,
	"version" text NOT NULL,
	"manifest" text NOT NULL,
	"sha256" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"installed_by" text,
	"installed_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pipeline_plugins" ADD CONSTRAINT "pipeline_plugins_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_plugins" ADD CONSTRAINT "pipeline_plugins_installed_by_users_id_fk" FOREIGN KEY ("installed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_plugins_team_version_idx" ON "pipeline_plugins" USING btree ("team_id","plugin_id","version");