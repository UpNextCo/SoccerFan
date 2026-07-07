-- Fine positions a player can fill in Draft XI / World Cup XI (primary sub_position + alternates).
ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "sub_positions" text[] DEFAULT '{}'::text[] NOT NULL;

-- Backfill from existing primary fine position.
UPDATE "players"
SET "sub_positions" = ARRAY["sub_position"]
WHERE "sub_position" IS NOT NULL
  AND "sub_position" <> ''
  AND ("sub_positions" IS NULL OR "sub_positions" = '{}'::text[]);
