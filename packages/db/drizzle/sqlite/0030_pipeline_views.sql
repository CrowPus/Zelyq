CREATE TABLE `pipeline_favorites` (
	`user_id` text NOT NULL,
	`pipeline_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pipeline_id`) REFERENCES `pipelines`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pipeline_favorites_user_pipeline_idx` ON `pipeline_favorites` (`user_id`,`pipeline_id`);--> statement-breakpoint
ALTER TABLE `pipeline_runs` ADD `commit_message` text;--> statement-breakpoint
ALTER TABLE `pipeline_runs` ADD `pull_request` text;