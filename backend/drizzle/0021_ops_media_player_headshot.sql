ALTER TABLE "ops_media" DROP CONSTRAINT "ops_media_kind_check";
--> statement-breakpoint
ALTER TABLE "ops_media" ADD CONSTRAINT "ops_media_kind_check" CHECK ("ops_media"."kind" IN ('lms_custom_image', 'player_headshot'));
