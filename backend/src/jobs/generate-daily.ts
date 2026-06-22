import 'dotenv/config';
import { generateAllDailyPuzzles, generateDailyPuzzleForMode } from '../services/dailyPuzzleGenerator.js';

export { generateAllDailyPuzzles, generateDailyPuzzleForMode };

/** @deprecated Use generateAllDailyPuzzles or generateDailyPuzzleForMode */
export async function generateDailyPuzzle(date: string, modeId = 'guess_who'): Promise<void> {
  await generateDailyPuzzleForMode(date, modeId as 'guess_who' | 'target_man' | 'blind_rank');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);
  const mode = process.argv[3];

  const run = mode
    ? generateDailyPuzzleForMode(date, mode as 'guess_who' | 'target_man' | 'blind_rank')
    : generateAllDailyPuzzles(date);

  run
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
