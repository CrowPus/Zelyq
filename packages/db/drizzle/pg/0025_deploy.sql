CREATE TABLE "deploy_environments" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"name" text NOT NULL,
	"runner_id" text,
	"address" text,
	"protected" boolean DEFAULT false NOT NULL,
	"frozen" boolean DEFAULT false NOT NULL,
	"frozen_reason" text,
	"variables" text DEFAULT '{}' NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployments" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"environment_id" text NOT NULL,
	"app" text NOT NULL,
	"number" integer NOT NULL,
	"status" text NOT NULL,
	"kind" text NOT NULL,
	"image" text NOT NULL,
	"rolled_back_to" integer,
	"run_id" text,
	"triggered_by" text,
	"url" text,
	"port" integer NOT NULL,
	"host_port" integer NOT NULL,
	"health_path" text NOT NULL,
	"error" text,
	"created_at" text NOT NULL,
	"finished_at" text
);
--> statement-breakpoint
ALTER TABLE "deploy_environments" ADD CONSTRAINT "deploy_environments_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deploy_environments" ADD CONSTRAINT "deploy_environments_runner_id_runners_id_fk" FOREIGN KEY ("runner_id") REFERENCES "public"."runners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deploy_environments" ADD CONSTRAINT "deploy_environments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deploy_environments" ADD CONSTRAINT "deploy_environments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_environment_id_deploy_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."deploy_environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_run_id_pipeline_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pipeline_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deploy_environments_team_name_idx" ON "deploy_environments" USING btree ("team_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "deployments_env_app_number_idx" ON "deployments" USING btree ("environment_id","app","number");