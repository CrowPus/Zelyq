ALTER TABLE "agents" ADD COLUMN "media" text;--> statement-breakpoint
ALTER TABLE "image_generations" ADD COLUMN "key_ref" text;--> statement-breakpoint
ALTER TABLE "video_generations" ADD COLUMN "key_ref" text;