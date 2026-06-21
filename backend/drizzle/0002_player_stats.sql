CREATE TABLE IF NOT EXISTS "player_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"external_player_id" text,
	"league_id" integer NOT NULL,
	"league_name" text NOT NULL,
	"season" integer NOT NULL,
	"team_id" integer DEFAULT 0 NOT NULL,
	"team_name" text,
	"appearances" integer DEFAULT 0 NOT NULL,
	"minutes" integer DEFAULT 0 NOT NULL,
	"goals" integer DEFAULT 0 NOT NULL,
	"assists" integer DEFAULT 0 NOT NULL,
	"yellow_cards" integer DEFAULT 0 NOT NULL,
	"red_cards" integer DEFAULT 0 NOT NULL,
	"clean_sheets" integer,
	"saves" integer,
	"fouls_committed" integer,
	"tackles" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "player_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"transfer_date" date,
	"from_team_id" integer,
	"from_team_name" text,
	"to_team_id" integer,
	"to_team_name" text,
	"fee_raw" text,
	"fee_eur_m" numeric(10, 2),
	"transfer_type" text DEFAULT 'unknown' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "player_honours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"competition" text NOT NULL,
	"country" text,
	"season" text NOT NULL,
	"placement" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "player_career" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"team_id" integer NOT NULL,
	"team_name" text NOT NULL,
	"season_from" integer NOT NULL,
	"season_to" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ingest_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_name" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"rows_upserted" integer DEFAULT 0 NOT NULL,
	"api_calls_used" integer DEFAULT 0 NOT NULL,
	"error_message" text
);
--> statement-breakpoint
ALTER TABLE "player_stats" ADD CONSTRAINT "player_stats_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "player_transfers" ADD CONSTRAINT "player_transfers_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "player_honours" ADD CONSTRAINT "player_honours_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "player_career" ADD CONSTRAINT "player_career_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "player_stats_unique" ON "player_stats" USING btree ("player_id","league_id","season","team_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "player_stats_league_metric_idx" ON "player_stats" USING btree ("league_id","season");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "player_transfers_unique" ON "player_transfers" USING btree ("player_id","transfer_date","from_team_id","to_team_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "player_honours_unique" ON "player_honours" USING btree ("player_id","competition","season","placement");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "player_career_unique" ON "player_career" USING btree ("player_id","team_id","season_from");
