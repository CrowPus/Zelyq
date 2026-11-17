CREATE TABLE "error_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"fingerprint" text NOT NULL,
	"kind" text NOT NULL,
	"message" text NOT NULL,
	"location" text NOT NULL,
	"route" text,
	"count" integer DEFAULT 0 NOT NULL,
	"first_seen" text NOT NULL,
	"last_seen" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_at" text,
	"sample_stack" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "error_hits" (
	"group_id" text NOT NULL,
	"user_id" text,
	"team_id" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "error_hits" ADD CONSTRAINT "error_hits_group_id_error_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."error_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "error_groups_fingerprint_idx" ON "error_groups" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "error_groups_last_seen_idx" ON "error_groups" USING btree ("last_seen");--> statement-breakpoint
CREATE INDEX "error_hits_group_created_idx" ON "error_hits" USING btree ("group_id","created_at");--> statement-breakpoint
CREATE INDEX "error_hits_created_idx" ON "error_hits" USING btree ("created_at");