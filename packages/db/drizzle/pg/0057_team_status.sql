ALTER TABLE "teams" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "status_reason" text;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "status_message" text;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "status_changed_at" text;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "last_active_at" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_seen_at" text;--> statement-breakpoint
UPDATE "teams" SET "last_active_at" = to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') WHERE "last_active_at" IS NULL;
