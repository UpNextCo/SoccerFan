CREATE TABLE "daily_completions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"mode_id" text NOT NULL,
	"score" integer NOT NULL,
	"guesses" integer NOT NULL,
	"won" boolean NOT NULL,
	"share_grid" text NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_puzzles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"mode_id" text NOT NULL,
	"puzzle_json" jsonb NOT NULL,
	"answer_player_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" text,
	"name" text NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"nationality" text NOT NULL,
	"position" text NOT NULL,
	"age" integer NOT NULL,
	"current_club" text NOT NULL,
	"current_league" text NOT NULL,
	"shirt_number" integer,
	"market_value_tier" integer DEFAULT 3 NOT NULL,
	"search_text" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_progress" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"xp" integer DEFAULT 0 NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"streak" integer DEFAULT 0 NOT NULL,
	"last_played_date" date,
	"today_xp" integer DEFAULT 0 NOT NULL,
	"today_xp_date" date
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"apple_sub" text NOT NULL,
	"display_name" text DEFAULT 'Player' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_apple_sub_unique" UNIQUE("apple_sub")
);
--> statement-breakpoint
ALTER TABLE "daily_completions" ADD CONSTRAINT "daily_completions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_puzzles" ADD CONSTRAINT "daily_puzzles_answer_player_id_players_id_fk" FOREIGN KEY ("answer_player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_progress" ADD CONSTRAINT "user_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "daily_completions_user_date_idx" ON "daily_completions" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "daily_puzzles_date_mode_idx" ON "daily_puzzles" USING btree ("date","mode_id");--> statement-breakpoint
CREATE INDEX "players_search_idx" ON "players" USING btree ("search_text");