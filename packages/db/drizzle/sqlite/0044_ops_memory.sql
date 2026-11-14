CREATE TABLE `ops_guards` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`lesson_id` text,
	`kind` text NOT NULL,
	`params` text DEFAULT '{}' NOT NULL,
	`scope` text DEFAULT 'team' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_by` text NOT NULL,
	`switched_off_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lesson_id`) REFERENCES `ops_lessons`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ops_guards_team_idx` ON `ops_guards` (`team_id`,`active`);--> statement-breakpoint
CREATE TABLE `ops_lessons` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`what` text NOT NULL,
	`why` text NOT NULL,
	`rule` text NOT NULL,
	`scope` text DEFAULT 'team' NOT NULL,
	`strength` text DEFAULT 'reminder' NOT NULL,
	`source` text NOT NULL,
	`evidence_job_id` text,
	`evidence` text,
	`status` text DEFAULT 'active' NOT NULL,
	`retired_reason` text,
	`last_matched_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ops_lessons_team_idx` ON `ops_lessons` (`team_id`,`status`);--> statement-breakpoint
CREATE TABLE `ops_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`text` text NOT NULL,
	`scope` text DEFAULT 'team' NOT NULL,
	`source` text NOT NULL,
	`job_id` text,
	`created_by` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ops_preferences_team_idx` ON `ops_preferences` (`team_id`);--> statement-breakpoint
CREATE TABLE `ops_sheet_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`sheet_id` text NOT NULL,
	`version` integer NOT NULL,
	`body` text NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`sheet_id`) REFERENCES `ops_sheets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ops_sheet_versions_sheet_idx` ON `ops_sheet_versions` (`sheet_id`,`version`);--> statement-breakpoint
CREATE TABLE `ops_sheets` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ops_sheets_subject_idx` ON `ops_sheets` (`team_id`,`subject`);