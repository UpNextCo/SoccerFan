/**
 * Safely regenerate Football Golf for a date. Generation and validation finish
 * before the existing row is atomically replaced.
 * Skips locked (and approved unless --force) rows.
 *
 *   DATABASE_URL=... npx tsx src/jobs/regenerate-golf.ts [YYYY-MM-DD] [--force]
 */
import 'dotenv/config';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { dailyPuzzles } from '../db/schema.js';
import { generateFootballGolfCourse } from '../services/footballGolfGenerator.js';
import { FOOTBALL_GOLF_HOLE_COUNT } from '../services/footballGolfConstants.js';
import { contentHash } from '../services/puzzleOps.js';
import { validatePuzzlePayload } from '../services/adminPuzzleValidation.js';

const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const force = process.argv.includes('--force');

async function main() {
  const existing = await db
    .select({ status: dailyPuzzles.status })
    .from(dailyPuzzles)
    .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, 'football_golf')))
    .limit(1);
  const status = existing[0]?.status;
  if (status === 'locked') {
    console.error(`Refusing to regenerate locked football_golf for ${date}`);
    process.exit(1);
  }
  if (status === 'approved' && !force) {
    console.error(`Refusing to regenerate approved football_golf for ${date} (pass --force)`);
    process.exit(1);
  }

  console.log(`Generating football_golf for ${date}…`);
  const puzzle = await generateFootballGolfCourse(date);
  if (puzzle.holes.length !== FOOTBALL_GOLF_HOLE_COUNT) {
    throw new Error(
      `${puzzle.holes.length} holes generated (need exactly ${FOOTBALL_GOLF_HOLE_COUNT})`
    );
  }
  const validation = validatePuzzlePayload('football_golf', puzzle, null);
  if (!validation.ok) {
    throw new Error(`Generated football_golf failed validation: ${validation.error}`);
  }

  await db.transaction(async (tx) => {
    const current = await tx
      .select({
        id: dailyPuzzles.id,
        status: dailyPuzzles.status,
        contentHash: dailyPuzzles.contentHash,
      })
      .from(dailyPuzzles)
      .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, 'football_golf')))
      .limit(1);
    const currentStatus = current[0]?.status;
    if (currentStatus === 'locked') {
      throw new Error(`Refusing to replace locked football_golf for ${date}`);
    }
    if (currentStatus === 'approved' && !force) {
      throw new Error(`Refusing to replace approved football_golf for ${date} (pass --force)`);
    }

    const replacement = {
      puzzleJson: puzzle,
      answerPlayerId: null,
      answerJson: null,
      status: 'generated',
      contentHash: contentHash(puzzle, null),
      reviewedAt: null,
      reviewNote: null,
    };
    if (!current[0]) {
      await tx.insert(dailyPuzzles).values({
        date,
        modeId: 'football_golf',
        ...replacement,
      });
      return;
    }

    const replaced = await tx
      .update(dailyPuzzles)
      .set(replacement)
      .where(and(
        eq(dailyPuzzles.id, current[0].id),
        eq(dailyPuzzles.status, current[0].status),
        current[0].contentHash === null
          ? isNull(dailyPuzzles.contentHash)
          : eq(dailyPuzzles.contentHash, current[0].contentHash)
      ))
      .returning({ id: dailyPuzzles.id });
    if (replaced.length === 0) {
      throw new Error(`football_golf changed during generation; existing puzzle was preserved`);
    }
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
