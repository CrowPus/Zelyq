CREATE TABLE `pipeline_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`name` text NOT NULL,
	`storage_path` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `pipeline_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pipeline_artifacts_run_idx` ON `pipeline_artifacts` (`run_id`);--> statement-breakpoint
CREATE TABLE `pipeline_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`seq` integer NOT NULL,
	`step_id` text,
	`stream` text NOT NULL,
	`text` text NOT NULL,
	`at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `pipeline_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pipeline_logs_run_seq_idx` ON `pipeline_logs` (`run_id`,`seq`);--> statement-breakpoint
CREATE TABLE `pipeline_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`pipeline_id` text NOT NULL,
	`team_id` text NOT NULL,
	`number` integer NOT NULL,
	`status` text NOT NULL,
	`trigger` text NOT NULL,
	`triggered_by` text,
	`runner_id` text,
	`runner_name` text,
	`source` text NOT NULL,
	`ref` text,
	`from_stage` integer,
	`error` text,
	`log_bytes` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`started_at` text,
	`finished_at` text,
	FOREIGN KEY (`pipeline_id`) REFERENCES `pipelines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`triggered_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`runner_id`) REFERENCES `runners`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pipeline_runs_pipeline_number_idx` ON `pipeline_runs` (`pipeline_id`,`number`);--> statement-breakpoint
CREATE INDEX `pipeline_runs_team_idx` ON `pipeline_runs` (`team_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `pipeline_runs_status_idx` ON `pipeline_runs` (`status`);--> statement-breakpoint
CREATE TABLE `pipeline_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`stage_index` integer NOT NULL,
	`step_index` integer NOT NULL,
	`stage` text NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`exit_code` integer,
	`started_at` text,
	`finished_at` text,
	FOREIGN KEY (`run_id`) REFERENCES `pipeline_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pipeline_steps_run_idx` ON `pipeline_steps` (`run_id`);--> statement-breakpoint
CREATE TABLE `pipeline_triggers` (
	`id` text PRIMARY KEY NOT NULL,
	`pipeline_id` text NOT NULL,
	`kind` text NOT NULL,
	`config` text NOT NULL,
	`secret` text,
	`enabled` integer DEFAULT true NOT NULL,
	`last_fired_at` text,
	`created_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`pipeline_id`) REFERENCES `pipelines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `pipeline_triggers_pipeline_idx` ON `pipeline_triggers` (`pipeline_id`);--> statement-breakpoint
CREATE TABLE `pipelines` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`name` text NOT NULL,
	`source` text NOT NULL,
	`created_by` text,
	`updated_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pipelines_team_name_idx` ON `pipelines` (`team_id`,`name`);--> statement-breakpoint
CREATE TABLE `runners` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`host` text NOT NULL,
	`port` integer DEFAULT 22 NOT NULL,
	`username` text NOT NULL,
	`labels` text DEFAULT '[]' NOT NULL,
	`description` text,
	`enabled` integer DEFAULT true NOT NULL,
	`max_concurrent` integer DEFAULT 1 NOT NULL,
	`os` text,
	`shells` text DEFAULT '[]' NOT NULL,
	`tools` text DEFAULT '[]' NOT NULL,
	`host_key` text,
	`host_key_fingerprint` text,
	`last_test_at` text,
	`last_test_ok` integer,
	`last_latency_ms` integer,
	`last_test_message` text,
	`accepted_key_fingerprint` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `runners_team_name_idx` ON `runners` (`team_id`,`name`);--> statement-breakpoint
CREATE TABLE `team_ssh_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`algorithm` text NOT NULL,
	`public_key` text NOT NULL,
	`private_key` text NOT NULL,
	`fingerprint` text NOT NULL,
	`retires_at` text,
	`created_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `team_ssh_keys_team_idx` ON `team_ssh_keys` (`team_id`);