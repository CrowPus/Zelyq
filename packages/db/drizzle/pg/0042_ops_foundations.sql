CREATE TABLE "ops_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"action" text NOT NULL,
	"inputs_hash" text NOT NULL,
	"ok" boolean,
	"detail" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_engineers" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"service_user_id" text NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"paused_by" text,
	"paused_at" text,
	"monthly_token_cap" integer,
	"time_zone" text DEFAULT 'UTC' NOT NULL,
	"created_by" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"kind" text NOT NULL,
	"request" text NOT NULL,
	"stage" text DEFAULT 'survey' NOT NULL,
	"source" text DEFAULT 'page' NOT NULL,
	"asked_by" text,
	"outcome" text,
	"plan_hash" text,
	"plan_approved_by" text,
	"plan_approved_at" text,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"finished_at" text
);
--> statement-breakpoint
CREATE TABLE "ops_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"role" text NOT NULL,
	"user_id" text,
	"text" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_plan_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"position" integer NOT NULL,
	"action" text NOT NULL,
	"inputs" text NOT NULL,
	"inputs_hash" text NOT NULL,
	"words" text NOT NULL,
	"risk" text NOT NULL,
	"undo" text,
	"confirmed_by" text,
	"confirmed_at" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"result" text,
	"started_at" text,
	"finished_at" text
);
--> statement-breakpoint
CREATE TABLE "ops_proofs" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"step_id" text,
	"kind" text NOT NULL,
	"target" text NOT NULL,
	"ok" boolean NOT NULL,
	"detail" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_run_grants" (
	"run_id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"step_id" text,
	"environment_id" text NOT NULL,
	"approved_by" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deploy_environments" ADD COLUMN "ops_trust" text DEFAULT 'ask' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "kind" text DEFAULT 'person' NOT NULL;--> statement-breakpoint
ALTER TABLE "ops_attempts" ADD CONSTRAINT "ops_attempts_job_id_ops_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."ops_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_engineers" ADD CONSTRAINT "ops_engineers_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_engineers" ADD CONSTRAINT "ops_engineers_service_user_id_users_id_fk" FOREIGN KEY ("service_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_engineers" ADD CONSTRAINT "ops_engineers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_jobs" ADD CONSTRAINT "ops_jobs_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_jobs" ADD CONSTRAINT "ops_jobs_asked_by_users_id_fk" FOREIGN KEY ("asked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_jobs" ADD CONSTRAINT "ops_jobs_plan_approved_by_users_id_fk" FOREIGN KEY ("plan_approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_messages" ADD CONSTRAINT "ops_messages_job_id_ops_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."ops_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_messages" ADD CONSTRAINT "ops_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_plan_steps" ADD CONSTRAINT "ops_plan_steps_job_id_ops_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."ops_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_plan_steps" ADD CONSTRAINT "ops_plan_steps_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_proofs" ADD CONSTRAINT "ops_proofs_job_id_ops_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."ops_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_proofs" ADD CONSTRAINT "ops_proofs_step_id_ops_plan_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."ops_plan_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_run_grants" ADD CONSTRAINT "ops_run_grants_run_id_pipeline_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pipeline_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_run_grants" ADD CONSTRAINT "ops_run_grants_job_id_ops_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."ops_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_run_grants" ADD CONSTRAINT "ops_run_grants_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ops_attempts_tried_idx" ON "ops_attempts" USING btree ("job_id","action","inputs_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "ops_engineers_team_idx" ON "ops_engineers" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "ops_jobs_team_idx" ON "ops_jobs" USING btree ("team_id","created_at");--> statement-breakpoint
CREATE INDEX "ops_messages_job_idx" ON "ops_messages" USING btree ("job_id","created_at");--> statement-breakpoint
CREATE INDEX "ops_plan_steps_job_idx" ON "ops_plan_steps" USING btree ("job_id","position");--> statement-breakpoint
CREATE INDEX "ops_proofs_job_idx" ON "ops_proofs" USING btree ("job_id");