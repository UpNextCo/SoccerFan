import jwt from 'jsonwebtoken';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { dailyPuzzles } from '../db/schema.js';

/**
 * Sequential LMS run tokens.
 *
 * Each check consumes a one-shot JWT bound to (userId, date, questionIndex). A correct answer
 * returns the next token; a wrong answer ends the run. Clients cannot probe arbitrary
 * questionId/optionId pairs — they only ever learn whether the *current* question's pick was right.
 */

export interface LMSCheckResult {
  correct: boolean;
  reveal?: string;
  /** Present after a correct answer when more questions remain. */
  nextToken?: string;
  status: 'active' | 'eliminated' | 'completed';
  questionsSurvived: number;
}

export interface LMSStartResult {
  token: string;
  questionCount: number;
}

interface LMSRunClaims {
  typ: 'lms_run';
  userId: string;
  date: string;
  /** Index of the question the holder is allowed to answer next. */
  questionIndex: number;
  /** Option ids already accepted as correct, in order. */
  picks: string[];
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return secret;
}

function signRunToken(claims: Omit<LMSRunClaims, 'typ'>): string {
  const payload: LMSRunClaims = { typ: 'lms_run', ...claims };
  return jwt.sign(payload, getJwtSecret(), { expiresIn: '36h' });
}

function verifyRunToken(token: string): LMSRunClaims {
  const decoded = jwt.verify(token, getJwtSecret()) as LMSRunClaims;
  if (decoded?.typ !== 'lms_run' || typeof decoded.userId !== 'string' || typeof decoded.date !== 'string') {
    throw new Error('Invalid LMS run token');
  }
  if (!Number.isInteger(decoded.questionIndex) || decoded.questionIndex < 0) {
    throw new Error('Invalid LMS run token');
  }
  if (!Array.isArray(decoded.picks)) {
    throw new Error('Invalid LMS run token');
  }
  return decoded;
}

type LMSAnswerEntry = { questionId: string; correctOptionId: string; reveal?: string };

async function loadLMSAnswers(date: string): Promise<LMSAnswerEntry[]> {
  const rows = await db
    .select({ answerJson: dailyPuzzles.answerJson, puzzleJson: dailyPuzzles.puzzleJson })
    .from(dailyPuzzles)
    .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, 'last_man_standing')))
    .limit(1);

  const stored = rows[0]?.answerJson as {
    questions?: LMSAnswerEntry[];
    correctOptionIds?: string[];
  } | null;

  if (Array.isArray(stored?.questions) && stored.questions.length > 0) {
    return stored.questions;
  }

  // Legacy shape: correctOptionIds aligned with puzzle question order.
  const puzzle = rows[0]?.puzzleJson as { questions?: Array<{ id?: string }> } | null;
  const ids = stored?.correctOptionIds;
  if (Array.isArray(ids) && Array.isArray(puzzle?.questions) && ids.length === puzzle.questions.length) {
    return puzzle.questions.map((q, i) => ({
      questionId: typeof q.id === 'string' ? q.id : `q${i}`,
      correctOptionId: ids[i]!,
    }));
  }

  throw new Error('Last Man Standing puzzle not found');
}

/**
 * Start (or restart) a sequential LMS run for this user/date.
 * Optional `resumePicks` re-validates prior correct answers and issues a token at that index
 * so mid-game resume works without letting clients skip ahead.
 */
export async function startLastManStandingRun(
  userId: string,
  date: string,
  resumePicks: string[] = []
): Promise<LMSStartResult> {
  const answers = await loadLMSAnswers(date);
  if (answers.length === 0) throw new Error('Last Man Standing puzzle not found');

  if (resumePicks.length > answers.length) {
    throw new Error('Invalid LMS resume');
  }
  for (let i = 0; i < resumePicks.length; i += 1) {
    if (resumePicks[i] !== answers[i]!.correctOptionId) {
      throw new Error('LMS resume picks do not match');
    }
  }

  return {
    token: signRunToken({
      userId,
      date,
      questionIndex: resumePicks.length,
      picks: resumePicks,
    }),
    questionCount: answers.length,
  };
}

/**
 * Submit one answer for the question the run token currently points at.
 * Wrong answers end the run (no nextToken). Correct answers advance the index.
 */
export async function submitLastManStandingAnswer(
  userId: string,
  date: string,
  token: string,
  optionId: string
): Promise<LMSCheckResult> {
  const claims = verifyRunToken(token);
  if (claims.userId !== userId || claims.date !== date) {
    throw new Error('LMS run token does not match this user/date');
  }

  const answers = await loadLMSAnswers(date);
  if (claims.questionIndex >= answers.length) {
    throw new Error('LMS run already finished');
  }

  const entry = answers[claims.questionIndex]!;
  const correct = entry.correctOptionId === optionId;
  const questionsSurvived = correct ? claims.questionIndex + 1 : claims.questionIndex;

  if (!correct) {
    return {
      correct: false,
      reveal: entry.reveal,
      status: 'eliminated',
      questionsSurvived,
    };
  }

  const nextPicks = [...claims.picks, optionId];
  const nextIndex = claims.questionIndex + 1;
  if (nextIndex >= answers.length) {
    return {
      correct: true,
      reveal: entry.reveal,
      status: 'completed',
      questionsSurvived,
    };
  }

  return {
    correct: true,
    reveal: entry.reveal,
    nextToken: signRunToken({
      userId,
      date,
      questionIndex: nextIndex,
      picks: nextPicks,
    }),
    status: 'active',
    questionsSurvived,
  };
}
