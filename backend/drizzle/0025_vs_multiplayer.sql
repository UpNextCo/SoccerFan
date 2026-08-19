-- VS: four modes + host and up to 3 friends (participants_json).
ALTER TABLE "vs_challenges" ADD COLUMN IF NOT EXISTS "answer_json" jsonb;
ALTER TABLE "vs_challenges" ADD COLUMN IF NOT EXISTS "participants_json" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
UPDATE "vs_challenges"
SET "participants_json" = CASE
  WHEN "guest_user_id" IS NOT NULL THEN jsonb_build_array(
    jsonb_build_object(
      'userId', "host_user_id"::text,
      'score', "host_score",
      'displayScore', "host_score",
      'completedAt', "host_completed_at"
    ),
    jsonb_build_object(
      'userId', "guest_user_id"::text,
      'score', "guest_score",
      'displayScore', "guest_score",
      'completedAt', "guest_completed_at"
    )
  )
  ELSE jsonb_build_array(
    jsonb_build_object(
      'userId', "host_user_id"::text,
      'score', "host_score",
      'displayScore', "host_score",
      'completedAt', "host_completed_at"
    )
  )
END
WHERE "participants_json" = '[]'::jsonb;
