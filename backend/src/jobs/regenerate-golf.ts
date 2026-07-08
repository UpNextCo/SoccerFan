/**
 * Force-regenerate Football Golf for a date (deletes any stored row first).
 *
 *   DATABASE_URL=... npx tsx src/jobs/regenerate-golf.ts [YYYY-MM-DD]
 */
import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { dailyPuzzles } from '../db/schema.js';
import { generateFootballGolfCourse } from '../services/footballGolfGenerator.js';

const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);

async function main() {
  await db
    .delete(dailyPuzzles)
    .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, 'football_golf')));

  console.log(`Generating football_golf for ${date}…`);
  const puzzle = await generateFootballGolfCourse(date);
  if (puzzle.holes.length < 9) {
    throw new Error(`Only ${puzzle.holes.length} holes generated (need 9)`);
  }

  await db.insert(dailyPuzzles).values({
    date,
    modeId: 'football_golf',
    puzzleJson: puzzle,
    answerPlayerId: null,
    answerJson: null,
  });

  console.log(`Done — Par ${puzzle.totalPar}, ${puzzle.holes.length} holes`);
  for (const h of puzzle.holes) {
    const byR = (r: string) => h.answers.filter((a) => a.rarity === r).length;
    console.log(`  H${h.holeNumber} par ${h.par} target ${h.target} · ${h.prompt.slice(0, 50)}… (C${byR('common')}/U${byR('uncommon')}/R${byR('rare')}/UR${byR('ultraRare')})`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
