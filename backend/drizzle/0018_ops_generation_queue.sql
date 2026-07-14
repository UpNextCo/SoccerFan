CREATE TABLE "ops_generation_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "year_month" text NOT NULL,
  "requested_modes" text[] NOT NULL,
  "mode_scope" text NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "total_count" integer NOT NULL,
  "completed_count" integer DEFAULT 0 NOT NULL,
  "failed_count" integer DEFAULT 0 NOT NULL,
  "skipped_count" integer DEFAULT 0 NOT NULL,
  "requested_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ops_generation_runs_year_month_check"
    CHECK ("year_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT "ops_generation_runs_status_check"
    CHECK ("status" IN ('queued', 'running', 'completed', 'completed_with_failures')),
  CONSTRAINT "ops_generation_runs_total_count_check" CHECK ("total_count" >= 0),
  CONSTRAINT "ops_generation_runs_completed_count_check" CHECK ("completed_count" >= 0),
  CONSTRAINT "ops_generation_runs_failed_count_check" CHECK ("failed_count" >= 0),
  CONSTRAINT "ops_generation_runs_skipped_count_check" CHECK ("skipped_count" >= 0),
  CONSTRAINT "ops_generation_runs_counter_bounds_check"
    CHECK (
      "completed_count" <= "total_count"
      AND "failed_count" <= "completed_count"
      AND "skipped_count" <= "completed_count"
      AND "failed_count" + "skipped_count" <= "completed_count"
    )
);
--> statement-breakpoint
CREATE TABLE "ops_generation_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid NOT NULL,
  "date" date NOT NULL,
  "mode_id" text NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "error" text,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ops_generation_items_status_check"
    CHECK ("status" IN ('queued', 'running', 'succeeded', 'skipped', 'failed')),
  CONSTRAINT "ops_generation_items_attempts_check"
    CHECK ("attempts" >= 0 AND "attempts" <= 3)
);
--> statement-breakpoint
ALTER TABLE "ops_generation_items"
  ADD CONSTRAINT "ops_generation_items_run_id_ops_generation_runs_id_fk"
  FOREIGN KEY ("run_id") REFERENCES "public"."ops_generation_runs"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "ops_generation_runs_active_month_unique"
  ON "ops_generation_runs" USING btree ("year_month")
  WHERE "status" IN ('queued', 'running');
--> statement-breakpoint
CREATE INDEX "ops_generation_runs_month_created_idx"
  ON "ops_generation_runs" USING btree ("year_month", "created_at");
--> statement-breakpoint
CREATE INDEX "ops_generation_runs_status_updated_idx"
  ON "ops_generation_runs" USING btree ("status", "updated_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "ops_generation_items_run_date_mode_unique"
  ON "ops_generation_items" USING btree ("run_id", "date", "mode_id");
--> statement-breakpoint
CREATE INDEX "ops_generation_items_claim_idx"
  ON "ops_generation_items" USING btree ("status", "next_attempt_at");
--> statement-breakpoint
CREATE INDEX "ops_generation_items_run_status_idx"
  ON "ops_generation_items" USING btree ("run_id", "status");
