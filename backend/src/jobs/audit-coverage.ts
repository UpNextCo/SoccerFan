/**
 * Print DB coverage gaps for stats / players.
 * Usage: DATABASE_URL=... npm run job:audit-coverage
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

async function main() {
  const counts = await db.execute(sql`
    SELECT 'players' AS t, COUNT(*)::int AS n FROM players
    UNION ALL SELECT 'external_players', COUNT(*)::int FROM players WHERE external_id IS NOT NULL
    UNION ALL SELECT 'player_stats', COUNT(*)::int FROM player_stats
    UNION ALL SELECT 'player_transfers', COUNT(*)::int FROM player_transfers
    UNION ALL SELECT 'player_honours', COUNT(*)::int FROM player_honours
    UNION ALL SELECT 'player_career', COUNT(*)::int FROM player_career
  `);
  console.log('=== TABLE COUNTS ===');
  console.table(counts);

  const seasons = await db.execute(sql`
    SELECT season, COUNT(*)::int AS stat_rows, COUNT(DISTINCT player_id)::int AS players
    FROM player_stats GROUP BY season ORDER BY season
  `);
  console.log('\n=== STATS BY SEASON ===');
  console.table(seasons);

  const byLeague = await db.execute(sql`
    SELECT league_name, MIN(season)::int AS min_season, MAX(season)::int AS max_season,
           COUNT(*)::int AS rows, COUNT(DISTINCT player_id)::int AS players
    FROM player_stats GROUP BY league_name ORDER BY league_name
  `);
  console.log('\n=== STATS BY LEAGUE (range) ===');
  console.table(byLeague);

  const missing = await db.execute(sql`
    WITH expected AS (
      SELECT generate_series(2010, 2025) AS season
    ),
    have AS (
      SELECT DISTINCT season FROM player_stats
    )
    SELECT e.season,
           CASE WHEN h.season IS NULL THEN 'MISSING' ELSE 'ok' END AS status,
           COALESCE((
             SELECT COUNT(*)::int FROM player_stats ps WHERE ps.season = e.season
           ), 0) AS stat_rows
    FROM expected e
    LEFT JOIN have h ON h.season = e.season
    ORDER BY e.season
  `);
  console.log('\n=== SEASON COVERAGE 2010–2025 (top 5 leagues combined) ===');
  console.table(missing);

  const ingestRuns = await db.execute(sql`
    SELECT job_name, status, rows_upserted, started_at::text AS started
    FROM ingest_runs ORDER BY started_at DESC LIMIT 8
  `);
  console.log('\n=== RECENT INGEST RUNS ===');
  console.table(ingestRuns);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
