CREATE TABLE IF NOT EXISTS "vs_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"mode_id" text DEFAULT 'draft_master' NOT NULL,
	"host_user_id" uuid NOT NULL,
	"guest_user_id" uuid,
	"status" text DEFAULT 'waiting' NOT NULL,
	"puzzle_json" jsonb NOT NULL,
	"host_score" integer,
	"guest_score" integer,
	"host_answer_json" jsonb,
	"guest_answer_json" jsonb,
	"host_completed_at" timestamp with time zone,
	"guest_completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vs_challenges" ADD CONSTRAINT "vs_challenges_host_user_id_users_id_fk" FOREIGN KEY ("host_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vs_challenges" ADD CONSTRAINT "vs_challenges_guest_user_id_users_id_fk" FOREIGN KEY ("guest_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vs_challenges_code_unique" ON "vs_challenges" USING btree ("code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vs_challenges_host_idx" ON "vs_challenges" USING btree ("host_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vs_challenges_guest_idx" ON "vs_challenges" USING btree ("guest_user_id");
