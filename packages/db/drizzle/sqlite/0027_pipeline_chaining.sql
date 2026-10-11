ALTER TABLE `pipeline_runs` ADD `inputs` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `pipeline_runs` ADD `upstream_run_id` text;--> statement-breakpoint
ALTER TABLE `pipeline_steps` ADD `attempt` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `pipeline_steps` ADD `child_run_id` text;