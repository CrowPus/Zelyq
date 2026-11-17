CREATE TABLE `announcement_views` (
	`announcement_id` text NOT NULL,
	`user_id` text NOT NULL,
	`seen_at` text,
	`dismissed_at` text,
	`clicked_at` text,
	FOREIGN KEY (`announcement_id`) REFERENCES `announcements`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `announcement_views_pair_idx` ON `announcement_views` (`announcement_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `announcements` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`level` text DEFAULT 'info' NOT NULL,
	`display` text DEFAULT 'banner' NOT NULL,
	`audience_kind` text DEFAULT 'everyone' NOT NULL,
	`audience_value` text,
	`link_url` text,
	`link_label` text,
	`starts_at` text NOT NULL,
	`ends_at` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `announcements_window_idx` ON `announcements` (`starts_at`,`ends_at`);--> statement-breakpoint
CREATE TABLE `user_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`level` text DEFAULT 'info' NOT NULL,
	`link_url` text,
	`link_label` text,
	`source` text NOT NULL,
	`created_at` text NOT NULL,
	`read_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `user_notifications_user_created_idx` ON `user_notifications` (`user_id`,`created_at`);