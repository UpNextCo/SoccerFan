/**
 * Regenerate every stored Draft XI puzzle whose category is most_clubs (and today's
 * draft regardless), so club counts pick up career backfills + the hardened metric.
 *
 * Skips locked rows. Pass --force to also replace approved puzzles.
 *
 *   DATABASE_URL=... npm run job:regenerate-draft-most-clubs
 *   DATABASE_URL=... npm run job:regenerate-draft-most-clubs -- --force
 */
import 'dotenv/config';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { dailyPuzzles } from '../db/schema.js';
import { generateBattlePuzzle } from '../services/battleGenerator.js';
import { contentHash } from '../services/puzzleOps.js';

const force = process.argv.includes('--force');
const today = new Date().toISOString().slice(0, 10);

async function regenerate(date: string): Promise<void> {
  const existing = await db
    .select({ status: dailyPuzzles.status })
    .from(dailyPuzzles)
    .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, 'draft_master')))
    .limit(1);
  const status = existing[0]?.status;
  if (status === 'locked') {
    console.log(`  skip ${date}: locked`);
    return;
  }
  if (status === 'approved' && !force) {
    console.log(`  skip ${date}: approved (pass --force)`);
    return;
  }

  await db
    .delete(dailyPuzzles)
    .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, 'draft_master')));

  const puzzle = await generateBattlePuzzle(date);
  if (!puzzle) {
    console.log(`  skip ${date}: no viable puzzle`);
    return;
  }

  await db.insert(dailyPuzzles).values({
    date,
    modeId: 'draft_master',
    puzzleJson: puzzle,
    answerPlayerId: null,
    answerJson: null,
    status: 'generated',
    contentHash: contentHash(puzzle, null),
  });
  console.log(`  ${date}: ${puzzle.category.title} (optimal ${puzzle.optimalScore})`);
}

async function main() {
  const rows = (await db.execute(sql`
    SELECT date::text AS date
    FROM daily_puzzles
    WHERE mode_id = 'draft_master'
      AND puzzle_json->'category'->>'id' = 'most_clubs'
    ORDER BY date
  `)) as unknown as Array<{ date: string }>;

  const dates = new Set(rows.map((r) => r.date));
  dates.add(today);

  console.log(`Regenerating ${dates.size} draft_master date(s)…`);
  for (const date of [...dates].sort()) {
    await regenerate(date);
  }
  console.log('Done');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
