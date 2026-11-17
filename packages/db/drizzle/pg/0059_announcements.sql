CREATE TABLE "announcement_views" (
	"announcement_id" text NOT NULL,
	"user_id" text NOT NULL,
	"seen_at" text,
	"dismissed_at" text,
	"clicked_at" text
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"level" text DEFAULT 'info' NOT NULL,
	"display" text DEFAULT 'banner' NOT NULL,
	"audience_kind" text DEFAULT 'everyone' NOT NULL,
	"audience_value" text,
	"link_url" text,
	"link_label" text,
	"starts_at" text NOT NULL,
	"ends_at" text,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"level" text DEFAULT 'info' NOT NULL,
	"link_url" text,
	"link_label" text,
	"source" text NOT NULL,
	"created_at" text NOT NULL,
	"read_at" text
);
--> statement-breakpoint
ALTER TABLE "announcement_views" ADD CONSTRAINT "announcement_views_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_views" ADD CONSTRAINT "announcement_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "announcement_views_pair_idx" ON "announcement_views" USING btree ("announcement_id","user_id");--> statement-breakpoint
CREATE INDEX "announcements_window_idx" ON "announcements" USING btree ("starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "user_notifications_user_created_idx" ON "user_notifications" USING btree ("user_id","created_at");