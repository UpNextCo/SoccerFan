/**
 * Derive players.market_value_tier (1–5, 5 = elite) from career output, ranked
 * WITHIN each position so keepers/defenders get a fair spread. Pure DB — ZERO API.
 *
 * Idempotent: recomputes from current player_stats every run. Safe to re-run after
 * more stats land. Higher tier = more valuable (matches seed + search ranking).
 *
 * Usage: DATABASE_URL=... npm run job:market-value
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

async function main() {
  console.log('Computing market value tiers from career stats (per position)...');

  // Composite career score per player, position-aware, then percentile-rank within
  // position into a 1–5 pyramid (top 5% → 5, next 15% → 4, mid 30% → 3, …).
  const result = await db.execute(sql`
    WITH career AS (
      SELECT
        p.id,
        p.position,
        COALESCE(SUM(s.goals), 0)        AS goals,
        COALESCE(SUM(s.assists), 0)      AS assists,
        COALESCE(SUM(s.appearances), 0)  AS apps,
        COALESCE(SUM(s.minutes), 0)      AS minutes,
        COALESCE(SUM(s.clean_sheets), 0) AS clean_sheets,
        COALESCE(SUM(s.saves), 0)        AS saves
      FROM players p
      LEFT JOIN player_stats s ON s.player_id = p.id
      GROUP BY p.id, p.position
    ),
    scored AS (
      SELECT
        id,
        position,
        CASE position
          WHEN 'Goalkeeper' THEN apps * 0.6 + clean_sheets * 1.0 + saves * 0.05 + minutes * 0.003
          WHEN 'Defender'   THEN goals * 2 + assists * 2 + apps * 0.5 + clean_sheets * 0.5 + minutes * 0.003
          ELSE                   goals * 4 + assists * 3 + apps * 0.3 + minutes * 0.002
        END AS score
      FROM career
    ),
    ranked AS (
      SELECT id, percent_rank() OVER (PARTITION BY position ORDER BY score) AS pr
      FROM scored
    )
    UPDATE players p
    SET market_value_tier = CASE
      WHEN r.pr >= 0.95 THEN 5
      WHEN r.pr >= 0.80 THEN 4
      WHEN r.pr >= 0.50 THEN 3
      WHEN r.pr >= 0.20 THEN 2
      ELSE 1
    END
    FROM ranked r
    WHERE p.id = r.id
    RETURNING p.id
  `);

  console.log(`Updated market_value_tier for ${result.length} players.`);

  const dist = await db.execute(sql`
    SELECT position, market_value_tier AS tier, COUNT(*)::int AS players
    FROM players
    GROUP BY position, market_value_tier
    ORDER BY position, market_value_tier DESC
  `);
  console.log('\n=== TIER DISTRIBUTION (by position) ===');
  console.table(dist);

  const sample = await db.execute(sql`
    SELECT name, position, current_club, market_value_tier AS tier
    FROM players
    WHERE market_value_tier = 5 AND external_id IS NOT NULL
    ORDER BY name LIMIT 15
  `);
  console.log('\n=== SAMPLE TIER-5 (elite) PLAYERS ===');
  console.table(sample);

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
