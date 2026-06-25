CREATE TABLE IF NOT EXISTS "final_appearances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid,
	"player_name" text NOT NULL,
	"competition" text NOT NULL,
	"season" integer NOT NULL,
	"team" text NOT NULL,
	"started" boolean DEFAULT false NOT NULL,
	"minutes" integer DEFAULT 0 NOT NULL,
	"goals" integer DEFAULT 0 NOT NULL,
	"won" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "final_appearances" ADD CONSTRAINT "final_appearances_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "final_appearances_unique" ON "final_appearances" ("competition","season","player_name","team");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "final_appearances_player_idx" ON "final_appearances" ("player_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "final_appearances_comp_idx" ON "final_appearances" ("competition","season");
