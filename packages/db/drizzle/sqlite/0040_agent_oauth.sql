CREATE TABLE `agent_oauth_clients` (
	`client_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`redirect_uris` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `agent_oauth_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`client_id` text NOT NULL,
	`kind` text NOT NULL,
	`token_hash` text NOT NULL,
	`key_hash` text NOT NULL,
	`redirect_uri` text,
	`code_challenge` text,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_oauth_grants_token_idx` ON `agent_oauth_grants` (`token_hash`);--> statement-breakpoint
CREATE INDEX `agent_oauth_grants_agent_idx` ON `agent_oauth_grants` (`agent_id`);