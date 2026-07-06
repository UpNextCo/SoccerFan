/**
 * Repair players whose current_league is a TOURNAMENT (World Cup, Euro, Copa America, Africa
 * Cup of Nations, Champions League, Europa League) rather than a real club competition. This
 * happened because current_club/current_league were derived from whatever the most recent
 * player_stats row was — including national-team tournament rows — so Guess Who could show a
 * clue like "current league: World Cup".
 *
 * Fix: for those players, reassign current_club/current_league to their most recent CLUB-league
 * season (highest season, tie-broken by appearances). Players with no club-league row are left
 * untouched (they're filtered out of the games' famous pools anyway).
 *
 * Pure DB, idempotent. Usage: npm run job:fix-current-league
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

// Domestic club competitions we ingest stats for (everything except the national-team /
// continental-cup tournament league ids 1,2,3,4,6,9).
const CLUB_LEAGUE_IDS = [39, 40, 61, 78, 88, 94, 135, 140, 203, 307];
const TOURNAMENT_LEAGUES = [
  'World Cup', 'Euro', 'Copa America', 'Africa Cup of Nations',
  'UEFA Champions League', 'Europa League', 'UEFA Europa League',
];

export async function fixCurrentLeague(): Promise<number> {
  const res = (await db.execute(sql`
    WITH best AS (
      SELECT DISTINCT ON (ps.player_id)
        ps.player_id, ps.team_name, ps.league_name
      FROM player_stats ps
      WHERE ps.league_id IN (${sql.join(CLUB_LEAGUE_IDS.map((l) => sql`${l}`), sql`, `)})
        AND ps.team_name IS NOT NULL AND ps.team_name <> ''
      ORDER BY ps.player_id, ps.season DESC, ps.appearances DESC
    )
    UPDATE players p
    SET current_club = best.team_name, current_league = best.league_name
    FROM best
    WHERE p.id = best.player_id
      AND p.current_league IN (${sql.join(TOURNAMENT_LEAGUES.map((n) => sql`${n}`), sql`, `)})
  `)) as unknown as { count?: number };

  return res?.count ?? 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  fixCurrentLeague()
    .then(async (updated) => {
      const left = (await db.execute(sql`
        SELECT count(*)::int AS n FROM players
        WHERE current_league IN (${sql.join(TOURNAMENT_LEAGUES.map((n) => sql`${n}`), sql`, `)})
      `)) as unknown as Array<{ n: number }>;
      console.log(`Reassigned ${updated} players off a tournament "league".`);
      console.log(`Still on a tournament league (no club-league stats to fall back to): ${left[0]?.n ?? '?'}.`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
