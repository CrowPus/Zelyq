ALTER TABLE "pipeline_steps" ADD COLUMN "outputs" text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "pipeline_steps" ADD COLUMN "tests" text;