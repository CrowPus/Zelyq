ALTER TABLE `image_generations` ADD `reference_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `image_generations` ADD `reference_digest` text DEFAULT '' NOT NULL;
