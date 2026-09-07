CREATE TABLE "video_frame_sets" (
	"generation_id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"format" text NOT NULL,
	"count" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"fps" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "video_frame_sets_generation_id_video_generations_id_fk" FOREIGN KEY ("generation_id") REFERENCES "video_generations"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "video_frame_sets_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action
);
