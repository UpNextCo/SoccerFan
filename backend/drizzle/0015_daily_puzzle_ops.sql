ALTER TABLE "daily_puzzles" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'generated' NOT NULL;
--> statement-breakpoint
ALTER TABLE "daily_puzzles" ADD COLUMN IF NOT EXISTS "reviewed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "daily_puzzles" ADD COLUMN IF NOT EXISTS "review_note" text;
--> statement-breakpoint
ALTER TABLE "daily_puzzles" ADD COLUMN IF NOT EXISTS "content_hash" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "daily_puzzles_status_idx" ON "daily_puzzles" USING btree ("status");
