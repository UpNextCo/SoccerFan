-- Player date of birth: the reliable identity key for name reconciliation and
-- de-duplication (popular-name nicknames like "Isco" only match Transfermarkt
-- by DOB + nationality, not by name). Idempotent.

ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "birth_date" date;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "players_birth_nat_idx" ON "players" USING btree ("birth_date","nationality");
