import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { dailyCompletions, dailyPuzzles, userProgress } from '../db/schema.js';
import { computeLevel } from './authService.js';
import { getPlayerById } from './playerService.js';
import { ensureWeeklyMembership, recordXp, weekStartFor } from './leagueService.js';
import { generateAllDailyPuzzles, generateDailyPuzzleForMode } from './dailyPuzzleGenerator.js';
import { generateFootballBingoPuzzle, isBingoSolvable } from './footballBingoGenerator.js';
import { generateFootballGolfCourse } from './footballGolfGenerator.js';
import { generateOneMorePuzzle, oneMoreStatValue } from './oneMoreGenerator.js';
import { generateWorldCupXiPuzzle } from './worldCupXiGenerator.js';
import { generateBattlePuzzle } from './battleGenerator.js';
import { BLIND_RANK_SLOT_COUNT } from './puzzleValidator.js';
import type { DailyBundle, DailyCompleteResponse } from '../types.js';

const GAME_MODES = [
  { id: 'football_bingo', title: 'FOOTBALL BINGO', subtitle: 'Fill the grid', playerCount: 12400, isAvailable: true },
  { id: 'one_more', title: 'ONE MORE', subtitle: 'Risk it for points', playerCount: 6400, isAvailable: true },
  { id: 'target_man', title: 'TARGET MAN', subtitle: 'Hit the stat target', playerCount: 15200, isAvailable: true },
  { id: 'guess_who', title: 'GUESS WHO?', subtitle: 'Wordle-style player guess', playerCount: 22100, isAvailable: true },
  { id: 'football_golf', title: 'FOOTBALL GOLF', subtitle: '9 holes, name the answers', playerCount: 7600, isAvailable: true },
  { id: 'blind_rank', title: 'BLIND RANK', subtitle: 'Order the stats', playerCount: 9800, isAvailable: true },
  { id: 'draft_master', title: 'BATTLE MODE', subtitle: 'Beat the scenario on a budget', playerCount: 11300, isAvailable: true },
  { id: 'world_cup_xi', title: 'WORLD CUP XI', subtitle: 'Guess the World Cup year', playerCount: 8900, isAvailable: true },
];

const DAILY_PUZZLE_MODES = [
  { modeId: 'guess_who', title: 'GUESS WHO?' },
  { modeId: 'target_man', title: 'TARGET MAN' },
  { modeId: 'blind_rank', title: 'BLIND RANK' },
] as const;

/** Modes whose puzzle is generated + stored server-side and shipped in the bundle. */
const BUNDLE_PUZZLE_MODES = [
  { modeId: 'guess_who', title: 'GUESS WHO?' },
  { modeId: 'target_man', title: 'TARGET MAN' },
  { modeId: 'blind_rank', title: 'BLIND RANK' },
  { modeId: 'football_bingo', title: 'FOOTBALL BINGO' },
  { modeId: 'football_golf', title: 'FOOTBALL GOLF' },
  { modeId: 'one_more', title: 'ONE MORE' },
  { modeId: 'world_cup_xi', title: 'WORLD CUP XI' },
  { modeId: 'draft_master', title: 'BATTLE MODE' },
] as const;

/** All modes that count as one daily play on iOS (order matches client flow). */
export const DAILY_PLAYABLE_MODES = [
  'guess_who',
  'target_man',
  'blind_rank',
  'football_bingo',
  'one_more',
  'draft_master',
  'world_cup_xi',
  'football_golf',
] as const;

const CLIENT_SEED_MODES = new Set<string>([
  'football_bingo',
  'one_more',
  'draft_master',
  'world_cup_xi',
  'football_golf',
]);

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

function computeClientModeXp(modeId: string, score: number, won: boolean): number {
  if (!won) return 10;
  const base: Record<string, number> = {
    football_bingo: 50,
    one_more: 40,
    draft_master: 45,
    football_golf: 55,
    target_man: 50,
    blind_rank: 50,
  };
  const floor = base[modeId] ?? 30;
  return floor + Math.min(50, Math.max(0, score));
}

