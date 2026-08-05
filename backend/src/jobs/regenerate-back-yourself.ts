/**
 * Force-regenerate Back Yourself for a date.
 * Skips locked (and approved unless --force) rows.
 *
 *   DATABASE_URL=... npx tsx src/jobs/regenerate-back-yourself.ts [YYYY-MM-DD] [--force]
 */
import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { dailyPuzzles } from '../db/schema.js';
import {
  clearBackYourselfCandidateCache,
  generateBackYourselfPuzzle,
} from '../services/backYourselfGenerator.js';
import { contentHash } from '../services/puzzleOps.js';

async function main() {
  const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);
  const force = process.argv.includes('--force');
  clearBackYourselfCandidateCache();

  const existing = await db
    .select()
    .from(dailyPuzzles)
    .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, 'back_yourself')))
    .limit(1);

  const status = existing[0]?.status;
  if (status === 'locked') {
    console.error(`Refusing to regenerate locked back_yourself for ${date}`);
    process.exit(1);
  }
  if (status === 'approved' && !force) {
    console.error(`Refusing to regenerate approved back_yourself for ${date} (pass --force)`);
    process.exit(1);
  }

  if (existing[0]) {
    await db
      .delete(dailyPuzzles)
      .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, 'back_yourself')));
    console.log(`Deleted existing back_yourself puzzle for ${date}`);
  }

  const result = await generateBackYourselfPuzzle(date);
  if (!result) throw new Error('No viable Back Yourself puzzle');

  await db.insert(dailyPuzzles).values({
    date,
    modeId: 'back_yourself',
    puzzleJson: result.puzzle,
    answerPlayerId: null,
    answerJson: result.answer,
    status: 'generated',
    contentHash: contentHash(result.puzzle, result.answer),
  });

  console.log(
    JSON.stringify(
      {
        date,
        category: result.puzzle.category.label,
        type: result.puzzle.category.type,
        maxPool: result.puzzle.maxPool,
        xpCap: result.puzzle.xpCap,
        validCount: result.answer.validPlayerIds.length,
      },
      null,
      2
    )
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
