ALTER TABLE "vs_challenges" ADD COLUMN IF NOT EXISTS "rematch_of_id" uuid;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vs_challenges_rematch_of_unique" ON "vs_challenges" USING btree ("rematch_of_id");
