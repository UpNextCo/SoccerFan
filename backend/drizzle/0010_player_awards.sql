CREATE TABLE IF NOT EXISTS "player_awards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid,
	"player_name" text NOT NULL,
	"award" text NOT NULL,
	"year" integer NOT NULL,
	"placement" text DEFAULT 'winner' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "player_awards" ADD CONSTRAINT "player_awards_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "player_awards_unique" ON "player_awards" ("award","year","player_name","placement");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "player_awards_player_idx" ON "player_awards" ("player_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "player_awards_award_idx" ON "player_awards" ("award");
