-- Video Studio. Earlier image columns are already applied by 0015/0016.
CREATE TABLE "video_accounts" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"lock" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_generations" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_digest" text NOT NULL,
	"input" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"credential_digest" text NOT NULL,
	"reference_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"active_owner" text,
	"worker_slot" integer,
	"lease_token" text,
	"lease_until" text,
	"next_poll_at" text NOT NULL,
	"operation" text,
	"created_at" text NOT NULL,
	"completed_at" text,
	"deleted_at" text,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"storage_bytes" integer NOT NULL,
	"metadata" text
);
--> statement-breakpoint
CREATE TABLE "video_references" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"size_bytes" integer NOT NULL,
	"digest" text NOT NULL,
	"created_at" text NOT NULL,
	"expires_at" text
);
--> statement-breakpoint
ALTER TABLE "video_accounts" ADD CONSTRAINT "video_accounts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_generations" ADD CONSTRAINT "video_generations_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_references" ADD CONSTRAINT "video_references_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "video_generations_request_idx" ON "video_generations" USING btree ("owner_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "video_generations_active_idx" ON "video_generations" USING btree ("active_owner");--> statement-breakpoint
CREATE UNIQUE INDEX "video_generations_slot_idx" ON "video_generations" USING btree ("worker_slot");--> statement-breakpoint
CREATE INDEX "video_generations_history_idx" ON "video_generations" USING btree ("owner_id","created_at");
