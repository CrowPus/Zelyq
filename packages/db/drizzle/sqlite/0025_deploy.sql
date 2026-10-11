CREATE TABLE `deploy_environments` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`name` text NOT NULL,
	`runner_id` text,
	`address` text,
	`protected` integer DEFAULT false NOT NULL,
	`frozen` integer DEFAULT false NOT NULL,
	`frozen_reason` text,
	`variables` text DEFAULT '{}' NOT NULL,
	`created_by` text,
	`updated_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`runner_id`) REFERENCES `runners`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deploy_environments_team_name_idx` ON `deploy_environments` (`team_id`,`name`);--> statement-breakpoint
CREATE TABLE `deployments` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`environment_id` text NOT NULL,
	`app` text NOT NULL,
	`number` integer NOT NULL,
	`status` text NOT NULL,
	`kind` text NOT NULL,
	`image` text NOT NULL,
	`rolled_back_to` integer,
	`run_id` text,
	`triggered_by` text,
	`url` text,
	`port` integer NOT NULL,
	`host_port` integer NOT NULL,
	`health_path` text NOT NULL,
	`error` text,
	`created_at` text NOT NULL,
	`finished_at` text,
	FOREIGN KEY (`environment_id`) REFERENCES `deploy_environments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `pipeline_runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`triggered_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deployments_env_app_number_idx` ON `deployments` (`environment_id`,`app`,`number`);