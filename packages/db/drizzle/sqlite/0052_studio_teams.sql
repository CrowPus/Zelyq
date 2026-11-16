ALTER TABLE `image_generations` ADD `team_id` text REFERENCES teams(id);--> statement-breakpoint
ALTER TABLE `video_generations` ADD `team_id` text REFERENCES teams(id);--> statement-breakpoint
UPDATE image_generations SET team_id = (SELECT team_members.team_id FROM team_members WHERE team_members.user_id = image_generations.owner_id ORDER BY team_members.joined_at LIMIT 1) WHERE team_id IS NULL;
--> statement-breakpoint
UPDATE video_generations SET team_id = (SELECT team_members.team_id FROM team_members WHERE team_members.user_id = video_generations.owner_id ORDER BY team_members.joined_at LIMIT 1) WHERE team_id IS NULL;
