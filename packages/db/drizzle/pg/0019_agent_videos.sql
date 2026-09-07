ALTER TABLE "video_generations" ADD COLUMN "source" text DEFAULT 'studio' NOT NULL;--> statement-breakpoint
ALTER TABLE "video_generations" ADD COLUMN "project_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "video_generations" ADD COLUMN "project_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "video_generations" ADD COLUMN "session_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "video_generation_enabled" boolean DEFAULT false NOT NULL;
