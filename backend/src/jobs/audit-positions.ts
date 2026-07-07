/**
 * Audit fine-position coverage for Draft XI / World Cup XI.
 *
 * Usage: DATABASE_URL=... npm run job:audit-positions
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { VALID_SUB_POSITIONS } from '../services/playerPositionService.js';

const DRAFT_SLOTS = [
  'Goalkeeper', 'Left-Back', 'Centre-Back', 'Right-Back', 'Defensive Midfield',
  'Central Midfield', 'Attacking Midfield', 'Left Winger', 'Centre-Forward', 'Right Winger',
];

async function main() {
  await db.execute(sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS sub_positions text[] DEFAULT '{}'::text[] NOT NULL`);

  const summary = (await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE external_id IS NOT NULL)::int AS with_external,
      COUNT(*) FILTER (
        WHERE market_value_tier >= 4
          AND cardinality(array_remove(array_cat(ARRAY[sub_position], COALESCE(sub_positions, ARRAY[]::text[])), NULL)) = 0
      )::int AS famous_no_fine,
      COUNT(*) FILTER (
        WHERE market_value_tier >= 5
          AND cardinality(array_remove(array_cat(ARRAY[sub_position], COALESCE(sub_positions, ARRAY[]::text[])), NULL)) = 0
      )::int AS elite_no_fine
    FROM players
  `)) as unknown as Array<{ with_external: number; famous_no_fine: number; elite_no_fine: number }>;

  console.log('\n── POSITION COVERAGE ──');
  console.log(`Famous (tier 4+) with no fine position: ${summary[0]!.famous_no_fine}`);
  console.log(`Elite (tier 5) with no fine position:   ${summary[0]!.elite_no_fine}`);

  const missingElite = (await db.execute(sql`
    SELECT name, nationality, position
    FROM players
    WHERE market_value_tier >= 5
      AND cardinality(array_remove(array_cat(ARRAY[sub_position], COALESCE(sub_positions, ARRAY[]::text[])), NULL)) = 0
    ORDER BY name
    LIMIT 30
  `)) as unknown as Array<{ name: string; nationality: string; position: string }>;

  if (missingElite.length > 0) {
    console.log('\nSample elite players still missing fine positions:');
    for (const p of missingElite) console.log(`  ${p.name} (${p.nationality}) — ${p.position}`);
  }

  console.log('\n── DRAFT XI SEARCH POOL (tier 4+, per slot) ──');
  for (const slot of DRAFT_SLOTS) {
    const rows = (await db.execute(sql`
      SELECT COUNT(*)::int AS n
      FROM players p
      WHERE p.market_value_tier >= 4
        AND ${slot} = ANY(
          array_remove(array_cat(ARRAY[p.sub_position], COALESCE(p.sub_positions, ARRAY[]::text[])), NULL)
        )
    `)) as unknown as Array<{ n: number }>;
    console.log(`  ${slot.padEnd(22)} ${rows[0]!.n}`);
  }

  const checks = [
    ['Cristiano Ronaldo', 'Portugal', 'Right Winger'],
    ['Cristiano Ronaldo', 'Portugal', 'Centre-Forward'],
    ['Paolo Maldini', 'Italy', 'Centre-Back'],
  ] as const;

  console.log('\n── SPOT CHECKS ──');
  for (const [name, nationality, slot] of checks) {
    const rows = (await db.execute(sql`
      SELECT ${slot} = ANY(
        array_remove(array_cat(ARRAY[p.sub_position], COALESCE(p.sub_positions, ARRAY[]::text[])), NULL)
      ) AS ok
      FROM players p
      WHERE p.name = ${name} AND p.nationality = ${nationality}
      LIMIT 1
    `)) as unknown as Array<{ ok: boolean }>;
    console.log(`  ${name} @ ${slot}: ${rows[0]?.ok ? 'OK' : 'MISSING'}`);
  }

  console.log(`\nValid fine positions: ${VALID_SUB_POSITIONS.join(', ')}`);
  process.exit(summary[0]!.elite_no_fine === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
