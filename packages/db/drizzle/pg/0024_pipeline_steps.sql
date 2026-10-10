CREATE TABLE "pipeline_approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"step_id" text NOT NULL,
	"message" text NOT NULL,
	"approvers" text NOT NULL,
	"allow_self" boolean NOT NULL,
	"deadline" text NOT NULL,
	"decision" text,
	"decided_by" text,
	"comment" text,
	"created_at" text NOT NULL,
	"decided_at" text
);
--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD COLUMN "branch" text;--> statement-breakpoint
ALTER TABLE "pipeline_steps" ADD COLUMN "kind" text DEFAULT 'run' NOT NULL;--> statement-breakpoint
ALTER TABLE "pipeline_approvals" ADD CONSTRAINT "pipeline_approvals_run_id_pipeline_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pipeline_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_approvals" ADD CONSTRAINT "pipeline_approvals_step_id_pipeline_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."pipeline_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_approvals" ADD CONSTRAINT "pipeline_approvals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_approvals_step_idx" ON "pipeline_approvals" USING btree ("step_id");