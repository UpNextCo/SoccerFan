CREATE TABLE IF NOT EXISTS "manager_tenures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"manager" text NOT NULL,
	"manager_norm" text NOT NULL,
	"club" text NOT NULL,
	"club_norm" text NOT NULL,
	"season_from" integer NOT NULL,
	"season_to" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "manager_tenures_unique" ON "manager_tenures" ("manager_norm","club_norm","season_from");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "manager_tenures_manager_idx" ON "manager_tenures" ("manager_norm");
