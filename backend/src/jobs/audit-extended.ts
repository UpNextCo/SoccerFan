/**
 * Extended DB coverage audit.
 * Usage: DATABASE_URL=... npm run job:audit-extended
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

async function q(label: string, query: ReturnType<typeof sql>) {
  console.log(`\n=== ${label} ===`);
  const rows = await db.execute(query);
  console.table(rows);
}

async function main() {
  await q('ENRICHMENT GAPS (players missing data)', sql`
    SELECT
      COUNT(*)::int AS total_players,
      COUNT(*) FILTER (WHERE external_id IS NULL)::int AS no_external_id,
      COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM player_stats ps WHERE ps.player_id = p.id))::int AS no_stats,
      COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM player_transfers pt WHERE pt.player_id = p.id))::int AS no_transfers,
      COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM player_honours ph WHERE ph.player_id = p.id))::int AS no_honours,
      COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM player_career pc WHERE pc.player_id = p.id))::int AS no_career
    FROM players p
  `);

  await q('STATS BY LEAGUE + SEASON', sql`
    SELECT league_name, season, COUNT(*)::int AS rows, COUNT(DISTINCT player_id)::int AS players
    FROM player_stats
    GROUP BY league_name, season
    ORDER BY league_name, season
  `);

  await q('2025 vs 2010-2018 avg depth per league', sql`
    SELECT league_name,
      COUNT(*) FILTER (WHERE season = 2025)::int AS rows_2025,
      COUNT(*) FILTER (WHERE season BETWEEN 2010 AND 2018)::int AS rows_2010_2018,
      ROUND(COUNT(*) FILTER (WHERE season BETWEEN 2010 AND 2018)::numeric / 9, 0)::int AS avg_per_season_2010_2018
    FROM player_stats GROUP BY league_name ORDER BY league_name
  `);

  await q('EXTERNAL PLAYERS STILL MISSING ENRICHMENT', sql`
    SELECT
      COUNT(*) FILTER (WHERE external_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM player_transfers t WHERE t.player_id = p.id))::int AS ext_no_transfers,
      COUNT(*) FILTER (WHERE external_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM player_honours h WHERE h.player_id = p.id))::int AS ext_no_honours,
      COUNT(*) FILTER (WHERE external_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM player_career c WHERE c.player_id = p.id))::int AS ext_no_career,
      COUNT(*) FILTER (WHERE external_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM player_stats s WHERE s.player_id = p.id))::int AS ext_no_stats
    FROM players p
  `);

  await q('TEAMS TABLE', sql`
    SELECT COUNT(*)::int AS teams,
      COUNT(*) FILTER (WHERE league_id IS NOT NULL)::int AS with_league,
      COUNT(DISTINCT league_id)::int AS distinct_leagues
    FROM teams
  `);

  await q('PLAYER PROFILE SANITY', sql`
    SELECT
      COUNT(*) FILTER (WHERE current_club = '' OR current_club IS NULL)::int AS missing_club,
      COUNT(*) FILTER (WHERE current_league = '' OR current_league IS NULL)::int AS missing_league,
      COUNT(*) FILTER (WHERE current_club = 'Unknown')::int AS unknown_club,
      COUNT(*) FILTER (WHERE market_value_tier = 3)::int AS default_market_tier,
      COUNT(*)::int AS total
    FROM players
  `);

  await q('DAILY PUZZLES (recent dates)', sql`
    SELECT date, COUNT(*)::int AS modes
    FROM daily_puzzles
    GROUP BY date ORDER BY date DESC LIMIT 14
  `);

  await q('DAILY PUZZLE MODES PER LATEST DATE', sql`
    WITH latest AS (SELECT MAX(date) AS d FROM daily_puzzles)
    SELECT dp.mode_id, (dp.answer_player_id IS NOT NULL OR dp.answer_json IS NOT NULL) AS has_answer
    FROM daily_puzzles dp, latest
    WHERE dp.date = latest.d
    ORDER BY dp.mode_id
  `);

  await q('STUCK INGEST RUNS', sql`
    SELECT job_name, status, started_at::text, error_message
    FROM ingest_runs WHERE status = 'running' ORDER BY started_at
  `);

  await q('PLAYERS WITH CAREER/TRANSFERS BUT NO STATS', sql`
    SELECT COUNT(*)::int AS count FROM players p
    WHERE NOT EXISTS (SELECT 1 FROM player_stats s WHERE s.player_id = p.id)
    AND (
      EXISTS (SELECT 1 FROM player_career c WHERE c.player_id = p.id)
      OR EXISTS (SELECT 1 FROM player_transfers t WHERE t.player_id = p.id)
    )
  `);

  await q('2026 SEASON STATS (current campaign)', sql`
    SELECT league_name, COUNT(*)::int AS rows FROM player_stats WHERE season = 2026 GROUP BY league_name
  `);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
