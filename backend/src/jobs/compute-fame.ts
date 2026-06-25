/**
 * Final fame tier (players.market_value_tier, 1–5) = the GREATER of:
 *   • the era-normalised market-value tier set by import-transfermarkt (real €, inflation
 *     cancelled by era), for players Transfermarkt covers; and
 *   • an ACHIEVEMENT tier from era-agnostic prestige — Champions League / World Cup / Euro
 *     finals, major individual awards, and Champions League appearances.
 *
 * Why the max: it rescues two groups the raw value misses —
 *   • pre-2005 legends absent from the TM dump (Figo, Seedorf, Maldini…), and
 *   • players whose TM value is post-prime/deflated (Rivaldo: Ballon d'Or but a late,
 *     low TM value) — their achievements lift them to where they belong.
 *
 * This replaces the old appearance-only compute-market-value workaround entirely.
 * Pure DB. Usage: DATABASE_URL=... npx tsx src/jobs/compute-fame.ts
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

async function main() {
  console.log('Computing fame tiers (era-normalised value ⊔ achievements)...');

  const res = await db.execute(sql`
    WITH     ach AS (
      SELECT p.id,
        (SELECT COUNT(*) FROM final_appearances f WHERE f.player_id = p.id)::int AS finals,
        (SELECT COUNT(*) FROM player_awards a WHERE a.player_id = p.id)::int AS awards,
        COALESCE(SUM(s.appearances) FILTER (WHERE s.league_id = 2), 0)::int AS ucl
      FROM players p LEFT JOIN player_stats s ON s.player_id = p.id
      GROUP BY p.id
    ),
    scored AS (
      -- Clean era-agnostic prestige signals only: major finals, individual awards, and
      -- Champions League appearances. (player_honours trophy-count is too noisy — a squad
      -- player at a big club racks up many domestic titles without being a star.)
      SELECT id, (finals * 3 + awards * 4 + ucl * 0.08) AS score FROM ach
    ),
    tiered AS (
      SELECT id, CASE
        WHEN score >= 12 THEN 5
        WHEN score >= 6 THEN 4
        WHEN score >= 2.5 THEN 3
        WHEN score >= 0.8 THEN 2
        ELSE 1
      END AS ach_tier FROM scored
    )
    UPDATE players p SET market_value_tier = CASE
      WHEN p.peak_market_value_eur IS NULL THEN t.ach_tier
      ELSE GREATEST(p.market_value_tier, t.ach_tier)
    END
    FROM tiered t WHERE p.id = t.id
    RETURNING p.id
  `);
  console.log(`Set fame tier for ${res.length} players.`);

  const dist = await db.execute(sql`
    SELECT market_value_tier AS tier, COUNT(*)::int AS players,
      COUNT(peak_market_value_eur)::int AS with_value
    FROM players GROUP BY market_value_tier ORDER BY market_value_tier DESC
  `);
  console.log('\n=== FAME TIER DISTRIBUTION ===');
  console.table(dist);

  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
