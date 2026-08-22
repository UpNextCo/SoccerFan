#!/usr/bin/env bash
# Copy football catalog (+ puzzle banks / media) from Ball Knowledge → SoccerFan.
# Never copies users, progress, completions, leagues, or VS challenges.
#
# Run on your laptop only. Do not put SOURCE_DATABASE_URL on the SoccerFan Railway service.
#
#   SOURCE_DATABASE_URL='postgresql://...BK public...' \
#   TARGET_DATABASE_URL='postgresql://...SoccerFan public...' \
#   ./scripts/copy-football-catalog.sh
#
# Both URLs must be the Railway *public* TCP URLs (DATABASE_PUBLIC_URL).
# Internal railway.internal hosts only work between services in the same project.

set -euo pipefail

SOURCE="${SOURCE_DATABASE_URL:-}"
TARGET="${TARGET_DATABASE_URL:-}"

if [[ -z "$SOURCE" || -z "$TARGET" ]]; then
  echo "Set SOURCE_DATABASE_URL (Ball Knowledge public) and TARGET_DATABASE_URL (SoccerFan public)."
  exit 1
fi

if [[ "$SOURCE" == "$TARGET" ]]; then
  echo "Refusing: source and target are the same URL."
  exit 1
fi

target_lower="$(printf '%s' "$TARGET" | tr '[:upper:]' '[:lower:]')"
if [[ "$target_lower" == *ballknowledge* ]]; then
  echo "Refusing: TARGET_DATABASE_URL looks like Ball Knowledge. SoccerFan only."
  exit 1
fi

if ! command -v pg_dump >/dev/null || ! command -v psql >/dev/null; then
  echo "Need pg_dump and psql on PATH (brew install libpq && brew link --force libpq)."
  exit 1
fi

# Football reference + reusable content. No user / gameplay tables.
TABLES=(
  teams
  players
  player_stats
  player_transfers
  player_honours
  player_career
  player_extra_stats
  player_awards
  manager_tenures
  final_appearances
  wc_squads
  wc_match_events
  wc_memorable
  tower_prompts
  lms_bank
  vs_puzzle_bank
  question_templates
  ops_media
  player_data_reviews
)

dump_args=()
for table in "${TABLES[@]}"; do
  dump_args+=(--table="$table")
done

echo "Checking target is a migrated SoccerFan DB with no users / players..."
target_users="$(psql "$TARGET" -tAc "SELECT COUNT(*) FROM users")"
target_players="$(psql "$TARGET" -tAc "SELECT COUNT(*) FROM players")"

if [[ "$target_users" != "0" ]]; then
  echo "Refusing: target users table has $target_users rows. Expected empty."
  exit 1
fi
if [[ "$target_players" != "0" ]]; then
  echo "Refusing: target players table has $target_players rows. Already loaded?"
  exit 1
fi

echo "Source football rows:"
psql "$SOURCE" -c "SELECT 'players' AS t, COUNT(*) FROM players UNION ALL SELECT 'player_stats', COUNT(*) FROM player_stats UNION ALL SELECT 'teams', COUNT(*) FROM teams ORDER BY 1"

echo "Copying ${#TABLES[@]} tables (read-only from source)..."
# replica role skips FK order issues while loading into an empty catalog.
{
  echo "SET session_replication_role = replica;"
  pg_dump "$SOURCE" --data-only --no-owner --no-acl --no-comments "${dump_args[@]}"
  echo "SET session_replication_role = origin;"
} | psql "$TARGET" -v ON_ERROR_STOP=1

echo "Target football rows after copy:"
psql "$TARGET" -c "SELECT 'players' AS t, COUNT(*) FROM players UNION ALL SELECT 'player_stats', COUNT(*) FROM player_stats UNION ALL SELECT 'teams', COUNT(*) FROM teams UNION ALL SELECT 'users', COUNT(*) FROM users ORDER BY 1"

echo "Done. SoccerFan has the catalog; users/games were not copied. Ball Knowledge was not written to."
