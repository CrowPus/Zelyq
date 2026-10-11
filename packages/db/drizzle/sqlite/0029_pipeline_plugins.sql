CREATE TABLE `pipeline_plugins` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`plugin_id` text NOT NULL,
	`version` text NOT NULL,
	`manifest` text NOT NULL,
	`sha256` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`installed_by` text,
	`installed_at` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`installed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pipeline_plugins_team_version_idx` ON `pipeline_plugins` (`team_id`,`plugin_id`,`version`);