CREATE TABLE `agent_references` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`team_id` text NOT NULL,
	`name` text NOT NULL,
	`mime_type` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`size_bytes` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_references_agent_idx` ON `agent_references` (`agent_id`);