CREATE TABLE `provider_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`credential_type` text NOT NULL,
	`encrypted_blob` text NOT NULL,
	`granted_scopes` text DEFAULT '' NOT NULL,
	`expires_at` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `provider_connections_provider_idx` ON `provider_connections` (`provider`);--> statement-breakpoint
CREATE INDEX `provider_connections_created_by_idx` ON `provider_connections` (`created_by`);--> statement-breakpoint
CREATE TABLE `provider_resources` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`org_id` text NOT NULL,
	`project_ref` text NOT NULL,
	`project_url` text NOT NULL,
	`publishable_key` text NOT NULL,
	`environment` text DEFAULT 'development' NOT NULL,
	`region` text,
	`display_name` text NOT NULL,
	`provisioned_by_zelyq` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `provider_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_resources_connection_ref_idx` ON `provider_resources` (`connection_id`,`project_ref`);--> statement-breakpoint
CREATE TABLE `project_provider_links` (
	`zelyq_project_id` text PRIMARY KEY NOT NULL,
	`provider_resource_id` text NOT NULL,
	`linked_by` text NOT NULL,
	`linked_at` text NOT NULL,
	FOREIGN KEY (`zelyq_project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_resource_id`) REFERENCES `provider_resources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`linked_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_provider_links_resource_idx` ON `project_provider_links` (`provider_resource_id`);--> statement-breakpoint
CREATE TABLE `provider_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text,
	`zelyq_project_id` text,
	`action` text NOT NULL,
	`outcome` text NOT NULL,
	`detail` text DEFAULT '{}' NOT NULL,
	`actor_user_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `provider_operations_connection_id_idx` ON `provider_operations` (`connection_id`);--> statement-breakpoint
CREATE INDEX `provider_operations_created_at_idx` ON `provider_operations` (`created_at`);
