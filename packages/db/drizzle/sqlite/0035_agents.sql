CREATE TABLE `agent_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`project_id` text,
	`action_type` text NOT NULL,
	`title` text NOT NULL,
	`reason` text,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`result` text,
	`decided_by` text,
	`decided_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `agent_proposals_team_status_idx` ON `agent_proposals` (`team_id`,`status`);--> statement-breakpoint
CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`name` text NOT NULL,
	`job` text DEFAULT '' NOT NULL,
	`project_ids` text,
	`permissions` text NOT NULL,
	`key_prefix` text NOT NULL,
	`key_hash` text NOT NULL,
	`revoked_at` text,
	`last_used_at` text,
	`last_used_ip` text,
	`created_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agents_key_hash_idx` ON `agents` (`key_hash`);--> statement-breakpoint
CREATE INDEX `agents_team_idx` ON `agents` (`team_id`);