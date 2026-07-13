CREATE TABLE IF NOT EXISTS "question_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mode" text NOT NULL,
	"name" text NOT NULL,
	"prompt" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"validation_pass_count" integer DEFAULT 0 NOT NULL,
	"validation_fail_count" integer DEFAULT 0 NOT NULL,
	"used_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "question_templates_status_check" CHECK ("status" IN ('draft', 'active', 'archived')),
	CONSTRAINT "question_templates_validation_pass_count_check" CHECK ("validation_pass_count" >= 0),
	CONSTRAINT "question_templates_validation_fail_count_check" CHECK ("validation_fail_count" >= 0),
	CONSTRAINT "question_templates_used_count_check" CHECK ("used_count" >= 0),
	CONSTRAINT "question_templates_active_config_check" CHECK (
		"status" <> 'active' OR (
			"mode" = 'one_more'
			AND jsonb_typeof("config") = 'object'
			AND jsonb_typeof("config"->'metricId') = 'string'
			AND "config"->>'metricId' IN (
				'pl_goals', 'pl_assists', 'laliga_goals', 'seriea_goals', 'cl_goals',
				'cl_knockout_goals', 'pl_penalties', 'laliga_penalties', 'seriea_penalties',
				'hattricks', 'intl_caps', 'goals_before_21', 'weak_foot_goals',
				'non_big6_pl_goals', 'seriea_ligue1_goals'
			)
			AND jsonb_typeof("config"->'threshold') = 'number'
			AND ("config"->>'threshold')::numeric >= 0
			AND jsonb_typeof("config"->'valueNoun') = 'string'
			AND length(trim("config"->>'valueNoun')) > 0
		)
	)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "question_templates_mode_name_unique" ON "question_templates" USING btree ("mode","name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "question_templates_mode_status_idx" ON "question_templates" USING btree ("mode","status");
