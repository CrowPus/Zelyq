CREATE TABLE "ops_access" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"kind" text NOT NULL,
	"resource_id" text NOT NULL,
	"level" text NOT NULL,
	"granted_by" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ops_access" ADD CONSTRAINT "ops_access_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_access" ADD CONSTRAINT "ops_access_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ops_access_resource_idx" ON "ops_access" USING btree ("team_id","kind","resource_id");