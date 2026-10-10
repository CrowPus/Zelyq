CREATE TABLE "project_variable_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"variable_id" text NOT NULL,
	"version" integer NOT NULL,
	"value" text NOT NULL,
	"created_by" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_variables" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"source" text NOT NULL,
	"value" text,
	"vault_name" text,
	"description" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vault_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"scope_key" text NOT NULL,
	"team_id" text,
	"name" text NOT NULL,
	"value" text NOT NULL,
	"description" text,
	"protected" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vault_entry_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"entry_id" text NOT NULL,
	"version" integer NOT NULL,
	"value" text NOT NULL,
	"created_by" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vault_service_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"name" text NOT NULL,
	"key_prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" text NOT NULL,
	"name_patterns" text,
	"allowed_ips" text,
	"expires_at" text,
	"revoked_at" text,
	"last_used_at" text,
	"last_used_ip" text,
	"created_by" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_variable_versions" ADD CONSTRAINT "project_variable_versions_variable_id_project_variables_id_fk" FOREIGN KEY ("variable_id") REFERENCES "public"."project_variables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_variable_versions" ADD CONSTRAINT "project_variable_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_variables" ADD CONSTRAINT "project_variables_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_variables" ADD CONSTRAINT "project_variables_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_variables" ADD CONSTRAINT "project_variables_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_entries" ADD CONSTRAINT "vault_entries_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_entries" ADD CONSTRAINT "vault_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_entries" ADD CONSTRAINT "vault_entries_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_entry_versions" ADD CONSTRAINT "vault_entry_versions_entry_id_vault_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."vault_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_entry_versions" ADD CONSTRAINT "vault_entry_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_service_keys" ADD CONSTRAINT "vault_service_keys_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_service_keys" ADD CONSTRAINT "vault_service_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_variable_versions_variable_version_idx" ON "project_variable_versions" USING btree ("variable_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "project_variables_project_name_idx" ON "project_variables" USING btree ("project_id","name");--> statement-breakpoint
CREATE INDEX "project_variables_vault_name_idx" ON "project_variables" USING btree ("vault_name");--> statement-breakpoint
CREATE UNIQUE INDEX "vault_entries_scope_name_idx" ON "vault_entries" USING btree ("scope_key","name");--> statement-breakpoint
CREATE UNIQUE INDEX "vault_entry_versions_entry_version_idx" ON "vault_entry_versions" USING btree ("entry_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "vault_service_keys_hash_idx" ON "vault_service_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "vault_service_keys_team_idx" ON "vault_service_keys" USING btree ("team_id");

--> statement-breakpoint
-- The first Vault kept secrets per project and per environment. Only the
-- development values ever reached an app, so those become the project's typed
-- variables, history included. Test and production values reached nothing; they
-- move into the team Vault as Protected secrets — kept, given to no app, and
-- visible only to admins and owners — named NAME__PRODUCTION__<project>-<id>,
-- which cannot collide. Nothing is dropped.
INSERT INTO project_variables (id, project_id, name, source, value, vault_name, description, version, created_by, updated_by, created_at, updated_at)
SELECT s.id, s.project_id, s.name, 'direct', s.value, NULL, s.description, s.version, s.created_by, s.updated_by, s.created_at, s.updated_at
FROM vault_secrets s
WHERE s.environment = 'development';
--> statement-breakpoint
INSERT INTO project_variable_versions (id, variable_id, version, value, created_by, created_at)
SELECT v.id, v.secret_id, v.version, v.value, v.created_by, v.created_at
FROM vault_secret_versions v
JOIN vault_secrets s ON s.id = v.secret_id
WHERE s.environment = 'development';
--> statement-breakpoint
INSERT INTO vault_entries (id, scope_key, team_id, name, value, description, protected, version, created_by, updated_by, created_at, updated_at)
SELECT s.id, p.team_id, p.team_id,
  s.name || '__' || UPPER(s.environment) || '__' || p.slug || '-' || SUBSTR(s.id, 5, 8),
  s.value, 'Moved from ' || s.environment || ' in project ' || p.name, true, s.version,
  s.created_by, s.updated_by, s.created_at, s.updated_at
FROM vault_secrets s
JOIN projects p ON p.id = s.project_id
JOIN teams t ON t.id = p.team_id
WHERE s.environment <> 'development';
--> statement-breakpoint
INSERT INTO vault_entry_versions (id, entry_id, version, value, created_by, created_at)
SELECT v.id, v.secret_id, v.version, v.value, v.created_by, v.created_at
FROM vault_secret_versions v
JOIN vault_secrets s ON s.id = v.secret_id
JOIN projects p ON p.id = s.project_id
JOIN teams t ON t.id = p.team_id
WHERE s.environment <> 'development';
--> statement-breakpoint
-- A project not yet adopted by a team has no team Vault: its test and production
-- values stay with it as variables, so nothing is lost.
INSERT INTO project_variables (id, project_id, name, source, value, vault_name, description, version, created_by, updated_by, created_at, updated_at)
SELECT s.id, s.project_id, s.name || '__' || UPPER(s.environment) || '_' || UPPER(SUBSTR(s.id, 5, 8)), 'direct', s.value, NULL, s.description, s.version, s.created_by, s.updated_by, s.created_at, s.updated_at
FROM vault_secrets s
JOIN projects p ON p.id = s.project_id
WHERE s.environment <> 'development' AND NOT EXISTS (SELECT 1 FROM teams t WHERE t.id = p.team_id);
