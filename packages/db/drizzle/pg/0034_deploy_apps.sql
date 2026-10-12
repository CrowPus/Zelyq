CREATE TABLE "deploy_apps" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"app" text NOT NULL,
	"domain" text,
	"www" boolean DEFAULT false NOT NULL,
	"updated_by" text,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deploy_apps" ADD CONSTRAINT "deploy_apps_environment_id_deploy_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."deploy_environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deploy_apps" ADD CONSTRAINT "deploy_apps_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deploy_apps_env_app_idx" ON "deploy_apps" USING btree ("environment_id","app");