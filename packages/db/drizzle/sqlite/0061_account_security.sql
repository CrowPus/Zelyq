ALTER TABLE `auth_sessions` ADD `user_agent` text;--> statement-breakpoint
ALTER TABLE `auth_sessions` ADD `ip` text;--> statement-breakpoint
ALTER TABLE `users` ADD `totp_secret` text;--> statement-breakpoint
ALTER TABLE `users` ADD `totp_enabled_at` text;--> statement-breakpoint
ALTER TABLE `users` ADD `totp_last_step` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `recovery_codes` text;--> statement-breakpoint
ALTER TABLE `users` ADD `locale` text;--> statement-breakpoint
ALTER TABLE `users` ADD `time_zone` text;