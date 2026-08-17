/**
 * Pre-generate all playable daily modes for each date in [from, to] (inclusive).
 *
 * Usage:
 *   npx tsx scripts/generate-date-range.ts 2026-08-03 2026-08-31
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { getDailyPuzzle } from '../src/services/dailyService.js';

const PLAYABLE = [
  'football_bingo',
  'one_more',
  'draft_master',
  'football_golf',
  'club_chain',
  'target_man',
  'last_man_standing',
  'back_yourself',
  'darts_501',
] as const;

function datesInclusive(from: string, to: string): string[] {
  const out: string[] = [];
  const cur = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(cur.getTime()) || Number.isNaN(end.getTime()) || cur > end) {
    throw new Error(`Bad range: ${from} → ${to}`);
  }
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

async function modesFor(date: string): Promise<string[]> {
  const rows = (await db.execute(sql`
    SELECT mode_id FROM daily_puzzles WHERE date = ${date}::date
  `)) as unknown as Array<{ mode_id: string }>;
  return rows.map((r) => r.mode_id);
}

async function main() {
  const from = process.argv[2];
  const to = process.argv[3];
  if (!from || !to) {
    console.error('Usage: npx tsx scripts/generate-date-range.ts YYYY-MM-DD YYYY-MM-DD');
    process.exit(1);
  }

  const dates = datesInclusive(from, to);
  console.log(`Generating ${dates.length} days: ${from} → ${to}`);

  for (const date of dates) {
    const before = new Set(await modesFor(date));
    const missingBefore = PLAYABLE.filter((m) => !before.has(m));
    console.log(`\n=== ${date} (have ${before.size}/${PLAYABLE.length}, missing: ${missingBefore.join(', ') || 'none'}) ===`);
    const started = Date.now();
    try {
      // Triggers ensureDailyPuzzles for every playable mode.
      await getDailyPuzzle(date, 'target_man');
    } catch (err) {
      console.error(`  FAILED ${date}:`, err instanceof Error ? err.message : err);
    }
    const after = new Set(await modesFor(date));
    const stillMissing = PLAYABLE.filter((m) => !after.has(m));
    const added = PLAYABLE.filter((m) => !before.has(m) && after.has(m));
    console.log(
      `  done in ${((Date.now() - started) / 1000).toFixed(1)}s — added [${added.join(', ') || '—'}]`
      + (stillMissing.length ? ` — STILL MISSING: ${stillMissing.join(', ')}` : ' — complete')
    );
  }

  console.log('\n=== Summary ===');
  const summary = (await db.execute(sql`
    SELECT date::text AS date, count(DISTINCT mode_id)::int AS modes
    FROM daily_puzzles
    WHERE date BETWEEN ${from}::date AND ${to}::date
    GROUP BY date
    ORDER BY date
  `)) as unknown as Array<{ date: string; modes: number }>;
  for (const row of summary) {
    console.log(`  ${row.date}: ${row.modes}/7`);
  }
  const incomplete = summary.filter((r) => r.modes < 7);
  if (incomplete.length) {
    console.log(`\nIncomplete days: ${incomplete.map((r) => r.date).join(', ')}`);
    process.exit(2);
  }
  console.log('\nAll days complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
