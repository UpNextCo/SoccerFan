/**
 * Compute awards we can derive directly from our own data (no scrape) into player_awards:
 *   - World Cup Golden Boot: the top scorer(s) of each World Cup (league_id=1).
 * (Ties share the boot — close enough for our purposes; the official tiebreak is assists.)
 *
 * Pure DB. Idempotent. Usage: DATABASE_URL=... npm run job:compute-data-awards
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS player_awards (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      player_id uuid REFERENCES players(id) ON DELETE CASCADE,
      player_name text NOT NULL, award text NOT NULL, year integer NOT NULL,
      placement text NOT NULL DEFAULT 'winner',
      created_at timestamp with time zone DEFAULT now() NOT NULL
    )`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS player_awards_unique ON player_awards (award, year, player_name, placement)`);

  await db.execute(sql`DELETE FROM player_awards WHERE award = 'World Cup Golden Boot'`);
  await db.execute(sql`
    WITH wc AS (
      SELECT s.player_id, s.season, SUM(s.goals) AS g
      FROM player_stats s WHERE s.league_id = 1 GROUP BY s.player_id, s.season
    ), mx AS (
      SELECT season, MAX(g) AS mg FROM wc WHERE g > 0 GROUP BY season
    )
    INSERT INTO player_awards (player_id, player_name, award, year, placement)
    SELECT wc.player_id, p.name, 'World Cup Golden Boot', wc.season, 'winner'
    FROM wc JOIN mx ON wc.season = mx.season AND wc.g = mx.mg JOIN players p ON p.id = wc.player_id
    ON CONFLICT (award, year, player_name, placement) DO UPDATE SET player_id = EXCLUDED.player_id
  `);

  const rows = (await db.execute(sql`
    SELECT year, string_agg(player_name, ', ') AS winners
    FROM player_awards WHERE award = 'World Cup Golden Boot' GROUP BY year ORDER BY year
  `)) as unknown as Array<{ year: number; winners: string }>;
  console.log('World Cup Golden Boot (top scorer per tournament):');
  for (const r of rows) console.log(`  ${r.year}: ${r.winners}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
