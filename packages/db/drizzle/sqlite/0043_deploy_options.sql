ALTER TABLE `deploy_apps` ADD `database` text;--> statement-breakpoint
ALTER TABLE `deployments` ADD `options` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `deployments` ADD `changed_database` integer DEFAULT false NOT NULL;