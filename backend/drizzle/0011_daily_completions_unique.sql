-- Dedupe historical duplicates (keep the first row per user/date/mode), then enforce
-- uniqueness in the DB so concurrent /daily/complete requests can't double-award XP.
DELETE FROM "daily_completions" a
USING "daily_completions" b
WHERE a."user_id" = b."user_id"
  AND a."date" = b."date"
  AND a."mode_id" = b."mode_id"
  AND a.ctid > b.ctid;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "daily_completions_user_date_mode_unique" ON "daily_completions" ("user_id","date","mode_id");
