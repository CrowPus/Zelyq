ALTER TABLE `deploy_environments` ADD `domain` text;--> statement-breakpoint
ALTER TABLE `deploy_environments` ADD `https` text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE `deploy_environments` ADD `http_port` integer DEFAULT 80 NOT NULL;--> statement-breakpoint
ALTER TABLE `deploy_environments` ADD `https_port` integer DEFAULT 443 NOT NULL;