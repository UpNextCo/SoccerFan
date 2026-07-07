/**
 * Apply curated position overrides + tier-4+ backfill entries to players.sub_positions.
 *
 * Usage: DATABASE_URL=... npm run job:apply-position-overrides
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { POSITION_OVERRIDES } from '../constants/positionOverrides.js';
import { POSITION_BACKFILL } from '../constants/positionBackfill.js';
import { applyPositionEntry, toApplyEntry } from '../services/applyPlayerPositions.js';

async function main() {
  await db.execute(sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS sub_positions text[] DEFAULT '{}'::text[] NOT NULL`);
  await db.execute(sql`
    UPDATE players
    SET sub_positions = ARRAY[sub_position]
    WHERE sub_position IS NOT NULL AND sub_position <> ''
      AND (sub_positions IS NULL OR sub_positions = '{}'::text[])
  `);

  let updated = 0;
  let missing = 0;
  let ambiguous = 0;

  const entries = [
    ...POSITION_OVERRIDES.map(([name, nationality, positions]) => ({ name, nationality, positions })),
    ...POSITION_BACKFILL.map(toApplyEntry),
  ];

  for (const entry of entries) {
    const result = await applyPositionEntry(entry);
    if (result === 'updated') updated += 1;
    else if (result === 'missing') {
      missing += 1;
      console.warn(`Skip (not found): ${entry.name} (${entry.nationality})`);
    } else if (result === 'ambiguous') {
      ambiguous += 1;
      console.warn(`Skip (ambiguous): ${entry.name} (${entry.nationality})`);
    }
  }

  console.log(
    `Applied positions to ${updated}/${entries.length} entries (${missing} not found, ${ambiguous} ambiguous).`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
