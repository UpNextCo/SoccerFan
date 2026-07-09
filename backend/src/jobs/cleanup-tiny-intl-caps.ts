/**
 * Zero out garbage international caps that are almost certainly World Cup / tournament scraps
 * rather than career totals (Lampard=10, Beckham=9, Gerrard=5). Values in 1–29 are treated as
 * missing so Draft XI / Target Man / LMS don't score them as real caps.
 *
 * Safe Wikipedia 100+ / TM career totals (≥30) are left alone.
 *
 * Usage: DATABASE_URL=... npx tsx src/jobs/cleanup-tiny-intl-caps.ts [--dry]
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { INTL_CAPS_TRUST_MIN } from '../services/statMetrics.js';

async function main() {
  const dry = process.argv.includes('--dry');

  const before = (await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM player_extra_stats
    WHERE intl_caps > 0 AND intl_caps < ${INTL_CAPS_TRUST_MIN}
  `)) as unknown as Array<{ n: number }>;
  console.log(`Rows with tiny caps (1–${INTL_CAPS_TRUST_MIN - 1}): ${before[0]?.n ?? 0}`);

  const samples = (await db.execute(sql`
    SELECT p.name, e.intl_caps
    FROM player_extra_stats e
    JOIN players p ON p.id = e.player_id
    WHERE e.intl_caps > 0 AND e.intl_caps < ${INTL_CAPS_TRUST_MIN}
      AND p.market_value_tier >= 4
    ORDER BY e.intl_caps ASC, p.name
    LIMIT 20
  `)) as unknown as Array<{ name: string; intl_caps: number }>;
  for (const s of samples) console.log(`  ${s.name}: ${s.intl_caps}`);

  if (dry) {
    console.log('--dry: no writes');
    return;
  }

  await db.execute(sql`
    UPDATE player_extra_stats
    SET intl_caps = 0, updated_at = now()
    WHERE intl_caps > 0 AND intl_caps < ${INTL_CAPS_TRUST_MIN}
  `);
  const after = (await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM player_extra_stats
    WHERE intl_caps > 0 AND intl_caps < ${INTL_CAPS_TRUST_MIN}
  `)) as unknown as Array<{ n: number }>;
  console.log(`Done. Remaining tiny-cap rows: ${after[0]?.n ?? 0} (was ${before[0]?.n ?? 0})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
