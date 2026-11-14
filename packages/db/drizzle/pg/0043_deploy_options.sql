ALTER TABLE "deploy_apps" ADD COLUMN "database" text;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "options" text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "changed_database" boolean DEFAULT false NOT NULL;