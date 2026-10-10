CREATE TABLE `vault_secret_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`secret_id` text NOT NULL,
	`version` integer NOT NULL,
	`value` text NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`secret_id`) REFERENCES `vault_secrets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vault_secret_versions_secret_version_idx` ON `vault_secret_versions` (`secret_id`,`version`);
--> statement-breakpoint
CREATE TABLE `vault_secrets` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`environment` text NOT NULL,
	`value` text NOT NULL,
	`description` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by` text,
	`updated_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vault_secrets_project_name_env_idx` ON `vault_secrets` (`project_id`,`name`,`environment`);
