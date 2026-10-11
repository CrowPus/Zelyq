ALTER TABLE "pipeline_runs" ADD COLUMN "inputs" text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD COLUMN "upstream_run_id" text;--> statement-breakpoint
ALTER TABLE "pipeline_steps" ADD COLUMN "attempt" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "pipeline_steps" ADD COLUMN "child_run_id" text;