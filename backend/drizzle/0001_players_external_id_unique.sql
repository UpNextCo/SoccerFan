-- Repoint daily puzzles from duplicate players to the keeper row (lowest id per external_id)
WITH keepers AS (
  SELECT DISTINCT ON (external_id) id AS keeper_id, external_id
  FROM players
  WHERE external_id IS NOT NULL
  ORDER BY external_id, id
),
dupes AS (
  SELECT p.id AS dupe_id, k.keeper_id
  FROM players p
  INNER JOIN keepers k ON p.external_id = k.external_id
  WHERE p.id <> k.keeper_id
)
UPDATE daily_puzzles AS dp
SET answer_player_id = d.keeper_id
FROM dupes d
WHERE dp.answer_player_id = d.dupe_id;
--> statement-breakpoint
-- Remove duplicate API players (keep the oldest id per external_id)
DELETE FROM players AS p1
USING players AS p2
WHERE p1.external_id IS NOT NULL
  AND p1.external_id = p2.external_id
  AND p1.id > p2.id;
--> statement-breakpoint
-- Repoint daily puzzles from seed rows to matching ingested players
UPDATE daily_puzzles AS dp
SET answer_player_id = api.id
FROM players AS seed
INNER JOIN players AS api
  ON api.external_id IS NOT NULL
  AND api.search_text = seed.search_text
WHERE dp.answer_player_id = seed.id
  AND seed.external_id IS NULL;
--> statement-breakpoint
-- Drop seed rows that duplicate an ingested player by search_text
DELETE FROM players AS seed
WHERE seed.external_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM players AS api
    WHERE api.external_id IS NOT NULL
      AND api.search_text = seed.search_text
  );
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "players_external_id_unique" ON "players" ("external_id");
