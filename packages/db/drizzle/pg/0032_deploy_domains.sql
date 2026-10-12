ALTER TABLE "deploy_environments" ADD COLUMN "domain" text;--> statement-breakpoint
ALTER TABLE "deploy_environments" ADD COLUMN "https" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "deploy_environments" ADD COLUMN "http_port" integer DEFAULT 80 NOT NULL;--> statement-breakpoint
ALTER TABLE "deploy_environments" ADD COLUMN "https_port" integer DEFAULT 443 NOT NULL;