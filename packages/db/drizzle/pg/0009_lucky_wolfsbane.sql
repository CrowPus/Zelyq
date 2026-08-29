CREATE TABLE "provider_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"credential_type" text NOT NULL,
	"encrypted_blob" text NOT NULL,
	"granted_scopes" text DEFAULT '' NOT NULL,
	"expires_at" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"last_used_at" text
);
--> statement-breakpoint
CREATE TABLE "provider_resources" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"org_id" text NOT NULL,
	"project_ref" text NOT NULL,
	"project_url" text NOT NULL,
	"publishable_key" text NOT NULL,
	"environment" text DEFAULT 'development' NOT NULL,
	"region" text,
	"display_name" text NOT NULL,
	"provisioned_by_zelyq" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_provider_links" (
	"zelyq_project_id" text PRIMARY KEY NOT NULL,
	"provider_resource_id" text NOT NULL,
	"linked_by" text NOT NULL,
	"linked_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_operations" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text,
	"zelyq_project_id" text,
	"action" text NOT NULL,
	"outcome" text NOT NULL,
	"detail" text DEFAULT '{}' NOT NULL,
	"actor_user_id" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provider_connections" ADD CONSTRAINT "provider_connections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_resources" ADD CONSTRAINT "provider_resources_connection_id_provider_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_provider_links" ADD CONSTRAINT "project_provider_links_zelyq_project_id_projects_id_fk" FOREIGN KEY ("zelyq_project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_provider_links" ADD CONSTRAINT "project_provider_links_provider_resource_id_provider_resources_id_fk" FOREIGN KEY ("provider_resource_id") REFERENCES "public"."provider_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_provider_links" ADD CONSTRAINT "project_provider_links_linked_by_users_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provider_connections_provider_idx" ON "provider_connections" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "provider_connections_created_by_idx" ON "provider_connections" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_resources_connection_ref_idx" ON "provider_resources" USING btree ("connection_id","project_ref");--> statement-breakpoint
CREATE INDEX "project_provider_links_resource_idx" ON "project_provider_links" USING btree ("provider_resource_id");--> statement-breakpoint
CREATE INDEX "provider_operations_connection_id_idx" ON "provider_operations" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "provider_operations_created_at_idx" ON "provider_operations" USING btree ("created_at");
