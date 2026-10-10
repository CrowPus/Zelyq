CREATE TABLE `project_variable_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`variable_id` text NOT NULL,
	`version` integer NOT NULL,
	`value` text NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`variable_id`) REFERENCES `project_variables`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_variable_versions_variable_version_idx` ON `project_variable_versions` (`variable_id`,`version`);--> statement-breakpoint
CREATE TABLE `project_variables` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`source` text NOT NULL,
	`value` text,
	`vault_name` text,
	`description` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by` text,
	`updated_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_variables_project_name_idx` ON `project_variables` (`project_id`,`name`);--> statement-breakpoint
CREATE INDEX `project_variables_vault_name_idx` ON `project_variables` (`vault_name`);--> statement-breakpoint
CREATE TABLE `vault_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`scope_key` text NOT NULL,
	`team_id` text,
	`name` text NOT NULL,
	`value` text NOT NULL,
	`description` text,
	`protected` integer DEFAULT false NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by` text,
	`updated_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vault_entries_scope_name_idx` ON `vault_entries` (`scope_key`,`name`);--> statement-breakpoint
CREATE TABLE `vault_entry_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`version` integer NOT NULL,
	`value` text NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `vault_entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vault_entry_versions_entry_version_idx` ON `vault_entry_versions` (`entry_id`,`version`);--> statement-breakpoint
CREATE TABLE `vault_service_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`name` text NOT NULL,
	`key_prefix` text NOT NULL,
	`key_hash` text NOT NULL,
	`scopes` text NOT NULL,
	`name_patterns` text,
	`allowed_ips` text,
	`expires_at` text,
	`revoked_at` text,
	`last_used_at` text,
	`last_used_ip` text,
	`created_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vault_service_keys_hash_idx` ON `vault_service_keys` (`key_hash`);--> statement-breakpoint
CREATE INDEX `vault_service_keys_team_idx` ON `vault_service_keys` (`team_id`);

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
  s.value, 'Moved from ' || s.environment || ' in project ' || p.name, 1, s.version,
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
