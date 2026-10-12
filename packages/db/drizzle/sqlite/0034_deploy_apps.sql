CREATE TABLE `deploy_apps` (
	`id` text PRIMARY KEY NOT NULL,
	`environment_id` text NOT NULL,
	`app` text NOT NULL,
	`domain` text,
	`www` integer DEFAULT false NOT NULL,
	`updated_by` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`environment_id`) REFERENCES `deploy_environments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deploy_apps_env_app_idx` ON `deploy_apps` (`environment_id`,`app`);