export function getGameModes() {
  return GAME_MODES;
}

/** Generate + store today's Football Bingo grid if not present. Best-effort. */
async function ensureBingoPuzzle(date: string): Promise<void> {
  const existing = await db
    .select({ modeId: dailyPuzzles.modeId })
    .from(dailyPuzzles)
    .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, 'football_bingo')))
    .limit(1);
  if (existing.length > 0) return;

  try {
    const puzzle = await generateFootballBingoPuzzle(date);
    const check = isBingoSolvable(puzzle);
    if (!check.ok) {
      console.warn(`Skipped football_bingo for ${date}: generated grid was not solvable`);
      return;
    }
    await db
      .insert(dailyPuzzles)
      .values({ date, modeId: 'football_bingo', puzzleJson: puzzle, answerPlayerId: null, answerJson: null })
      .onConflictDoNothing();
    console.log(`Generated football_bingo puzzle for ${date}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Skipped football_bingo for ${date}: ${message}`);
  }
}

/** Generate + store today's Football Golf course if not present. Best-effort. */
async function ensureGolfPuzzle(date: string): Promise<void> {
  const existing = await db
    .select({ modeId: dailyPuzzles.modeId })
    .from(dailyPuzzles)
    .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, 'football_golf')))
    .limit(1);
  if (existing.length > 0) return;

  try {
    const puzzle = await generateFootballGolfCourse(date);
    if (puzzle.holes.length < 9) {
      console.warn(`Skipped football_golf for ${date}: only ${puzzle.holes.length} holes`);
      return;
    }
    await db
      .insert(dailyPuzzles)
      .values({ date, modeId: 'football_golf', puzzleJson: puzzle, answerPlayerId: null, answerJson: null })
      .onConflictDoNothing();
    console.log(`Generated football_golf puzzle for ${date}`);
  } catch (error) {
    console.warn(`Skipped football_golf for ${date}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Generate + store today's One More prompt if not present. Best-effort. */
async function ensureOneMorePuzzle(date: string): Promise<void> {
  const existing = await db
    .select({ modeId: dailyPuzzles.modeId })
    .from(dailyPuzzles)
    .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, 'one_more')))
    .limit(1);
  if (existing.length > 0) return;

  try {
    const { puzzle, pool } = await generateOneMorePuzzle(date);
    if (pool < 10) {
      console.warn(`Skipped one_more for ${date}: pool only ${pool}`);
      return;
    }
    await db
      .insert(dailyPuzzles)
      .values({ date, modeId: 'one_more', puzzleJson: puzzle, answerPlayerId: null, answerJson: null })
      .onConflictDoNothing();
    console.log(`Generated one_more puzzle for ${date}`);
  } catch (error) {
    console.warn(`Skipped one_more for ${date}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Generate + store today's Draft Master challenge if not present. Best-effort. */
async function ensureDraftMasterPuzzle(date: string): Promise<void> {
  const existing = await db
    .select({ modeId: dailyPuzzles.modeId })
    .from(dailyPuzzles)
    .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, 'draft_master')))
    .limit(1);
  if (existing.length > 0) return;

  try {
    const puzzle = await generateBattlePuzzle(date);
    if (!puzzle || puzzle.clubs.length < 10) {
      console.warn(`Skipped draft_master for ${date}: no viable battle puzzle`);
      return;
    }
    await db
      .insert(dailyPuzzles)
      .values({ date, modeId: 'draft_master', puzzleJson: puzzle, answerPlayerId: null, answerJson: null })
      .onConflictDoNothing();
    console.log(`Generated draft_master puzzle for ${date} (${puzzle.category.id}, optimal ${puzzle.optimalScore})`);
  } catch (error) {
    console.warn(`Skipped draft_master for ${date}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Generate + store today's World Cup XI if not present. Best-effort. */
async function ensureWorldCupXiPuzzle(date: string): Promise<void> {
  const existing = await db
    .select({ modeId: dailyPuzzles.modeId })
    .from(dailyPuzzles)
    .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, 'world_cup_xi')))
    .limit(1);
  if (existing.length > 0) return;

  try {
    const puzzle = await generateWorldCupXiPuzzle(date);
    if (!puzzle || puzzle.slots.length < 11) {
      console.warn(`Skipped world_cup_xi for ${date}: no viable XI`);
      return;
    }
    await db
      .insert(dailyPuzzles)
      .values({ date, modeId: 'world_cup_xi', puzzleJson: puzzle, answerPlayerId: null, answerJson: null })
      .onConflictDoNothing();
    console.log(`Generated world_cup_xi puzzle for ${date} (${puzzle.slots.length} slots)`);
  } catch (error) {
    console.warn(`Skipped world_cup_xi for ${date}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Drop a stored Blind Rank puzzle if it predates the 10-slot / embedded-stat
 * format so the generator rebuilds it on the next pass. Prevents serving an old
 * 5-slot puzzle (or one without per-player statValue) to updated clients.
 */
async function migrateStaleBlindRank(date: string): Promise<void> {
  const rows = await db
    .select({ puzzleJson: dailyPuzzles.puzzleJson })
    .from(dailyPuzzles)
    .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, 'blind_rank')))
    .limit(1);

  const puzzle = rows[0]?.puzzleJson as
    | { presentationOrder?: Array<{ statValue?: unknown; headshotUrl?: unknown }>; valueNoun?: unknown }
    | undefined;
  if (!puzzle) return;

  const order = puzzle.presentationOrder;
  const stale =
    !Array.isArray(order) ||
    order.length !== BLIND_RANK_SLOT_COUNT ||
    order.some((player) => typeof player?.statValue !== 'number') ||
    typeof puzzle.valueNoun !== 'string' ||
    // Predates player headshots — no member has one. Fresh puzzles almost always have several
    // (famous pool ~82% covered), so this regenerates old rounds without churning new ones.
    order.every((player) => typeof player?.headshotUrl !== 'string');

  if (stale) {
    await db
      .delete(dailyPuzzles)
      .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, 'blind_rank')));
    console.log(`Removed stale blind_rank puzzle for ${date} (will regenerate)`);
  }
}

