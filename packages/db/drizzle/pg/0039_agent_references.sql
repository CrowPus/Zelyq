CREATE TABLE "agent_references" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"team_id" text NOT NULL,
	"name" text NOT NULL,
	"mime_type" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_references" ADD CONSTRAINT "agent_references_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_references_agent_idx" ON "agent_references" USING btree ("agent_id");