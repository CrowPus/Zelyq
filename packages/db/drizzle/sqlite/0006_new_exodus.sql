CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text,
	`project_id` text,
	`user_id` text,
	`actor_name` text NOT NULL,
	`actor_email` text NOT NULL,
	`action` text NOT NULL,
	`detail` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_log_team_id_idx` ON `audit_log` (`team_id`);--> statement-breakpoint
CREATE INDEX `audit_log_project_id_idx` ON `audit_log` (`project_id`);--> statement-breakpoint
CREATE INDEX `audit_log_created_at_idx` ON `audit_log` (`created_at`);