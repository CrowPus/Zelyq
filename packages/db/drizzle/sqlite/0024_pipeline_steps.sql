CREATE TABLE `pipeline_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`step_id` text NOT NULL,
	`message` text NOT NULL,
	`approvers` text NOT NULL,
	`allow_self` integer NOT NULL,
	`deadline` text NOT NULL,
	`decision` text,
	`decided_by` text,
	`comment` text,
	`created_at` text NOT NULL,
	`decided_at` text,
	FOREIGN KEY (`run_id`) REFERENCES `pipeline_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`step_id`) REFERENCES `pipeline_steps`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pipeline_approvals_step_idx` ON `pipeline_approvals` (`step_id`);--> statement-breakpoint
ALTER TABLE `pipeline_runs` ADD `branch` text;--> statement-breakpoint
ALTER TABLE `pipeline_steps` ADD `kind` text DEFAULT 'run' NOT NULL;