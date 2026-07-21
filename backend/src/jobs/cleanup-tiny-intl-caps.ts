/**
 * DEPRECATED — do not run against production after Wikipedia senior-caps backfill.
 *
 * Historically this zeroed intl_caps in 1–29 because Transfermarkt often stored
 * World Cup / tournament scraps there. Wikipedia nation-list / infobox jobs now
 * write real senior totals in that range (e.g. Quagliarella 28, Giuly 17), and
 * scoring trusts 1–280 via INTL_CAPS_DISPLAY_MIN.
 *
 * TM ingest still refuses values below INTL_CAPS_TRUST_MIN (30).
 *
 * Usage (report only): DATABASE_URL=... npx tsx src/jobs/cleanup-tiny-intl-caps.ts
 * Destructive wipe requires: --force-wipe (almost never what you want)
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { INTL_CAPS_TRUST_MIN } from '../services/statMetrics.js';

async function main() {
  const forceWipe = process.argv.includes('--force-wipe');

  const before = (await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM player_extra_stats
    WHERE intl_caps > 0 AND intl_caps < ${INTL_CAPS_TRUST_MIN}
  `)) as unknown as Array<{ n: number }>;
  console.log(`Rows with caps in 1–${INTL_CAPS_TRUST_MIN - 1}: ${before[0]?.n ?? 0}`);

  const samples = (await db.execute(sql`
    SELECT p.name, e.intl_caps
    FROM player_extra_stats e
    JOIN players p ON p.id = e.player_id
    WHERE e.intl_caps > 0 AND e.intl_caps < ${INTL_CAPS_TRUST_MIN}
      AND p.market_value_tier >= 4
    ORDER BY e.intl_caps DESC, p.name
    LIMIT 20
  `)) as unknown as Array<{ name: string; intl_caps: number }>;
  for (const s of samples) console.log(`  ${s.name}: ${s.intl_caps}`);

  if (!forceWipe) {
    console.log('Report only. Wikipedia 1–29 caps are valid — pass --force-wipe to zero them (not recommended).');
    return;
  }

  await db.execute(sql`
    UPDATE player_extra_stats
    SET intl_caps = 0, updated_at = now()
    WHERE intl_caps > 0 AND intl_caps < ${INTL_CAPS_TRUST_MIN}
  `);
  console.log(`Force-wiped ${before[0]?.n ?? 0} rows.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
