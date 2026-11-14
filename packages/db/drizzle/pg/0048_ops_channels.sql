CREATE TABLE "ops_channel_links" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"chat_id" text NOT NULL,
	"label" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_channels" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"account" text NOT NULL,
	"secret" text NOT NULL,
	"team_chat" text,
	"status" text NOT NULL,
	"last_error" text,
	"poll_offset" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_link_codes" (
	"code_hash" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"chat_id" text,
	"label" text,
	"expires_at" text NOT NULL,
	"used_at" text
);
--> statement-breakpoint
CREATE TABLE "ops_notify_prefs" (
	"team_id" text NOT NULL,
	"user_id" text NOT NULL,
	"prefs" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ops_channel_links" ADD CONSTRAINT "ops_channel_links_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_channel_links" ADD CONSTRAINT "ops_channel_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_channels" ADD CONSTRAINT "ops_channels_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_channels" ADD CONSTRAINT "ops_channels_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_link_codes" ADD CONSTRAINT "ops_link_codes_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_link_codes" ADD CONSTRAINT "ops_link_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_notify_prefs" ADD CONSTRAINT "ops_notify_prefs_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_notify_prefs" ADD CONSTRAINT "ops_notify_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ops_channel_links_person_idx" ON "ops_channel_links" USING btree ("team_id","kind","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ops_channels_team_kind_idx" ON "ops_channels" USING btree ("team_id","kind");--> statement-breakpoint
CREATE INDEX "ops_channels_account_idx" ON "ops_channels" USING btree ("account");--> statement-breakpoint
CREATE INDEX "ops_link_codes_person_idx" ON "ops_link_codes" USING btree ("team_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ops_notify_prefs_person_idx" ON "ops_notify_prefs" USING btree ("team_id","user_id");