-- Weekly pyramid league: divisions, London weeks, 30-player groups, membership outcomes.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "current_division" text DEFAULT 'sunday_league' NOT NULL;
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_current_division_check";
ALTER TABLE "users" ADD CONSTRAINT "users_current_division_check" CHECK (
  "current_division" IN (
    'sunday_league',
    'non_league',
    'league_two',
    'league_one',
    'championship',
    'premier_league',
    'champions_league'
  )
);

CREATE TABLE IF NOT EXISTS "league_weeks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "week_start" date NOT NULL,
  "week_end" date NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finalized_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "league_weeks_week_start_unique" ON "league_weeks" ("week_start");
--> statement-breakpoint
ALTER TABLE "league_weeks" DROP CONSTRAINT IF EXISTS "league_weeks_status_check";
ALTER TABLE "league_weeks" ADD CONSTRAINT "league_weeks_status_check" CHECK (
  "status" IN ('active', 'finalized')
);

ALTER TABLE "league_cohorts" ADD COLUMN IF NOT EXISTS "division" text;
ALTER TABLE "league_cohorts" ADD COLUMN IF NOT EXISTS "group_index" integer;
ALTER TABLE "league_cohorts" ADD COLUMN IF NOT EXISTS "league_week_id" uuid;

-- Link legacy bronze cohorts into week rows + sunday_league.
INSERT INTO "league_weeks" ("week_start", "week_end", "status")
SELECT DISTINCT c.week_start, (c.week_start + 6)::date, 'finalized'
FROM "league_cohorts" c
WHERE NOT EXISTS (
  SELECT 1 FROM "league_weeks" w WHERE w.week_start = c.week_start
)
ON CONFLICT ("week_start") DO NOTHING;

-- Distinct group_index per week (legacy weeks may already have multiple bronze cohorts).
WITH numbered AS (
  SELECT c.id,
    row_number() OVER (PARTITION BY c.week_start ORDER BY c.created_at, c.id) - 1 AS idx,
    w.id AS week_id
  FROM "league_cohorts" c
  JOIN "league_weeks" w ON w.week_start = c.week_start
)
UPDATE "league_cohorts" c
SET
  "division" = COALESCE(c."division", 'sunday_league'),
  "group_index" = COALESCE(c."group_index", n.idx),
  "league_week_id" = COALESCE(c."league_week_id", n.week_id)
FROM numbered n
WHERE c.id = n.id;

ALTER TABLE "league_cohorts" ALTER COLUMN "division" SET DEFAULT 'sunday_league';
ALTER TABLE "league_cohorts" ALTER COLUMN "division" SET NOT NULL;
ALTER TABLE "league_cohorts" ALTER COLUMN "group_index" SET DEFAULT 0;
ALTER TABLE "league_cohorts" ALTER COLUMN "group_index" SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE "league_cohorts"
    ADD CONSTRAINT "league_cohorts_league_week_id_league_weeks_id_fk"
    FOREIGN KEY ("league_week_id") REFERENCES "league_weeks"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "league_cohorts" DROP CONSTRAINT IF EXISTS "league_cohorts_division_check";
ALTER TABLE "league_cohorts" ADD CONSTRAINT "league_cohorts_division_check" CHECK (
  "division" IN (
    'sunday_league',
    'non_league',
    'league_two',
    'league_one',
    'championship',
    'premier_league',
    'champions_league'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "league_cohorts_week_division_group_unique"
  ON "league_cohorts" ("league_week_id", "division", "group_index");

ALTER TABLE "league_memberships" ADD COLUMN IF NOT EXISTS "weekly_xp" integer DEFAULT 0 NOT NULL;
ALTER TABLE "league_memberships" ADD COLUMN IF NOT EXISTS "weekly_xp_reached_at" timestamp with time zone;
ALTER TABLE "league_memberships" ADD COLUMN IF NOT EXISTS "joined_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "league_memberships" ADD COLUMN IF NOT EXISTS "final_rank" integer;
ALTER TABLE "league_memberships" ADD COLUMN IF NOT EXISTS "outcome" text;
ALTER TABLE "league_memberships" DROP CONSTRAINT IF EXISTS "league_memberships_outcome_check";
ALTER TABLE "league_memberships" ADD CONSTRAINT "league_memberships_outcome_check" CHECK (
  "outcome" IS NULL OR "outcome" IN ('promoted', 'stayed', 'relegated', 'champion')
);

CREATE TABLE IF NOT EXISTS "app_meta" (
  "key" text PRIMARY KEY NOT NULL,
  "value" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
