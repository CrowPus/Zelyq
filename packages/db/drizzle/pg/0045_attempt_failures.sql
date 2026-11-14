ALTER TABLE "ops_attempts" ADD COLUMN "failures" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE "ops_attempts" SET "failures" = 1 WHERE "ok" = false;