/**
 * Drop a stored World Cup XI puzzle if it predates the cross-tournament "name the XI" format
 * (the old single-tournament version had `country`/`year` and no `title`), so it regenerates.
 */
async function migrateStaleWorldCupXi(date: string): Promise<void> {
  const rows = await db
    .select({ puzzleJson: dailyPuzzles.puzzleJson })
    .from(dailyPuzzles)
    .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, 'world_cup_xi')))
    .limit(1);
  const puzzle = rows[0]?.puzzleJson as { country?: unknown; title?: unknown } | undefined;
  if (!puzzle) return;
  if (puzzle.country !== undefined || typeof puzzle.title !== 'string') {
    await db
      .delete(dailyPuzzles)
      .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, 'world_cup_xi')));
    console.log(`Removed stale world_cup_xi puzzle for ${date} (will regenerate)`);
  }
}

/**
 * Drop a stored Draft Master puzzle if it predates Battle Mode (the old format had `prompts`/
 * `category`; the new one has `scenario`/`formationId`), so it regenerates.
 */
async function migrateStaleDraftMaster(date: string): Promise<void> {
  const rows = await db
    .select({ puzzleJson: dailyPuzzles.puzzleJson })
    .from(dailyPuzzles)
    .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, 'draft_master')))
    .limit(1);
  const puzzle = rows[0]?.puzzleJson as { clubs?: unknown; optimalScore?: unknown; optimalLineup?: unknown } | undefined;
  if (!puzzle) return;
  // New Battle format has `clubs` + `optimalScore` + `optimalLineup`; drop anything older so it
  // regenerates (scenario/budget puzzles, or pre-lineup/pre-GK-aware puzzles).
  if (!Array.isArray(puzzle.clubs) || typeof puzzle.optimalScore !== 'number' || !Array.isArray(puzzle.optimalLineup)) {
    await db
      .delete(dailyPuzzles)
      .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, 'draft_master')));
    console.log(`Removed stale draft_master puzzle for ${date} (will regenerate)`);
  }
}

