import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { dailyPuzzles, players } from '../db/schema.js';
import type { GuessWhoPuzzlePublic } from '../types.js';

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export async function generateDailyPuzzle(date: string, modeId = 'guess_who'): Promise<void> {
  const existing = await db
    .select()
    .from(dailyPuzzles)
    .where(eq(dailyPuzzles.date, date))
    .limit(1);

  if (existing.length > 0) return;

  const allPlayers = await db.select().from(players);
  if (allPlayers.length === 0) {
    throw new Error('No players in database — run db:seed first');
  }

  const index = hashString(`${date}:${modeId}`) % allPlayers.length;
  const answerPlayer = allPlayers[index]!;

  const puzzle: GuessWhoPuzzlePublic = {
    modeId: 'guess_who',
    puzzleId: `${date}-guess_who`,
    date,
    maxGuesses: 8,
    maxScore: 100,
  };

  await db.insert(dailyPuzzles).values({
    date,
    modeId,
    puzzleJson: puzzle,
    answerPlayerId: answerPlayer.id,
  });

  console.log(`Generated daily puzzle for ${date}: ${answerPlayer.name}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);
  generateDailyPuzzle(date)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
