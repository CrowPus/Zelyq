CREATE TABLE `ops_channel_links` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`chat_id` text NOT NULL,
	`label` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ops_channel_links_person_idx` ON `ops_channel_links` (`team_id`,`kind`,`user_id`);--> statement-breakpoint
CREATE TABLE `ops_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`account` text NOT NULL,
	`secret` text NOT NULL,
	`team_chat` text,
	`status` text NOT NULL,
	`last_error` text,
	`poll_offset` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ops_channels_team_kind_idx` ON `ops_channels` (`team_id`,`kind`);--> statement-breakpoint
CREATE INDEX `ops_channels_account_idx` ON `ops_channels` (`account`);--> statement-breakpoint
CREATE TABLE `ops_link_codes` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`chat_id` text,
	`label` text,
	`expires_at` text NOT NULL,
	`used_at` text,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ops_link_codes_person_idx` ON `ops_link_codes` (`team_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `ops_notify_prefs` (
	`team_id` text NOT NULL,
	`user_id` text NOT NULL,
	`prefs` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ops_notify_prefs_person_idx` ON `ops_notify_prefs` (`team_id`,`user_id`);