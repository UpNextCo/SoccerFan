-- Leagues foundation: XP ledger, favourite team, weekly cohorts.
-- Hand-trimmed to ONLY the new objects (idempotent) because the repo migration
-- history had drifted from the live DB — do not recreate existing tables here.

CREATE TABLE IF NOT EXISTS "league_cohorts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tier" text DEFAULT 'bronze' NOT NULL,
	"week_start" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "league_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cohort_id" uuid NOT NULL REFERENCES "league_cohorts"("id") ON DELETE cascade,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"week_start" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "xp_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"date" date NOT NULL,
	"mode_id" text NOT NULL,
	"xp_earned" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "favorite_team_id" integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "league_cohorts_week_tier_idx" ON "league_cohorts" USING btree ("week_start","tier");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "league_memberships_user_week_unique" ON "league_memberships" USING btree ("user_id","week_start");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "league_memberships_cohort_idx" ON "league_memberships" USING btree ("cohort_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "xp_ledger_user_date_mode_unique" ON "xp_ledger" USING btree ("user_id","date","mode_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "xp_ledger_date_idx" ON "xp_ledger" USING btree ("date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "xp_ledger_user_idx" ON "xp_ledger" USING btree ("user_id");
