-- Tables that exist on Ball Knowledge but were created outside Drizzle
-- (jobs / live SQL). Needed so a fresh SoccerFan DB can migrate and accept a catalog copy.

CREATE TABLE IF NOT EXISTS "player_extra_stats" (
	"player_id" uuid PRIMARY KEY REFERENCES "players"("id") ON DELETE cascade,
	"penalty_goals" integer DEFAULT 0 NOT NULL,
	"weak_foot_goals" integer DEFAULT 0 NOT NULL,
	"career_hattricks" integer DEFAULT 0 NOT NULL,
	"ucl_knockout_goals" integer DEFAULT 0 NOT NULL,
	"ucl_goals_vs_english" integer DEFAULT 0 NOT NULL,
	"ucl_red_cards" integer DEFAULT 0 NOT NULL,
	"goals_before_21" integer DEFAULT 0 NOT NULL,
	"first_goal_age_days" integer,
	"debut_age_days" integer,
	"intl_caps" integer DEFAULT 0 NOT NULL,
	"intl_goals" integer DEFAULT 0 NOT NULL,
	"fbref_penalties" integer DEFAULT 0 NOT NULL,
	"tm_career_goals" integer,
	"tm_career_apps" integer,
	"tm_intl_caps" integer,
	"tm_intl_goals" integer,
	"verified_club_count" integer,
	"pl_penalties" integer DEFAULT 0 NOT NULL,
	"laliga_penalties" integer DEFAULT 0 NOT NULL,
	"seriea_penalties" integer DEFAULT 0 NOT NULL,
	"bundesliga_penalties" integer DEFAULT 0 NOT NULL,
	"ligue1_penalties" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wc_squads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"year" integer NOT NULL,
	"country" text NOT NULL,
	"player_id" uuid REFERENCES "players"("id") ON DELETE set null,
	"player_name" text NOT NULL,
	"position" text DEFAULT '' NOT NULL,
	"shirt_number" integer,
	"club" text,
	"caps" integer,
	"is_captain" boolean DEFAULT false NOT NULL,
	"coach" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wc_squads_unique" ON "wc_squads" ("year","country","player_name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wc_squads_player_idx" ON "wc_squads" ("player_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wc_match_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"year" integer NOT NULL,
	"match_id" integer NOT NULL,
	"match_date" date,
	"stage" text DEFAULT '' NOT NULL,
	"team" text NOT NULL,
	"opponent" text DEFAULT '' NOT NULL,
	"player_id" uuid REFERENCES "players"("id") ON DELETE set null,
	"player_name" text NOT NULL,
	"type" text NOT NULL,
	"minute" integer,
	"detail" text,
	"assist_player_id" uuid REFERENCES "players"("id") ON DELETE set null,
	"assist_player_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wc_match_events_player_idx" ON "wc_match_events" ("player_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wc_match_events_year_type_idx" ON "wc_match_events" ("year","type");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wc_memorable" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"year" integer NOT NULL,
	"player_id" uuid REFERENCES "players"("id") ON DELETE cascade,
	"player_name" text NOT NULL,
	"position" text DEFAULT '' NOT NULL,
	"clue" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wc_memorable_unique" ON "wc_memorable" ("year","player_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wc_memorable_year_status_idx" ON "wc_memorable" ("year","status");
