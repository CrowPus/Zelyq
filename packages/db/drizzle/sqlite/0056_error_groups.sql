CREATE TABLE `error_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`kind` text NOT NULL,
	`message` text NOT NULL,
	`location` text NOT NULL,
	`route` text,
	`count` integer DEFAULT 0 NOT NULL,
	`first_seen` text NOT NULL,
	`last_seen` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`resolved_at` text,
	`sample_stack` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `error_groups_fingerprint_idx` ON `error_groups` (`fingerprint`);--> statement-breakpoint
CREATE INDEX `error_groups_last_seen_idx` ON `error_groups` (`last_seen`);--> statement-breakpoint
CREATE TABLE `error_hits` (
	`group_id` text NOT NULL,
	`user_id` text,
	`team_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `error_groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `error_hits_group_created_idx` ON `error_hits` (`group_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `error_hits_created_idx` ON `error_hits` (`created_at`);