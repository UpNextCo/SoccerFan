CREATE TABLE IF NOT EXISTS "player_data_reviews" (
  "player_id" uuid PRIMARY KEY NOT NULL REFERENCES "players"("id") ON DELETE CASCADE,
  "status" text DEFAULT 'pending' NOT NULL,
  "note" text,
  "reviewed_by" text,
  "reviewed_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "player_data_reviews_status_idx" ON "player_data_reviews" USING btree ("status");
