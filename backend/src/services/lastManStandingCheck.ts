import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { dailyPuzzles } from '../db/schema.js';
import { composeLastManStandingPuzzle } from './lastManStanding/composer.js';

export interface LMSCheckResult {
  correct: boolean;
  reveal?: string;
}

export async function checkLastManStandingAnswer(
  date: string,
  questionId: string,
  optionId: string
): Promise<LMSCheckResult> {
  const rows = await db
    .select({ answerJson: dailyPuzzles.answerJson })
    .from(dailyPuzzles)
    .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, 'last_man_standing')))
    .limit(1);

  const stored = rows[0]?.answerJson as { questions?: Array<{ questionId: string; correctOptionId: string; reveal?: string }> } | null;
  const entry = stored?.questions?.find((q) => q.questionId === questionId);
  if (!entry) {
    throw new Error('Question not found');
  }

  return {
    correct: entry.correctOptionId === optionId,
    reveal: entry.reveal,
  };
}
