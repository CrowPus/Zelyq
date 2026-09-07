CREATE TABLE `video_frame_sets` (
	`generation_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`format` text NOT NULL,
	`count` integer NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`fps` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`generation_id`) REFERENCES `video_generations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
