import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { dailyCompletions, dailyPuzzles, userProgress } from '../db/schema.js';
import { computeLevel } from './authService.js';
import { getPlayerById } from './playerService.js';
import { generateAllDailyPuzzles, generateDailyPuzzleForMode } from './dailyPuzzleGenerator.js';
import type { DailyBundle, DailyCompleteResponse } from '../types.js';

const GAME_MODES = [
  { id: 'football_bingo', title: 'FOOTBALL BINGO', subtitle: 'Fill the grid', playerCount: 12400, isAvailable: true },
  { id: 'one_more', title: 'ONE MORE', subtitle: 'Risk it for points', playerCount: 6400, isAvailable: true },
  { id: 'target_man', title: 'TARGET MAN', subtitle: 'Hit the stat target', playerCount: 15200, isAvailable: true },
  { id: 'guess_who', title: 'GUESS WHO?', subtitle: 'Wordle-style player guess', playerCount: 22100, isAvailable: true },
  { id: 'football_golf', title: 'FOOTBALL GOLF', subtitle: '9-hole trivia par', playerCount: 7600, isAvailable: true },
  { id: 'blind_rank', title: 'BLIND RANK', subtitle: 'Order the stats', playerCount: 9800, isAvailable: true },
  { id: 'draft_master', title: 'DRAFT MASTER', subtitle: 'Build the best XI', playerCount: 11300, isAvailable: true },
  { id: 'tenaball', title: 'TENABALL', subtitle: 'Top ten guesses', playerCount: 8900, isAvailable: false },
  { id: 'football_tower', title: 'FOOTBALL TOWER', subtitle: 'Climb the tower', playerCount: 8700, isAvailable: true },
];

const DAILY_PUZZLE_MODES = [
  { modeId: 'guess_who', title: 'GUESS WHO?' },
  { modeId: 'target_man', title: 'TARGET MAN' },
  { modeId: 'blind_rank', title: 'BLIND RANK' },
] as const;

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayUTC(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function computeXpEarned(won: boolean, guesses: number): number {
  if (!won) return 10;
  const bonus = Math.max(0, (8 - guesses) * 10);
  return 50 + bonus;
}

export function getGameModes() {
  return GAME_MODES;
}

async function ensureDailyPuzzles(date: string): Promise<void> {
  const rows = await db
    .select({ modeId: dailyPuzzles.modeId })
    .from(dailyPuzzles)
    .where(eq(dailyPuzzles.date, date));

  const existing = new Set(rows.map((row) => row.modeId));
  const missing = DAILY_PUZZLE_MODES.some((mode) => !existing.has(mode.modeId));

  if (missing) {
    await generateAllDailyPuzzles(date);
  }
}

export async function getDailyPuzzle(date: string, modeId: string) {
  await ensureDailyPuzzles(date);

  const rows = await db
    .select()
    .from(dailyPuzzles)
    .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, modeId)))
    .limit(1);

  const puzzle = rows[0];
  if (!puzzle) {
    throw new Error(`Daily puzzle not found for ${modeId}`);
  }

  const meta = DAILY_PUZZLE_MODES.find((mode) => mode.modeId === modeId);
  return {
    modeId,
    title: meta?.title ?? modeId.toUpperCase(),
    puzzle: puzzle.puzzleJson,
  };
}

export async function getDailyBundle(userId: string): Promise<DailyBundle> {
  const date = todayUTC();
  await ensureDailyPuzzles(date);

  const puzzles = await db.select().from(dailyPuzzles).where(eq(dailyPuzzles.date, date));

  const games = DAILY_PUZZLE_MODES.flatMap((mode) => {
    const row = puzzles.find((puzzle) => puzzle.modeId === mode.modeId);
    if (!row) return [];
    return [
      {
        modeId: mode.modeId,
        title: mode.title,
        puzzle: row.puzzleJson as DailyBundle['games'][0]['puzzle'],
      },
    ];
  });

  const completion = await db
    .select()
    .from(dailyCompletions)
    .where(
      and(
        eq(dailyCompletions.userId, userId),
        eq(dailyCompletions.date, date),
        eq(dailyCompletions.modeId, 'guess_who')
      )
    )
    .limit(1);

  return {
    date,
    alreadyPlayed: completion.length > 0,
    games,
  };
}

export async function completeDaily(
  userId: string,
  input: {
    modeId: string;
    date: string;
    score: number;
    guesses: number;
    won: boolean;
    shareGrid: string;
  }
): Promise<DailyCompleteResponse> {
  const existing = await db
    .select()
    .from(dailyCompletions)
    .where(
      and(
        eq(dailyCompletions.userId, userId),
        eq(dailyCompletions.date, input.date),
        eq(dailyCompletions.modeId, input.modeId)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    const progress = await db
      .select()
      .from(userProgress)
      .where(eq(userProgress.userId, userId))
      .limit(1);
    const p = progress[0]!;
    return {
      xpEarned: 0,
      newXp: p.xp,
      newLevel: p.level,
      streak: p.streak,
      todayXp: p.todayXp,
    };
  }

  const puzzle = await db
    .select()
    .from(dailyPuzzles)
    .where(and(eq(dailyPuzzles.date, input.date), eq(dailyPuzzles.modeId, input.modeId)))
    .limit(1);

  if (!puzzle[0]) {
    throw new Error('Daily puzzle not found');
  }

  const xpEarned = computeXpEarned(input.won, input.guesses);

  await db.insert(dailyCompletions).values({
    userId,
    date: input.date,
    modeId: input.modeId,
    score: input.score,
    guesses: input.guesses,
    won: input.won,
    shareGrid: input.shareGrid,
  });

  const progressRows = await db
    .select()
    .from(userProgress)
    .where(eq(userProgress.userId, userId))
    .limit(1);
  const progress = progressRows[0]!;

  const today = todayUTC();
  const yesterday = yesterdayUTC();
  let newStreak = progress.streak;
  const lastPlayed = progress.lastPlayedDate;

  if (lastPlayed !== today) {
    if (lastPlayed === yesterday) {
      newStreak = progress.streak + 1;
    } else {
      newStreak = 1;
    }
  }

  const todayXp = progress.todayXpDate === today ? progress.todayXp + xpEarned : xpEarned;
  const newXp = progress.xp + xpEarned;
  const newLevel = computeLevel(newXp);

  await db
    .update(userProgress)
    .set({
      xp: newXp,
      level: newLevel,
      streak: newStreak,
      lastPlayedDate: today,
      todayXp,
      todayXpDate: today,
    })
    .where(eq(userProgress.userId, userId));

  return {
    xpEarned,
    newXp,
    newLevel,
    streak: newStreak,
    todayXp,
  };
}

export async function validateGuess(
  date: string,
  modeId: string,
  playerId: string
): Promise<{ feedback: import('../types.js').GuessFeedbackField[]; correct: boolean }> {
  const puzzle = await db
    .select()
    .from(dailyPuzzles)
    .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, modeId)))
    .limit(1);

  if (!puzzle[0]) throw new Error('Puzzle not found');

  const answer = await getPlayerById(puzzle[0].answerPlayerId ?? '');
  const guess = await getPlayerById(playerId);
  if (!answer || !guess) throw new Error('Player not found');

  const { buildGuessFeedback, isCorrectGuess } = await import('./playerService.js');
  return {
    feedback: buildGuessFeedback(guess, answer),
    correct: isCorrectGuess(guess, answer),
  };
}

export { todayUTC, GAME_MODES, generateDailyPuzzleForMode };
