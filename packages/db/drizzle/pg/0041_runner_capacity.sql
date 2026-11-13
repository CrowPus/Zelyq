ALTER TABLE "runners" ADD COLUMN "cpus" integer;--> statement-breakpoint
ALTER TABLE "runners" ADD COLUMN "memory_mb" integer;--> statement-breakpoint
-- 1 was the old default, never a choice: runners size themselves now.
UPDATE "runners" SET "max_concurrent" = 0 WHERE "max_concurrent" = 1;
