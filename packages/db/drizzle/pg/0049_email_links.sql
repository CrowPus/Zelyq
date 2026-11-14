CREATE TABLE "email_links" (
	"id" text PRIMARY KEY NOT NULL,
	"purpose" text NOT NULL,
	"token_hash" text NOT NULL,
	"email" text NOT NULL,
	"user_id" text,
	"team_id" text,
	"role" text,
	"created_by" text,
	"expires_at" text NOT NULL,
	"used_at" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_links" ADD CONSTRAINT "email_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_links" ADD CONSTRAINT "email_links_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_links" ADD CONSTRAINT "email_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_links_token_hash_idx" ON "email_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "email_links_email_idx" ON "email_links" USING btree ("email");--> statement-breakpoint
CREATE INDEX "email_links_team_id_idx" ON "email_links" USING btree ("team_id");