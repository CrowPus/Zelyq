CREATE TABLE "agent_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"project_id" text,
	"action_type" text NOT NULL,
	"title" text NOT NULL,
	"reason" text,
	"payload" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"result" text,
	"decided_by" text,
	"decided_at" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"name" text NOT NULL,
	"job" text DEFAULT '' NOT NULL,
	"project_ids" text,
	"permissions" text NOT NULL,
	"key_prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"revoked_at" text,
	"last_used_at" text,
	"last_used_ip" text,
	"created_by" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_proposals" ADD CONSTRAINT "agent_proposals_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_proposals" ADD CONSTRAINT "agent_proposals_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_proposals" ADD CONSTRAINT "agent_proposals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_proposals_team_status_idx" ON "agent_proposals" USING btree ("team_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "agents_key_hash_idx" ON "agents" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "agents_team_idx" ON "agents" USING btree ("team_id");