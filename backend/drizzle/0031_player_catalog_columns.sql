-- Player columns that exist on Ball Knowledge but were added outside Drizzle.
ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "foot" text;
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "sub_position" text;
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "tm_player_id" text;
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "api_football_id" integer;
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "photo_url" text;
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "market_value_eur" integer;
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "peak_market_value_eur" integer;
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "record_fee_eur" integer;
