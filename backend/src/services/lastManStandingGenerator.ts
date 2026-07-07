/**
 * Last Man Standing daily composer — 10 fast TV-quiz MCQs from typed builders.
 *
 * Dry run: DATABASE_URL=... npx tsx src/services/lastManStandingGenerator.ts [date]
 */
import 'dotenv/config';
import { composeLastManStandingPuzzle } from './lastManStanding/composer.js';

export type {
  LastManStandingAnswer,
  LastManStandingPuzzle,
  LMSQuestionPublic,
  LMSQuestionType,
} from './lastManStanding/types.js';

export async function generateLastManStandingPuzzle(date: string) {
  const composed = await composeLastManStandingPuzzle(date);
  if (!composed) {
    throw new Error('Could not compose Last Man Standing puzzle');
  }
  return composed;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);
  generateLastManStandingPuzzle(date)
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
