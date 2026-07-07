import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { dailyPuzzles } from '../db/schema.js';
import { generateClubChainPuzzle } from '../services/clubChainGenerator.js';

function pairKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

async function main() {
  const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);

  const existing = await db
    .select()
    .from(dailyPuzzles)
    .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, 'club_chain')))
    .limit(1);

  const oldPuzzle = existing[0]?.puzzleJson as { start?: { id: string }; target?: { id: string } } | undefined;
  const excludePairKeys = new Set<string>();
  if (oldPuzzle?.start?.id && oldPuzzle?.target?.id) {
    excludePairKeys.add(pairKey(oldPuzzle.start.id, oldPuzzle.target.id));
  }

  if (existing[0]) {
    await db
      .delete(dailyPuzzles)
      .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, 'club_chain')));
    console.log(`Deleted existing club_chain puzzle for ${date}`);
  }

  const result = await generateClubChainPuzzle(date, { excludePairKeys });
  if (!result) throw new Error('No viable Club Chain puzzle');

  await db.insert(dailyPuzzles).values({
    date,
    modeId: 'club_chain',
    puzzleJson: result.puzzle,
    answerPlayerId: null,
    answerJson: result.answer,
  });

  console.log(
    JSON.stringify(
      {
        date,
        difficulty: result.puzzle.difficulty,
        par: result.puzzle.shortestPathLength,
        maxMoves: result.puzzle.maxMoves,
        start: result.puzzle.start.name,
        target: result.puzzle.target.name,
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
