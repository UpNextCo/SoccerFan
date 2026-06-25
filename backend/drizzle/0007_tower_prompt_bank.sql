-- Reviewed Football Tower prompt bank. Built offline in batches; the daily puzzle draws
-- from here without replacement so days don't repeat. Idempotent.

CREATE TABLE IF NOT EXISTS "tower_prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prompt" text NOT NULL,
	"prompt_norm" text NOT NULL,
	"rule" jsonb NOT NULL,
	"answer_type" text NOT NULL,
	"tier" text NOT NULL,
	"difficulty" integer NOT NULL,
	"valid_answers" integer NOT NULL,
	"sample_answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"used_count" integer DEFAULT 0 NOT NULL,
	"last_used_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tower_prompts_norm_unique" ON "tower_prompts" USING btree ("prompt_norm");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tower_prompts_tier_status_idx" ON "tower_prompts" USING btree ("tier","status");
