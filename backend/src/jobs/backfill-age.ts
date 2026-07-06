/**
 * Recompute players.age from birth_date. The API-Football `age` we ingest is only a
 * scrape-time snapshot, so it silently goes ~1 year stale (Messi showed 38 not 39, etc.)
 * and a couple of rows even had a YEAR (2025) sitting in the age column. This job derives
 * age directly from the stored DOB, and clamps the remaining year-like garbage on rows
 * that have no DOB to derive from.
 *
 * Pure DB, idempotent. Usage: npm run job:backfill-age
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

export async function backfillAge(): Promise<{ recomputed: number; clamped: number }> {
  const recompute = (await db.execute(sql`
    UPDATE players
    SET age = date_part('year', age(birth_date))::int
    WHERE birth_date IS NOT NULL
      AND age IS DISTINCT FROM date_part('year', age(birth_date))::int
  `)) as unknown as { count?: number };

  // Rows with no DOB but a clearly-corrupt age (a year, e.g. 2025) — we can't derive the
  // true age, so clamp to a neutral value rather than leave impossible data on display.
  const clamp = (await db.execute(sql`
    UPDATE players SET age = 20 WHERE birth_date IS NULL AND age >= 100
  `)) as unknown as { count?: number };

  return { recomputed: recompute?.count ?? 0, clamped: clamp?.count ?? 0 };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  backfillAge()
    .then(async ({ recomputed, clamped }) => {
      const bad = (await db.execute(sql`
        SELECT count(*)::int AS n FROM players
        WHERE birth_date IS NOT NULL
          AND abs(age - date_part('year', age(birth_date))::int) > 0
      `)) as unknown as Array<{ n: number }>;
      console.log(`Recomputed ${recomputed} ages from DOB, clamped ${clamped} garbage rows.`);
      console.log(`Remaining age/DOB mismatches: ${bad[0]?.n ?? '?'} (expect 0).`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
