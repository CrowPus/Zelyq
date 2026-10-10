CREATE TABLE "pipeline_artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"name" text NOT NULL,
	"storage_path" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"seq" integer NOT NULL,
	"step_id" text,
	"stream" text NOT NULL,
	"text" text NOT NULL,
	"at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"pipeline_id" text NOT NULL,
	"team_id" text NOT NULL,
	"number" integer NOT NULL,
	"status" text NOT NULL,
	"trigger" text NOT NULL,
	"triggered_by" text,
	"runner_id" text,
	"runner_name" text,
	"source" text NOT NULL,
	"ref" text,
	"from_stage" integer,
	"error" text,
	"log_bytes" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL,
	"started_at" text,
	"finished_at" text
);
--> statement-breakpoint
CREATE TABLE "pipeline_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"stage_index" integer NOT NULL,
	"step_index" integer NOT NULL,
	"stage" text NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"exit_code" integer,
	"started_at" text,
	"finished_at" text
);
--> statement-breakpoint
CREATE TABLE "pipeline_triggers" (
	"id" text PRIMARY KEY NOT NULL,
	"pipeline_id" text NOT NULL,
	"kind" text NOT NULL,
	"config" text NOT NULL,
	"secret" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_fired_at" text,
	"created_by" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipelines" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"name" text NOT NULL,
	"source" text NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runners" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"host" text NOT NULL,
	"port" integer DEFAULT 22 NOT NULL,
	"username" text NOT NULL,
	"labels" text DEFAULT '[]' NOT NULL,
	"description" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"max_concurrent" integer DEFAULT 1 NOT NULL,
	"os" text,
	"shells" text DEFAULT '[]' NOT NULL,
	"tools" text DEFAULT '[]' NOT NULL,
	"host_key" text,
	"host_key_fingerprint" text,
	"last_test_at" text,
	"last_test_ok" boolean,
	"last_latency_ms" integer,
	"last_test_message" text,
	"accepted_key_fingerprint" text,
	"created_by" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_ssh_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"algorithm" text NOT NULL,
	"public_key" text NOT NULL,
	"private_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"retires_at" text,
	"created_by" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pipeline_artifacts" ADD CONSTRAINT "pipeline_artifacts_run_id_pipeline_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pipeline_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_logs" ADD CONSTRAINT "pipeline_logs_run_id_pipeline_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pipeline_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_runner_id_runners_id_fk" FOREIGN KEY ("runner_id") REFERENCES "public"."runners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_steps" ADD CONSTRAINT "pipeline_steps_run_id_pipeline_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pipeline_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_triggers" ADD CONSTRAINT "pipeline_triggers_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_triggers" ADD CONSTRAINT "pipeline_triggers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runners" ADD CONSTRAINT "runners_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runners" ADD CONSTRAINT "runners_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_ssh_keys" ADD CONSTRAINT "team_ssh_keys_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_ssh_keys" ADD CONSTRAINT "team_ssh_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pipeline_artifacts_run_idx" ON "pipeline_artifacts" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_logs_run_seq_idx" ON "pipeline_logs" USING btree ("run_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_runs_pipeline_number_idx" ON "pipeline_runs" USING btree ("pipeline_id","number");--> statement-breakpoint
CREATE INDEX "pipeline_runs_team_idx" ON "pipeline_runs" USING btree ("team_id","created_at");--> statement-breakpoint
CREATE INDEX "pipeline_runs_status_idx" ON "pipeline_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "pipeline_steps_run_idx" ON "pipeline_steps" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "pipeline_triggers_pipeline_idx" ON "pipeline_triggers" USING btree ("pipeline_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pipelines_team_name_idx" ON "pipelines" USING btree ("team_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "runners_team_name_idx" ON "runners" USING btree ("team_id","name");--> statement-breakpoint
CREATE INDEX "team_ssh_keys_team_idx" ON "team_ssh_keys" USING btree ("team_id");