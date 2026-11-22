ALTER TABLE "runners" ADD COLUMN "agent_code_hash" text;--> statement-breakpoint
ALTER TABLE "runners" ADD COLUMN "agent_code_expires_at" text;--> statement-breakpoint
ALTER TABLE "runners" ADD COLUMN "last_seen_at" text;--> statement-breakpoint
ALTER TABLE "runners" ADD COLUMN "agent_version" text;