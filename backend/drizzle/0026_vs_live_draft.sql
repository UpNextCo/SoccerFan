-- VS live Draft XI: current slot, deadline, and per-player locks.
ALTER TABLE "vs_challenges" ADD COLUMN IF NOT EXISTS "live_json" jsonb;
