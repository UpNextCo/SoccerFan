CREATE TABLE IF NOT EXISTS "lms_bank" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "type" text NOT NULL,
  "tier" text NOT NULL,
  "difficulty" integer DEFAULT 50 NOT NULL,
  "repeat_key" text NOT NULL,
  "repeat_norm" text NOT NULL,
  "question_json" jsonb NOT NULL,
  "answer_json" jsonb NOT NULL,
  "extra_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "review_reason" text,
  "status" text DEFAULT 'active' NOT NULL,
  "used_count" integer DEFAULT 0 NOT NULL,
  "last_used_date" date,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lms_bank_repeat_norm_unique" ON "lms_bank" USING btree ("repeat_norm");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lms_bank_type_tier_status_idx" ON "lms_bank" USING btree ("type","tier","status");
