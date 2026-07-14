ALTER TABLE "lms_bank" ADD COLUMN "content_signature" text;
--> statement-breakpoint
DROP INDEX IF EXISTS "lms_bank_repeat_norm_unique";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lms_bank_repeat_norm_idx"
  ON "lms_bank" USING btree ("repeat_norm");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lms_bank_content_signature_unique"
  ON "lms_bank" USING btree ("content_signature")
  WHERE "content_signature" IS NOT NULL;
