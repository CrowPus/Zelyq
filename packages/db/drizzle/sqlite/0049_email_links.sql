CREATE TABLE `email_links` (
	`id` text PRIMARY KEY NOT NULL,
	`purpose` text NOT NULL,
	`token_hash` text NOT NULL,
	`email` text NOT NULL,
	`user_id` text,
	`team_id` text,
	`role` text,
	`created_by` text,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_links_token_hash_idx` ON `email_links` (`token_hash`);--> statement-breakpoint
CREATE INDEX `email_links_email_idx` ON `email_links` (`email`);--> statement-breakpoint
CREATE INDEX `email_links_team_id_idx` ON `email_links` (`team_id`);