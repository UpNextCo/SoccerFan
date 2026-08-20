CREATE TABLE IF NOT EXISTS "vs_puzzle_bank" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "mode_id" text NOT NULL,
  "title" text NOT NULL,
  "puzzle_json" jsonb NOT NULL,
  "answer_json" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vs_puzzle_bank_mode_title_unique" ON "vs_puzzle_bank" USING btree ("mode_id", "title");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vs_puzzle_bank_mode_idx" ON "vs_puzzle_bank" USING btree ("mode_id");
