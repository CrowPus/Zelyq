CREATE TABLE "vault_secret_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"secret_id" text NOT NULL,
	"version" integer NOT NULL,
	"value" text NOT NULL,
	"created_by" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vault_secrets" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"environment" text NOT NULL,
	"value" text NOT NULL,
	"description" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vault_secret_versions" ADD CONSTRAINT "vault_secret_versions_secret_id_vault_secrets_id_fk" FOREIGN KEY ("secret_id") REFERENCES "public"."vault_secrets"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vault_secret_versions" ADD CONSTRAINT "vault_secret_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vault_secrets" ADD CONSTRAINT "vault_secrets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vault_secrets" ADD CONSTRAINT "vault_secrets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vault_secrets" ADD CONSTRAINT "vault_secrets_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "vault_secret_versions_secret_version_idx" ON "vault_secret_versions" USING btree ("secret_id","version");
--> statement-breakpoint
CREATE UNIQUE INDEX "vault_secrets_project_name_env_idx" ON "vault_secrets" USING btree ("project_id","name","environment");
