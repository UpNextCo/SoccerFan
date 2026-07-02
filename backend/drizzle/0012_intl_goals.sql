-- International goals from the Wikipedia list ingest (ingest-intl-stats-wiki).
ALTER TABLE "player_extra_stats" ADD COLUMN IF NOT EXISTS "intl_goals" integer DEFAULT 0 NOT NULL;
