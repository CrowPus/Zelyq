CREATE TABLE "pipeline_favorites" (
	"user_id" text NOT NULL,
	"pipeline_id" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD COLUMN "commit_message" text;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD COLUMN "pull_request" text;--> statement-breakpoint
ALTER TABLE "pipeline_favorites" ADD CONSTRAINT "pipeline_favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_favorites" ADD CONSTRAINT "pipeline_favorites_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_favorites_user_pipeline_idx" ON "pipeline_favorites" USING btree ("user_id","pipeline_id");