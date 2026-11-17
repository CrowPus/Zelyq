CREATE TABLE "product_daily" (
	"day" text NOT NULL,
	"name" text NOT NULL,
	"count" integer NOT NULL,
	"people" integer NOT NULL,
	"teams" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_events" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"user_id" text,
	"team_id" text,
	"project_id" text,
	"detail" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "product_daily_day_name_idx" ON "product_daily" USING btree ("day","name");--> statement-breakpoint
CREATE INDEX "product_events_name_created_idx" ON "product_events" USING btree ("name","created_at");--> statement-breakpoint
CREATE INDEX "product_events_created_idx" ON "product_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "product_events_team_created_idx" ON "product_events" USING btree ("team_id","created_at");--> statement-breakpoint
CREATE INDEX "product_events_user_created_idx" ON "product_events" USING btree ("user_id","created_at");