/**
 * Drop a stored One More puzzle that predates player headshots (no option has a headshotUrl), so it
 * regenerates. Fresh puzzles almost always have several, so this won't churn live rounds.
 */
async function migrateStaleOneMore(date: string): Promise<void> {
  const rows = await db
    .select({ puzzleJson: dailyPuzzles.puzzleJson })
    .from(dailyPuzzles)
    .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, 'one_more')))
    .limit(1);
  const puzzle = rows[0]?.puzzleJson as
    | { rounds?: Array<{ options?: Array<{ headshotUrl?: unknown; nationality?: unknown }> }> }
    | undefined;
  if (!puzzle || !Array.isArray(puzzle.rounds)) return;
  const opts = puzzle.rounds.flatMap((r) => r.options ?? []);
  // Stale if it predates headshots OR nationality (the option card needs both).
  const anyHeadshot = opts.some((o) => typeof o?.headshotUrl === 'string');
  const anyNationality = opts.some((o) => typeof o?.nationality === 'string' && o.nationality !== '');
  if (!anyHeadshot || !anyNationality) {
    await db
      .delete(dailyPuzzles)
      .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, 'one_more')));
    console.log(`Removed stale one_more puzzle for ${date} (will regenerate)`);
  }
}

/**
 * Drop a stored Football Bingo puzzle that predates player headshots (players have no headshotUrl
 * field at all), so it regenerates with the field present.
 */
async function migrateStaleBingo(date: string): Promise<void> {
  const rows = await db
    .select({ puzzleJson: dailyPuzzles.puzzleJson })
    .from(dailyPuzzles)
    .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, 'football_bingo')))
    .limit(1);
  const puzzle = rows[0]?.puzzleJson as
    | { players?: Array<Record<string, unknown>>; categories?: Array<Record<string, unknown>> }
    | undefined;
  if (!puzzle || !Array.isArray(puzzle.players) || puzzle.players.length === 0) return;
  const hasHeadshotKey = puzzle.players.some((p) => p && Object.prototype.hasOwnProperty.call(p, 'headshotUrl'));
  // New catalog ships a per-player `stats` map (caps, CL apps, transfer fee, …).
  const hasStatsMap = puzzle.players.some((p) => p && Object.prototype.hasOwnProperty.call(p, 'stats'));
  // Club tiles must carry a server-resolved logoUrl (added after the headshot pass).
  const clubTilesResolved = (puzzle.categories ?? [])
    .filter((c) => c && c.iconType === 'clubBadge')
    .every((c) => Object.prototype.hasOwnProperty.call(c, 'logoUrl'));
  if (!hasHeadshotKey || !hasStatsMap || !clubTilesResolved) {
    await db
      .delete(dailyPuzzles)
      .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, 'football_bingo')));
    console.log(`Removed stale football_bingo puzzle for ${date} (will regenerate)`);
  }
}

async function ensureDailyPuzzles(date: string): Promise<void> {
  await migrateStaleBlindRank(date);
  await migrateStaleWorldCupXi(date);
  await migrateStaleDraftMaster(date);
  await migrateStaleBingo(date);
  await migrateStaleOneMore(date);

  const rows = await db
    .select({ modeId: dailyPuzzles.modeId })
    .from(dailyPuzzles)
    .where(eq(dailyPuzzles.date, date));

  const existing = new Set(rows.map((row) => row.modeId));
  const missing = DAILY_PUZZLE_MODES.some((mode) => !existing.has(mode.modeId));

  if (missing) {
    await generateAllDailyPuzzles(date);
  }
  if (!existing.has('football_bingo')) {
    await ensureBingoPuzzle(date);
  }
  if (!existing.has('football_golf')) {
    await ensureGolfPuzzle(date);
  }
  if (!existing.has('one_more')) {
    await ensureOneMorePuzzle(date);
  }
  if (!existing.has('world_cup_xi')) {
    await ensureWorldCupXiPuzzle(date);
  }
  if (!existing.has('draft_master')) {
    await ensureDraftMasterPuzzle(date);
  }
}

