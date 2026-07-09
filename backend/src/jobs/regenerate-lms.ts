/**
 * Force-regenerate Last Man Standing for a date (deletes any stored row first).
 * Skips locked (and approved unless --force) rows.
 *
 *   DATABASE_URL=... npx tsx src/jobs/regenerate-lms.ts [YYYY-MM-DD] [--force]
 */
import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { dailyPuzzles } from '../db/schema.js';
import { generateLastManStandingPuzzle } from '../services/lastManStandingGenerator.js';
import { contentHash } from '../services/puzzleOps.js';

const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const force = process.argv.includes('--force');

async function main() {
  const existing = await db
    .select({ status: dailyPuzzles.status })
    .from(dailyPuzzles)
    .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, 'last_man_standing')))
    .limit(1);
  const status = existing[0]?.status;
  if (status === 'locked') {
    console.error(`Refusing to regenerate locked last_man_standing for ${date}`);
    process.exit(1);
  }
  if (status === 'approved' && !force) {
    console.error(`Refusing to regenerate approved last_man_standing for ${date} (pass --force)`);
    process.exit(1);
  }

  await db
    .delete(dailyPuzzles)
    .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, 'last_man_standing')));

  console.log(`Generating last_man_standing for ${date}…`);
  const { puzzle, answer } = await generateLastManStandingPuzzle(date);
  await db.insert(dailyPuzzles).values({
    date,
    modeId: 'last_man_standing',
    puzzleJson: puzzle,
    answerPlayerId: null,
    answerJson: answer,
    status: 'generated',
    contentHash: contentHash(puzzle, answer),
  });

  console.log(`Done — ${puzzle.questions.length} questions (v${puzzle.version})`);
  for (const q of puzzle.questions) {
    console.log(`  Q${q.slot} ${q.type}: ${q.prompt.slice(0, 60)}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
