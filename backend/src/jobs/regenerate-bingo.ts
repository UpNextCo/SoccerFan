/**
 * Safely regenerate Football Bingo. Generation and solvability checks complete before the
 * existing row is replaced. Locked rows are never changed; approved rows require --force.
 *
 *   npm run job:regenerate-bingo -- YYYY-MM-DD [--force]
 */
import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { dailyPuzzles } from '../db/schema.js';
import {
  generateFootballBingoPuzzle,
  isBingoSolvable,
} from '../services/footballBingoGenerator.js';
import { contentHash } from '../services/puzzleOps.js';

const date = process.argv[2];
const force = process.argv.includes('--force');

function validDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

async function main() {
  if (!validDate(date)) throw new Error('Usage: regenerate-bingo YYYY-MM-DD [--force]');

  const existing = await db
    .select({ id: dailyPuzzles.id, status: dailyPuzzles.status })
    .from(dailyPuzzles)
    .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, 'football_bingo')))
    .limit(1);
  const current = existing[0];
  if (current?.status === 'locked') {
    throw new Error(`Refusing to regenerate locked football_bingo for ${date}`);
  }
  if (current?.status === 'approved' && !force) {
    throw new Error(`Refusing to regenerate approved football_bingo for ${date} (pass --force)`);
  }

  console.log(`Generating football_bingo for ${date} before changing persisted data…`);
  const puzzle = await generateFootballBingoPuzzle(date);
  const solvability = isBingoSolvable(puzzle);
  if (!solvability.ok) throw new Error(`Generated football_bingo for ${date} is not solvable`);

  const values = {
    puzzleJson: puzzle,
    answerPlayerId: null,
    answerJson: null,
    status: 'generated',
    contentHash: contentHash(puzzle, null),
    reviewedAt: null,
  } as const;

  if (current) {
    const updated = await db
      .update(dailyPuzzles)
      .set(values)
      .where(
        and(
          eq(dailyPuzzles.id, current.id),
          eq(dailyPuzzles.status, current.status)
        )
      )
      .returning({ id: dailyPuzzles.id });
    if (updated.length === 0) {
      throw new Error('Row status changed during generation; existing football_bingo was preserved');
    }
  } else {
    const inserted = await db
      .insert(dailyPuzzles)
      .values({ date, modeId: 'football_bingo', ...values })
      .onConflictDoNothing()
      .returning({ id: dailyPuzzles.id });
    if (inserted.length === 0) {
      throw new Error('A football_bingo row appeared during generation; it was preserved');
    }
  }

  console.log(
    `Done — ${puzzle.categories.length} tiles, ${puzzle.players.length} queued players, ` +
      `fair=${solvability.fair ? 'YES' : 'NO'}`
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
