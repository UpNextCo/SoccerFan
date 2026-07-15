CREATE TABLE "ops_media" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "kind" text NOT NULL,
  "mime_type" text NOT NULL,
  "bytes" bytea NOT NULL,
  "size" integer NOT NULL,
  "original_filename" text,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ops_media_kind_check" CHECK ("ops_media"."kind" = 'lms_custom_image'),
  CONSTRAINT "ops_media_mime_type_check" CHECK ("ops_media"."mime_type" IN ('image/jpeg', 'image/png', 'image/webp')),
  CONSTRAINT "ops_media_size_check" CHECK ("ops_media"."size" > 0 AND "ops_media"."size" <= 2621440),
  CONSTRAINT "ops_media_bytes_size_check" CHECK (octet_length("ops_media"."bytes") = "ops_media"."size"),
  CONSTRAINT "ops_media_original_filename_check" CHECK ("ops_media"."original_filename" IS NULL OR length("ops_media"."original_filename") <= 255)
);
--> statement-breakpoint
CREATE INDEX "ops_media_kind_created_idx" ON "ops_media" USING btree ("kind", "created_at");
