ALTER TABLE "image_generations" ADD COLUMN "team_id" text;--> statement-breakpoint
ALTER TABLE "video_generations" ADD COLUMN "team_id" text;--> statement-breakpoint
ALTER TABLE "image_generations" ADD CONSTRAINT "image_generations_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_generations" ADD CONSTRAINT "video_generations_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
UPDATE image_generations SET team_id = (SELECT team_members.team_id FROM team_members WHERE team_members.user_id = image_generations.owner_id ORDER BY team_members.joined_at LIMIT 1) WHERE team_id IS NULL;
--> statement-breakpoint
UPDATE video_generations SET team_id = (SELECT team_members.team_id FROM team_members WHERE team_members.user_id = video_generations.owner_id ORDER BY team_members.joined_at LIMIT 1) WHERE team_id IS NULL;
