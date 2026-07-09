/**
 * Force-regenerate Draft XI for a date (deletes any stored row first).
 * Skips locked (and approved unless --force) rows.
 *
 *   DATABASE_URL=... npx tsx src/jobs/regenerate-draft.ts [YYYY-MM-DD] [--force]
 */
import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { dailyPuzzles } from '../db/schema.js';
import { generateBattlePuzzle } from '../services/battleGenerator.js';
import { contentHash } from '../services/puzzleOps.js';

const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const force = process.argv.includes('--force');

async function main() {
  const existing = await db
    .select({ status: dailyPuzzles.status })
    .from(dailyPuzzles)
    .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, 'draft_master')))
    .limit(1);
  const status = existing[0]?.status;
  if (status === 'locked') {
    console.error(`Refusing to regenerate locked draft_master for ${date}`);
    process.exit(1);
  }
  if (status === 'approved' && !force) {
    console.error(`Refusing to regenerate approved draft_master for ${date} (pass --force)`);
    process.exit(1);
  }

  await db
    .delete(dailyPuzzles)
    .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, 'draft_master')));

  console.log(`Generating draft_master for ${date}…`);
  const puzzle = await generateBattlePuzzle(date);
  if (!puzzle) throw new Error('No viable draft puzzle');

  await db.insert(dailyPuzzles).values({
    date,
    modeId: 'draft_master',
    puzzleJson: puzzle,
    answerPlayerId: null,
    answerJson: null,
    status: 'generated',
    contentHash: contentHash(puzzle, null),
  });

  console.log(`Done — ${puzzle.category.title} (optimal ${puzzle.optimalScore})`);
  for (const pick of puzzle.optimalLineup) {
    console.log(`  ${pick.position.padEnd(20)} ${pick.constraintLabel.padEnd(28)} ${pick.playerName} (${pick.statValue})`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
