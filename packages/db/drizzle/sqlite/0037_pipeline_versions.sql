CREATE TABLE `pipeline_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`pipeline_id` text NOT NULL,
	`team_id` text NOT NULL,
	`version` integer NOT NULL,
	`name` text NOT NULL,
	`source` text NOT NULL,
	`created_by` text,
	`note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`pipeline_id`) REFERENCES `pipelines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pipeline_versions_pipeline_version_idx` ON `pipeline_versions` (`pipeline_id`,`version`);