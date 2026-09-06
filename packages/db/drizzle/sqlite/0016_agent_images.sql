ALTER TABLE `image_generations` ADD `source` text DEFAULT 'studio' NOT NULL;--> statement-breakpoint
ALTER TABLE `image_generations` ADD `project_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `image_generations` ADD `project_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `image_generations` ADD `session_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `image_generation_enabled` integer DEFAULT false NOT NULL;
