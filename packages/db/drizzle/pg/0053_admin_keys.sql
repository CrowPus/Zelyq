CREATE TABLE "admin_idempotency" (
	"key_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status_code" integer NOT NULL,
	"response" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"scopes" text NOT NULL,
	"key_prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"created_by" text,
	"created_at" text NOT NULL,
	"last_used_at" text,
	"last_used_ip" text,
	"revoked_at" text
);
--> statement-breakpoint
ALTER TABLE "admin_idempotency" ADD CONSTRAINT "admin_idempotency_key_id_admin_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."admin_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_keys" ADD CONSTRAINT "admin_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_idempotency_key_idx" ON "admin_idempotency" USING btree ("key_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "admin_idempotency_created_idx" ON "admin_idempotency" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_keys_key_hash_idx" ON "admin_keys" USING btree ("key_hash");