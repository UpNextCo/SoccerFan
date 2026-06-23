-- Teams registry for API-Football crest CDN (media.api-sports.io — free quota)
CREATE TABLE IF NOT EXISTS "teams" (
  "id" integer PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "name_norm" text NOT NULL,
  "league_id" integer,
  "country" text,
  "logo_url" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "teams_name_norm_idx" ON "teams" ("name_norm");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "teams_league_id_idx" ON "teams" ("league_id");
