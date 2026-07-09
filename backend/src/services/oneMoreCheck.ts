import jwt from 'jsonwebtoken';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { dailyPuzzles } from '../db/schema.js';

/**
 * Sequential One More run tokens — same pattern as LMS.
 * Clients cannot probe option values for future rounds; each check advances the index.
 */

export interface OneMoreCheckResult {
  correct: boolean;
  values: Record<string, number>;
  nextToken?: string;
  status: 'active' | 'busted' | 'cleared';
}

export interface OneMoreStartResult {
  token: string;
  roundCount: number;
}

interface OneMoreRunClaims {
  typ: 'one_more_run';
  userId: string;
  date: string;
  roundIndex: number;
  picks: string[];
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return secret;
}

function signRunToken(claims: Omit<OneMoreRunClaims, 'typ'>): string {
  return jwt.sign({ typ: 'one_more_run', ...claims }, getJwtSecret(), { expiresIn: '36h' });
}

function verifyRunToken(token: string): OneMoreRunClaims {
  const decoded = jwt.verify(token, getJwtSecret()) as OneMoreRunClaims;
  if (decoded?.typ !== 'one_more_run' || typeof decoded.userId !== 'string') {
    throw new Error('Invalid One More run token');
  }
  return decoded;
}

async function loadOneMore(date: string) {
  const rows = await db
    .select({ puzzleJson: dailyPuzzles.puzzleJson, answerJson: dailyPuzzles.answerJson })
    .from(dailyPuzzles)
    .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, 'one_more')))
    .limit(1);
  const puzzle = rows[0]?.puzzleJson as {
    minimum?: number;
    rounds?: Array<{ options?: Array<{ id: string; value?: number }> }>;
  } | null;
  if (!puzzle || !Array.isArray(puzzle.rounds) || typeof puzzle.minimum !== 'number') {
    throw new Error('One More puzzle not found');
  }
  const answerValues = (rows[0]?.answerJson as { valuesByRound?: Array<Record<string, number>> } | null)
    ?.valuesByRound;
  return { puzzle, answerValues };
}

function valuesForRound(
  puzzle: { rounds?: Array<{ options?: Array<{ id: string; value?: number }> }> },
  answerValues: Array<Record<string, number>> | undefined,
  roundIndex: number
): Record<string, number> {
  const round = puzzle.rounds?.[roundIndex];
  const values: Record<string, number> = {};
  for (const opt of round?.options ?? []) {
    const v = typeof opt.value === 'number' ? opt.value : answerValues?.[roundIndex]?.[opt.id];
    if (typeof v === 'number') values[opt.id] = v;
  }
  return values;
}

export async function startOneMoreRun(
  userId: string,
  date: string,
  resumePicks: string[] = []
): Promise<OneMoreStartResult> {
  const { puzzle, answerValues } = await loadOneMore(date);
  const rounds = puzzle.rounds!;
  if (resumePicks.length > rounds.length) throw new Error('Invalid One More resume');

  for (let i = 0; i < resumePicks.length; i += 1) {
    const values = valuesForRound(puzzle, answerValues, i);
    const v = values[resumePicks[i]!];
    if (typeof v !== 'number' || v < puzzle.minimum!) {
      throw new Error('One More resume picks do not match');
    }
  }

  return {
    token: signRunToken({
      userId,
      date,
      roundIndex: resumePicks.length,
      picks: resumePicks,
    }),
    roundCount: rounds.length,
  };
}

export async function submitOneMorePick(
  userId: string,
  date: string,
  token: string,
  optionId: string
): Promise<OneMoreCheckResult> {
  const claims = verifyRunToken(token);
  if (claims.userId !== userId || claims.date !== date) {
    throw new Error('One More run token does not match this user/date');
  }

  const { puzzle, answerValues } = await loadOneMore(date);
  const rounds = puzzle.rounds!;
  if (claims.roundIndex >= rounds.length) throw new Error('One More run already finished');

  const values = valuesForRound(puzzle, answerValues, claims.roundIndex);
  const picked = values[optionId];
  if (typeof picked !== 'number') throw new Error('Option not found');

  const correct = picked >= puzzle.minimum!;
  if (!correct) {
    return { correct: false, values, status: 'busted' };
  }

  const nextPicks = [...claims.picks, optionId];
  const nextIndex = claims.roundIndex + 1;
  if (nextIndex >= rounds.length) {
    return { correct: true, values, status: 'cleared' };
  }

  return {
    correct: true,
    values,
    nextToken: signRunToken({
      userId,
      date,
      roundIndex: nextIndex,
      picks: nextPicks,
    }),
    status: 'active',
  };
}
