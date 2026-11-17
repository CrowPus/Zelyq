ALTER TABLE `teams` ADD `status` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `teams` ADD `status_reason` text;--> statement-breakpoint
ALTER TABLE `teams` ADD `status_message` text;--> statement-breakpoint
ALTER TABLE `teams` ADD `status_changed_at` text;--> statement-breakpoint
ALTER TABLE `teams` ADD `last_active_at` text;--> statement-breakpoint
ALTER TABLE `users` ADD `last_seen_at` text;--> statement-breakpoint
UPDATE `teams` SET `last_active_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `last_active_at` IS NULL;
