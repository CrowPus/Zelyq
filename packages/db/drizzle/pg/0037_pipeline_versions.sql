CREATE TABLE "pipeline_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"pipeline_id" text NOT NULL,
	"team_id" text NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"source" text NOT NULL,
	"created_by" text,
	"note" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pipeline_versions" ADD CONSTRAINT "pipeline_versions_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_versions" ADD CONSTRAINT "pipeline_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_versions_pipeline_version_idx" ON "pipeline_versions" USING btree ("pipeline_id","version");