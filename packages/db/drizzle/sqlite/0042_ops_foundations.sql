CREATE TABLE `ops_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`action` text NOT NULL,
	`inputs_hash` text NOT NULL,
	`ok` integer,
	`detail` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `ops_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ops_attempts_tried_idx` ON `ops_attempts` (`job_id`,`action`,`inputs_hash`);--> statement-breakpoint
CREATE TABLE `ops_engineers` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`service_user_id` text NOT NULL,
	`paused` integer DEFAULT false NOT NULL,
	`paused_by` text,
	`paused_at` text,
	`monthly_token_cap` integer,
	`time_zone` text DEFAULT 'UTC' NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`service_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ops_engineers_team_idx` ON `ops_engineers` (`team_id`);--> statement-breakpoint
CREATE TABLE `ops_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`kind` text NOT NULL,
	`request` text NOT NULL,
	`stage` text DEFAULT 'survey' NOT NULL,
	`source` text DEFAULT 'page' NOT NULL,
	`asked_by` text,
	`outcome` text,
	`plan_hash` text,
	`plan_approved_by` text,
	`plan_approved_at` text,
	`tokens_in` integer DEFAULT 0 NOT NULL,
	`tokens_out` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`finished_at` text,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asked_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`plan_approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ops_jobs_team_idx` ON `ops_jobs` (`team_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `ops_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`role` text NOT NULL,
	`user_id` text,
	`text` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `ops_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ops_messages_job_idx` ON `ops_messages` (`job_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `ops_plan_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`position` integer NOT NULL,
	`action` text NOT NULL,
	`inputs` text NOT NULL,
	`inputs_hash` text NOT NULL,
	`words` text NOT NULL,
	`risk` text NOT NULL,
	`undo` text,
	`confirmed_by` text,
	`confirmed_at` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`result` text,
	`started_at` text,
	`finished_at` text,
	FOREIGN KEY (`job_id`) REFERENCES `ops_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`confirmed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ops_plan_steps_job_idx` ON `ops_plan_steps` (`job_id`,`position`);--> statement-breakpoint
CREATE TABLE `ops_proofs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`step_id` text,
	`kind` text NOT NULL,
	`target` text NOT NULL,
	`ok` integer NOT NULL,
	`detail` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `ops_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`step_id`) REFERENCES `ops_plan_steps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ops_proofs_job_idx` ON `ops_proofs` (`job_id`);--> statement-breakpoint
CREATE TABLE `ops_run_grants` (
	`run_id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`step_id` text,
	`environment_id` text NOT NULL,
	`approved_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `pipeline_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `ops_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `deploy_environments` ADD `ops_trust` text DEFAULT 'ask' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `kind` text DEFAULT 'person' NOT NULL;