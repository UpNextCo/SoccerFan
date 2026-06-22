ALTER TABLE "daily_puzzles" ALTER COLUMN "answer_player_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "daily_puzzles" ADD COLUMN IF NOT EXISTS "answer_json" jsonb;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "daily_puzzles_date_mode_unique" ON "daily_puzzles" ("date", "mode_id");
