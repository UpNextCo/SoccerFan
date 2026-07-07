/**
 * Apply curated position overrides (constants/positionOverrides.ts) to players.sub_positions.
 * Merges with any existing TM primary/alternates — never drops a valid stored position.
 *
 * Usage: DATABASE_URL=... npm run job:apply-position-overrides
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { POSITION_OVERRIDES } from '../constants/positionOverrides.js';
import { mergeSubPositions, primarySubPosition } from '../services/playerPositionService.js';

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

  for (const [name, nationality, positions] of POSITION_OVERRIDES) {
    const rows = (await db.execute(sql`
      SELECT id, sub_position, sub_positions
      FROM players
      WHERE name = ${name} AND nationality = ${nationality}
      LIMIT 2
    `)) as unknown as Array<{ id: string; sub_position: string | null; sub_positions: string[] | null }>;

    if (rows.length !== 1) {
      missing += 1;
      console.warn(`Skip (0 or ambiguous): ${name} (${nationality}) — ${rows.length} matches`);
      continue;
    }

    const row = rows[0]!;
    const merged = mergeSubPositions(row.sub_position, row.sub_positions, positions);
    if (merged.length === 0) {
      console.warn(`Skip (no valid positions): ${name}`);
      continue;
    }

    const primary = row.sub_position && merged.includes(row.sub_position) ? row.sub_position : primarySubPosition(merged);
    await db.execute(sql`
      UPDATE players
      SET sub_position = ${primary},
          sub_positions = ${merged}::text[]
      WHERE id = ${row.id}::uuid
    `);
    updated += 1;
  }

  console.log(`Applied position overrides to ${updated}/${POSITION_OVERRIDES.length} players (${missing} missing/ambiguous).`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