/** Validate a One More answer: does the player meet the prompt's stat minimum? */
export async function validateOneMoreAnswer(
  date: string,
  playerId: string
): Promise<{ valid: boolean; statValue: number }> {
  const rows = await db
    .select()
    .from(dailyPuzzles)
    .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, 'one_more')))
    .limit(1);
  const puzzle = rows[0]?.puzzleJson as
    | { leagueId: number; category: 'goals' | 'assists' | 'appearances'; minimum: number }
    | undefined;
  if (!puzzle) throw new Error('One More puzzle not found');

  const statValue = await oneMoreStatValue(playerId, puzzle.leagueId, puzzle.category);
  return { valid: statValue >= puzzle.minimum, statValue };
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

  const games = BUNDLE_PUZZLE_MODES.flatMap((mode) => {
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

  const completions = await db
    .select({ modeId: dailyCompletions.modeId })
    .from(dailyCompletions)
    .where(and(eq(dailyCompletions.userId, userId), eq(dailyCompletions.date, date)));

  const completedModeIds = completions.map((row) => row.modeId);
  const allComplete = DAILY_PLAYABLE_MODES.every((modeId) => completedModeIds.includes(modeId));

  return {
    date,
    alreadyPlayed: allComplete,
    completedModeIds,
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

  if (!puzzle[0] && !CLIENT_SEED_MODES.has(input.modeId)) {
    throw new Error('Daily puzzle not found');
  }

  const xpEarned =
    input.modeId === 'guess_who'
      ? computeXpEarned(input.won, input.guesses)
      : computeClientModeXp(input.modeId, input.score, input.won);

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

  // Feed the league system: append to the XP ledger and ensure a weekly cohort.
  await recordXp(userId, input.modeId, xpEarned, input.date);
  await ensureWeeklyMembership(userId, weekStartFor(input.date));

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

/** The deduction attributes a Guess Who hint can reveal, by their feedback `field` name. */
const GUESS_WHO_FIELDS = ['nationality', 'league', 'club', 'position', 'age', 'foot'] as const;
type GuessWhoField = (typeof GUESS_WHO_FIELDS)[number];

function guessWhoAttributes(p: NonNullable<Awaited<ReturnType<typeof getPlayerById>>>): Record<GuessWhoField, string | number> {
  return {
    nationality: p.nationality ?? '—',
    league: p.currentLeague ?? '—',
    club: p.currentClub ?? '—',
    position: p.position ?? '—',
    age: p.age ?? '—',
    foot: p.foot ?? '—',
  };
}

async function loadGuessWhoAnswer(date: string) {
  const puzzle = await db
    .select()
    .from(dailyPuzzles)
    .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, 'guess_who')))
    .limit(1);
  if (!puzzle[0]?.answerPlayerId) throw new Error('Guess Who puzzle not found');
  const answer = await getPlayerById(puzzle[0].answerPlayerId);
  if (!answer) throw new Error('Answer player not found');
  return answer;
}

/** Reveal the answer player at the end of a lost game (the client never holds it). */
export async function revealGuessWhoAnswer(date: string): Promise<{
  id: string; name: string; attributes: Record<GuessWhoField, string | number>;
}> {
  const answer = await loadGuessWhoAnswer(date);
  return { id: answer.id, name: answer.name, attributes: guessWhoAttributes(answer) };
}

/**
 * Reveal ONE attribute the player hasn't already nailed: pick a random field not in `known`,
 * return its (correct) value. The client renders it as a green "hint" row.
 */
export async function guessWhoHint(
  date: string,
  known: string[]
): Promise<{ field: GuessWhoField; value: string | number } | { field: null; value: null }> {
  const answer = await loadGuessWhoAnswer(date);
  const remaining = GUESS_WHO_FIELDS.filter((f) => !known.includes(f));
  if (remaining.length === 0) return { field: null, value: null };
  const field = remaining[Math.floor(Math.random() * remaining.length)]!;
  return { field, value: guessWhoAttributes(answer)[field] };
}

export { todayUTC, GAME_MODES, generateDailyPuzzleForMode };
