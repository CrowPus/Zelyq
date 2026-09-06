CREATE TABLE "image_generations" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"prompt" text NOT NULL,
	"model" text NOT NULL,
	"size" text NOT NULL,
	"quality" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"active_owner" text,
	"worker_slot" integer,
	"lease_until" text,
	"created_at" text NOT NULL,
	"completed_at" text,
	"deleted_at" text,
	"error" text,
	"provider_request_id" text,
	"usage" text,
	"width" integer,
	"height" integer,
	"size_bytes" integer
);
--> statement-breakpoint
ALTER TABLE "image_generations" ADD CONSTRAINT "image_generations_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "image_generations_request_idx" ON "image_generations" USING btree ("owner_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "image_generations_active_idx" ON "image_generations" USING btree ("active_owner");--> statement-breakpoint
CREATE UNIQUE INDEX "image_generations_slot_idx" ON "image_generations" USING btree ("worker_slot");--> statement-breakpoint
CREATE INDEX "image_generations_history_idx" ON "image_generations" USING btree ("owner_id","created_at");
