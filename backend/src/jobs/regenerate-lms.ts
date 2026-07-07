/**
 * Force-regenerate Last Man Standing for a date (deletes any stored row first).
 *
 *   DATABASE_URL=... npx tsx src/jobs/regenerate-lms.ts [YYYY-MM-DD]
 *
 * Run on Railway after deploying typed builders — composition can take several minutes and
 * should not block the /daily/today HTTP handler.
 */
import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { dailyPuzzles } from '../db/schema.js';
import { generateLastManStandingPuzzle } from '../services/lastManStandingGenerator.js';

const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);

async function main() {
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
