ALTER TABLE `video_generations` ADD `source` text DEFAULT 'studio' NOT NULL;--> statement-breakpoint
ALTER TABLE `video_generations` ADD `project_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `video_generations` ADD `project_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `video_generations` ADD `session_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `video_generation_enabled` integer DEFAULT false NOT NULL;
