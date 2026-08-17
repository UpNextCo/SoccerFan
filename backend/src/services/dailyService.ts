import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { dailyCompletions, dailyPuzzles, userProgress } from '../db/schema.js';
import { computeLevel } from './authService.js';
import { getPlayerById } from './playerService.js';
import { recordXp, syncWeeklyLeagueAfterXp } from './leagueService.js';
import { generateAllDailyPuzzles, generateDailyPuzzleForMode } from './dailyPuzzleGenerator.js';
import { generateFootballBingoPuzzle, isBingoSolvable } from './footballBingoGenerator.js';
import { generateFootballGolfCourse } from './footballGolfGenerator.js';
import {
  FOOTBALL_GOLF_HOLE_COUNT,
  FOOTBALL_GOLF_MAX_XP,
} from './footballGolfConstants.js';
import { generateOneMorePuzzle } from './oneMoreGenerator.js';
import { generateClubChainPuzzle, clubChainLink } from './clubChainGenerator.js';
import {
  BACK_YOURSELF_MAX_XP,
  generateBackYourselfPuzzle,
  playerMatchesBackYourselfCategory,
  resolveBackYourselfPlayerCard,
  type BackYourselfCategory,
  type BackYourselfPuzzlePublic,
} from './backYourselfGenerator.js';
import { generateAndPersistLastManStandingPuzzle } from './lastManStandingGenerator.js';
import { generateDarts501Puzzle, parseDarts501Puzzle } from './darts501Generator.js';
import { DARTS501_MAX_XP } from './darts501Scoring.js';
import { LMS_PUZZLE_VERSION } from './lastManStanding/types.js';
import { startLastManStandingRun, submitLastManStandingAnswer } from './lastManStandingCheck.js';
import { generateBattlePuzzle } from './battleGenerator.js';
import { DRAFT_POSITION_COMPATIBILITY_VERSION } from './playerPositionService.js';
import { resolveCompletionScore } from './dailyScoring.js';
import { isAcceptableCompletionDate, previousDay, resolveClientDailyDate, todayUTC } from '../utils/dailyDate.js';
import type { DailyBundle, DailyCompleteResponse } from '../types.js';

/** Live homepage catalog — matches iOS DailyPlayOrder.playableModes. */
const GAME_MODES = [
  { id: 'football_bingo', title: 'FOOTBALL BINGO', subtitle: 'Fill the grid', playerCount: 12400, isAvailable: true },
  { id: 'one_more', title: 'ONE MORE', subtitle: 'Risk it for points', playerCount: 6400, isAvailable: true },
  { id: 'draft_master', title: 'DRAFT XI', subtitle: 'Build the highest-scoring XI', playerCount: 11300, isAvailable: true },
  { id: 'football_golf', title: 'FOOTBALL GOLF', subtitle: '5 holes, name the answers', playerCount: 7600, isAvailable: true },
  { id: 'club_chain', title: 'CLUB CHAIN', subtitle: 'Link them by shared clubs', playerCount: 9200, isAvailable: true },
  { id: 'target_man', title: 'TARGET MAN', subtitle: 'Hit the stat target', playerCount: 15200, isAvailable: true },
  { id: 'last_man_standing', title: 'LAST MAN STANDING', subtitle: 'Survive the field', playerCount: 10100, isAvailable: true },
  { id: 'back_yourself', title: 'BACK YOURSELF', subtitle: 'Pledge how many you can name', playerCount: 9800, isAvailable: true },
  { id: 'darts_501', title: 'DARTS 501', subtitle: 'Name players, check out from 501', playerCount: 8700, isAvailable: true },
];

/** Modes still generated via generateAllDailyPuzzles (legacy Guess Who / Blind Rank retired). */
const DAILY_PUZZLE_MODES = [
  { modeId: 'target_man', title: 'TARGET MAN' },
] as const;

/** Modes whose puzzle is generated + stored server-side and shipped in the bundle. */
const BUNDLE_PUZZLE_MODES = [
  { modeId: 'football_bingo', title: 'FOOTBALL BINGO' },
  { modeId: 'one_more', title: 'ONE MORE' },
  { modeId: 'draft_master', title: 'DRAFT XI' },
  { modeId: 'football_golf', title: 'FOOTBALL GOLF' },
  { modeId: 'club_chain', title: 'CLUB CHAIN' },
  { modeId: 'target_man', title: 'TARGET MAN' },
  { modeId: 'last_man_standing', title: 'LAST MAN STANDING' },
  { modeId: 'back_yourself', title: 'BACK YOURSELF' },
  { modeId: 'darts_501', title: 'DARTS 501' },
] as const;

/** All modes that count as one daily play on iOS (order matches client flow). */
export const DAILY_PLAYABLE_MODES = [
  'football_bingo',
  'one_more',
  'draft_master',
  'football_golf',
  'club_chain',
  'target_man',
  'last_man_standing',
  'back_yourself',
  'darts_501',
] as const;

/**
 * True when the user has completed every playable mode that actually generated for `date`.
 * Missing puzzles (generation failure) are excluded so a broken mode can't block the streak forever.
 */
async function hasClearedDaily(userId: string, date: string): Promise<boolean> {
  const puzzles = await db
    .select({ modeId: dailyPuzzles.modeId })
    .from(dailyPuzzles)
    .where(eq(dailyPuzzles.date, date));

  const availableModes = DAILY_PLAYABLE_MODES.filter((modeId) =>
    puzzles.some((p) => p.modeId === modeId)
  );
  if (availableModes.length === 0) return false;

  const completions = await db
    .select({ modeId: dailyCompletions.modeId })
    .from(dailyCompletions)
    .where(and(eq(dailyCompletions.userId, userId), eq(dailyCompletions.date, date)));

  const completed = new Set(completions.map((row) => row.modeId));
  return availableModes.every((modeId) => completed.has(modeId));
}

// ---- XP model ------------------------------------------------------------------------------------
// One XP system across every game: a game's `score` IS its XP, earned incrementally per step and
// clamped to the mode's effort-tiered maximum. A full loss earns 0 (no participation floor). The
// client computes the same XP as it plays (each step shows the XP gained) and ships it as `score`;
// server-authoritative recompute (dailyScoring.ts) reproduces it from the answer. MIRRORED in
// ios/BallKnowledge/Domain/GameModels.swift (DailyXP) — keep the two in lockstep.
const DEFAULT_MAX_XP = 1000;
export const MAX_XP: Record<string, number> = {
  guess_who: 800,
  one_more: 900,
  target_man: 1100,
  blind_rank: 1000,
  football_bingo: 1000,
  club_chain: 1000,
  world_cup_xi: 1100,
  draft_master: 1100,
  football_tower: 900,
  football_golf: FOOTBALL_GOLF_MAX_XP,
  last_man_standing: 900,
  back_yourself: BACK_YOURSELF_MAX_XP,
  darts_501: DARTS501_MAX_XP,
};

export function maxXpForMode(modeId: string): number {
  return MAX_XP[modeId] ?? DEFAULT_MAX_XP;
}

function computeXp(modeId: string, score: number, _guesses: number, _won: boolean): number {
  return Math.max(0, Math.min(maxXpForMode(modeId), Math.round(score)));
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
    if (puzzle.holes.length !== FOOTBALL_GOLF_HOLE_COUNT) {
      console.warn(
        `Skipped football_golf for ${date}: generated ${puzzle.holes.length} holes, expected exactly ${FOOTBALL_GOLF_HOLE_COUNT}`
      );
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
      .values({
        date,
        modeId: 'one_more',
        puzzleJson: puzzle,
        answerPlayerId: null,
        // Values are also mirrored here so the public bundle can strip option.value.
        answerJson: {
          valuesByRound: puzzle.rounds.map((r) =>
            Object.fromEntries(r.options.map((o) => [o.id, o.value]))
          ),
        },
      })
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
    if (!puzzle || puzzle.constraints.length < 10) {
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

/** Generate + store today's Back Yourself puzzle if not present. Valid player ids stay in answerJson. */
async function ensureBackYourselfPuzzle(date: string): Promise<void> {
  const existing = await db
    .select({ modeId: dailyPuzzles.modeId })
    .from(dailyPuzzles)
    .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, 'back_yourself')))
    .limit(1);
  if (existing.length > 0) return;

  try {
    const generated = await generateBackYourselfPuzzle(date);
    if (!generated) {
      console.warn(`Skipped back_yourself for ${date}: no viable puzzle`);
      return;
    }
    await db
      .insert(dailyPuzzles)
      .values({
        date,
        modeId: 'back_yourself',
        puzzleJson: generated.puzzle,
        answerPlayerId: null,
        answerJson: generated.answer,
      })
      .onConflictDoNothing();
    console.log(
      `Generated back_yourself puzzle for ${date} (${generated.puzzle.category.label}, max ${generated.puzzle.maxPool})`
    );
  } catch (error) {
    console.warn(`Skipped back_yourself for ${date}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Generate + store today's Darts 501 formula if not present. Best-effort. */
async function ensureDarts501Puzzle(date: string): Promise<void> {
  const existing = await db
    .select({ modeId: dailyPuzzles.modeId })
    .from(dailyPuzzles)
    .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, 'darts_501')))
    .limit(1);
  if (existing.length > 0) return;

  try {
    const generated = await generateDarts501Puzzle(date);
    if (!generated) {
      console.warn(`Skipped darts_501 for ${date}: no viable formula`);
      return;
    }
    await db
      .insert(dailyPuzzles)
      .values({
        date,
        modeId: 'darts_501',
        puzzleJson: generated.puzzle,
        answerPlayerId: null,
        answerJson: generated.answer,
      })
      .onConflictDoNothing();
    console.log(`Generated darts_501 puzzle for ${date} (${generated.puzzle.formulaLabel})`);
  } catch (error) {
    console.warn(`Skipped darts_501 for ${date}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Generate + store today's Club Chain puzzle if not present. Best-effort. The shortest-path answer
 *  (the scoring "par" route) is stored in answerJson and never shipped to the client. */
async function ensureClubChainPuzzle(date: string): Promise<void> {
  const existing = await db
    .select({ modeId: dailyPuzzles.modeId })
    .from(dailyPuzzles)
    .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, 'club_chain')))
    .limit(1);
  if (existing.length > 0) return;

  try {
    const generated = await generateClubChainPuzzle(date);
    if (!generated) {
      console.warn(`Skipped club_chain for ${date}: no viable puzzle`);
      return;
    }
    await db
      .insert(dailyPuzzles)
      .values({ date, modeId: 'club_chain', puzzleJson: generated.puzzle, answerPlayerId: null, answerJson: generated.answer })
      .onConflictDoNothing();
    console.log(`Generated club_chain puzzle for ${date} (${generated.puzzle.difficulty}, par ${generated.puzzle.shortestPathLength})`);
  } catch (error) {
    console.warn(`Skipped club_chain for ${date}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** One shared generation promise per date so concurrent bundle requests wait for the same work. */
const lmsRegenerationInFlight = new Map<string, Promise<void>>();
const LMS_GENERATION_ATTEMPTS = 3;
const LMS_RETRY_DELAYS_MS = [1_000, 3_000] as const;

function isStaleLastManStanding(puzzleJson: unknown, answerJson: unknown): boolean {
  const puzzle = puzzleJson as
    | { version?: unknown; questions?: Array<{ type?: unknown; prompt?: unknown }> }
    | undefined;
  if (!puzzle || !Array.isArray(puzzle.questions) || puzzle.questions.length !== 10) return true;
  if (puzzle.version !== LMS_PUZZLE_VERSION) return true;

  const first = puzzle.questions[0];
  if (!first || typeof first.type !== 'string') return true;
  if (typeof first.prompt === 'string' && first.prompt.toLowerCase().includes('placeholder')) return true;

  const answer = answerJson as { questions?: unknown; correctOptionIds?: unknown } | null;
  if (!Array.isArray(answer?.questions)) return true;
  if (Array.isArray(answer?.correctOptionIds)) return true;
  return false;
}

/**
 * Drop a stored Last Man Standing puzzle if it predates typed builders (stub "Option A" placeholders
 * or legacy correctOptionIds answer shape), so it regenerates with real questions.
 */
async function migrateStaleLastManStanding(date: string): Promise<void> {
  const rows = await db
    .select({
      puzzleJson: dailyPuzzles.puzzleJson,
      answerJson: dailyPuzzles.answerJson,
      status: dailyPuzzles.status,
    })
    .from(dailyPuzzles)
    .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, 'last_man_standing')))
    .limit(1);
  if (!rows[0]) return;
  if (rows[0].status === 'locked' || rows[0].status === 'approved') return;
  if (isStaleLastManStanding(rows[0].puzzleJson, rows[0].answerJson)) {
    await db
      .delete(dailyPuzzles)
      .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, 'last_man_standing')));
    console.log(`Removed stale last_man_standing puzzle for ${date} (will regenerate)`);
  }
}

async function storeLastManStandingPuzzle(date: string): Promise<void> {
  const { generated, persisted } = await generateAndPersistLastManStandingPuzzle(
    date,
    async ({ puzzle, answer }) => {
      if (puzzle.questions.length < 10) return false;
      const inserted = await db
        .insert(dailyPuzzles)
        .values({ date, modeId: 'last_man_standing', puzzleJson: puzzle, answerPlayerId: null, answerJson: answer })
        .onConflictDoNothing()
        .returning({ id: dailyPuzzles.id });
      return inserted.length > 0;
    }
  );
  if (generated.puzzle.questions.length < 10) {
    console.warn(`Skipped last_man_standing for ${date}: only ${generated.puzzle.questions.length} questions`);
    return;
  }
  if (!persisted) return;
  console.log(`Generated last_man_standing puzzle for ${date}`);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function storeLastManStandingPuzzleWithRetry(date: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= LMS_GENERATION_ATTEMPTS; attempt += 1) {
    try {
      await storeLastManStandingPuzzle(date);
      return;
    } catch (error) {
      lastError = error;
      const detail = error instanceof Error ? error.message : String(error);
      console.warn(
        `Last Man Standing generation attempt ${attempt}/${LMS_GENERATION_ATTEMPTS} failed for ${date}: ${detail}`
      );
      const retryDelay = LMS_RETRY_DELAYS_MS[attempt - 1];
      if (retryDelay != null) await delay(retryDelay);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`Could not generate Last Man Standing for ${date}`);
}

/** Generate + store LMS if missing. Concurrent callers await one retrying generation run. */
export async function ensureLastManStandingPuzzle(date: string): Promise<void> {
  const existing = await db
    .select({ modeId: dailyPuzzles.modeId })
    .from(dailyPuzzles)
    .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, 'last_man_standing')))
    .limit(1);
  if (existing.length > 0) return;
  const activeGeneration = lmsRegenerationInFlight.get(date);
  if (activeGeneration) {
    await activeGeneration;
    return;
  }

  const generation = storeLastManStandingPuzzleWithRetry(date);
  lmsRegenerationInFlight.set(date, generation);
  try {
    await generation;
  } catch (error) {
    console.warn(
      `Skipped last_man_standing for ${date} after retries: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  } finally {
    lmsRegenerationInFlight.delete(date);
  }
}

/** Drop a generated Draft XI puzzle when its format or position rules are stale. */
async function migrateStaleDraftMaster(date: string): Promise<void> {
  const rows = await db
    .select({ puzzleJson: dailyPuzzles.puzzleJson, status: dailyPuzzles.status })
    .from(dailyPuzzles)
    .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, 'draft_master')))
    .limit(1);
  if (!rows[0] || rows[0].status === 'locked' || rows[0].status === 'approved') return;
  const puzzle = rows[0].puzzleJson as {
    constraints?: unknown;
    optimalScore?: unknown;
    optimalLineup?: unknown;
    positionCompatibilityVersion?: unknown;
  } | undefined;
  if (!puzzle) return;
  const staleFormat =
    !Array.isArray(puzzle.constraints) ||
    typeof puzzle.optimalScore !== 'number' ||
    !Array.isArray(puzzle.optimalLineup);
  const stalePositionRules =
    puzzle.positionCompatibilityVersion !== DRAFT_POSITION_COMPATIBILITY_VERSION;
  if (staleFormat || stalePositionRules) {
    await db
      .delete(dailyPuzzles)
      .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, 'draft_master')));
    console.log(
      `Removed stale draft_master puzzle for ${date} (${
        stalePositionRules ? 'position rules changed' : 'format changed'
      }; will regenerate)`
    );
  }
}

/**
 * Drop a stored One More puzzle that predates player headshots (no option has a headshotUrl), so it
 * regenerates. Fresh puzzles almost always have several, so this won't churn live rounds.
 */
async function migrateStaleOneMore(date: string): Promise<void> {
  const rows = await db
    .select({ puzzleJson: dailyPuzzles.puzzleJson, status: dailyPuzzles.status })
    .from(dailyPuzzles)
    .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, 'one_more')))
    .limit(1);
  if (!rows[0] || rows[0].status === 'locked' || rows[0].status === 'approved') return;
  const puzzle = rows[0].puzzleJson as
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
    .select({ puzzleJson: dailyPuzzles.puzzleJson, status: dailyPuzzles.status })
    .from(dailyPuzzles)
    .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, 'football_bingo')))
    .limit(1);
  if (!rows[0] || rows[0].status === 'locked' || rows[0].status === 'approved') return;
  const puzzle = rows[0].puzzleJson as
    | { players?: Array<Record<string, unknown>>; categories?: Array<Record<string, unknown>> }
    | undefined;
  if (!puzzle || !Array.isArray(puzzle.players) || puzzle.players.length === 0) return;
  const hasHeadshotKey = puzzle.players.some((p) => p && Object.prototype.hasOwnProperty.call(p, 'headshotUrl'));
  // New catalog ships a per-player `stats` map (caps, CL apps, transfer fee, …).
  const hasStatsMap = puzzle.players.some((p) => p && Object.prototype.hasOwnProperty.call(p, 'stats'));
  // Club tiles must carry a server-resolved logoUrl (added after the headshot pass).
  const clubTiles = (puzzle.categories ?? []).filter(
    (c) => c && (c.iconType === 'clubBadge' || c.iconType === 'nationClub' || c.iconType === 'clubCombo')
  );
  const clubTilesResolved =
    clubTiles.length === 0 ||
    clubTiles.every(
      (c) =>
        Object.prototype.hasOwnProperty.call(c, 'logoUrl') &&
        (c.iconType !== 'clubBadge' && c.iconType !== 'nationClub' ? true : c.logoUrl != null)
    );
  if (!hasHeadshotKey || !hasStatsMap || !clubTilesResolved) {
    await db
      .delete(dailyPuzzles)
      .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, 'football_bingo')));
    console.log(`Removed stale football_bingo puzzle for ${date} (will regenerate)`);
  }
}

async function ensureDailyPuzzles(date: string): Promise<void> {
  // Keep migrations for live modes only — defunct Guess Who / Blind Rank / WC XI are no longer generated.
  await migrateStaleDraftMaster(date);
  await migrateStaleBingo(date);
  await migrateStaleOneMore(date);
  await migrateStaleLastManStanding(date);

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
  if (!existing.has('draft_master')) {
    await ensureDraftMasterPuzzle(date);
  }
  if (!existing.has('club_chain')) {
    await ensureClubChainPuzzle(date);
  }
  if (!existing.has('last_man_standing')) {
    await ensureLastManStandingPuzzle(date);
  }
  if (!existing.has('back_yourself')) {
    await ensureBackYourselfPuzzle(date);
  }
  if (!existing.has('darts_501')) {
    await ensureDarts501Puzzle(date);
  }
}

/**
 * Validate a Club Chain move: are `fromId` and `toId` real club teammates (shared club, overlapping
 * seasons)? Optionally also checks whether `toId` links to the puzzle's target, so the client can
 * detect a win in one round-trip. National / same-nationality links never count.
 */
/**
 * Validate a Back Yourself guess against today's category. Duplicates are reported without
 * revealing whether the player fits (client should treat as no-op).
 */
export async function validateBackYourselfGuess(input: {
  date: string;
  playerId: string;
  alreadyNamedIds?: string[];
}): Promise<{
  ok: boolean;
  correct: boolean;
  duplicate: boolean;
  player?: Awaited<ReturnType<typeof resolveBackYourselfPlayerCard>>;
}> {
  const rows = await db
    .select({ puzzleJson: dailyPuzzles.puzzleJson, answerJson: dailyPuzzles.answerJson })
    .from(dailyPuzzles)
    .where(and(eq(dailyPuzzles.date, input.date), eq(dailyPuzzles.modeId, 'back_yourself')))
    .limit(1);
  const puzzle = rows[0]?.puzzleJson as BackYourselfPuzzlePublic | undefined;
  if (!puzzle?.category) {
    throw new Error('No Back Yourself puzzle for date');
  }

  const already = new Set(input.alreadyNamedIds ?? []);
  if (already.has(input.playerId)) {
    return { ok: true, correct: false, duplicate: true };
  }

  // Prefer the stored pool (clipped top-N) so maxPool and validation stay in lockstep.
  const answer = rows[0]?.answerJson as { validPlayerIds?: string[] } | undefined;
  const validIds = Array.isArray(answer?.validPlayerIds) ? answer.validPlayerIds : [];
  const correct =
    validIds.length > 0
      ? validIds.includes(input.playerId)
      : await playerMatchesBackYourselfCategory(
          input.playerId,
          puzzle.category as BackYourselfCategory
        );
  if (!correct) {
    return { ok: true, correct: false, duplicate: false };
  }
  const player = await resolveBackYourselfPlayerCard(input.playerId);
  return { ok: true, correct: true, duplicate: false, player: player ?? undefined };
}

export async function validateClubChainLink(
  fromId: string,
  toId: string,
  targetId?: string
): Promise<{
  link: import('./clubChainGenerator.js').TeammateLink | null;
  targetLink: import('./clubChainGenerator.js').TeammateLink | null;
}> {
  const link = await clubChainLink(fromId, toId);
  // Only bother checking the target link when the move itself is valid and a target was supplied
  // (and the candidate isn't already the target).
  const targetLink =
    link && targetId && targetId !== toId ? await clubChainLink(toId, targetId) : null;
  return { link, targetLink };
}

export async function startLastManStanding(userId: string, date: string, resumePicks: string[] = []) {
  return startLastManStandingRun(userId, date, resumePicks);
}

export async function validateLastManStandingCheck(
  userId: string,
  date: string,
  token: string,
  optionId: string
) {
  return submitLastManStandingAnswer(userId, date, token, optionId);
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

export async function getDailyBundle(userId: string, clientDate?: string): Promise<DailyBundle> {
  const date = resolveClientDailyDate(clientDate);
  await ensureDailyPuzzles(date);

  const puzzles = await db.select().from(dailyPuzzles).where(eq(dailyPuzzles.date, date));

  const games = BUNDLE_PUZZLE_MODES.flatMap((mode) => {
    const row = puzzles.find((puzzle) => puzzle.modeId === mode.modeId);
    if (!row) return [];
    return [
      {
        modeId: mode.modeId,
        title: mode.title,
        puzzle: sanitizePublicPuzzle(mode.modeId, row.puzzleJson) as DailyBundle['games'][0]['puzzle'],
      },
    ];
  });

  const completions = await db
    .select({
      modeId: dailyCompletions.modeId,
      score: dailyCompletions.score,
      guesses: dailyCompletions.guesses,
      won: dailyCompletions.won,
    })
    .from(dailyCompletions)
    .where(and(eq(dailyCompletions.userId, userId), eq(dailyCompletions.date, date)));

  const completedModeIds = completions.map((row) => row.modeId);
  const completionXpByMode = Object.fromEntries(
    completions.map((row) => [
      row.modeId,
      computeXp(row.modeId, row.score, row.guesses, row.won),
    ])
  );
  // "All done" is measured against the modes that ACTUALLY generated for the day — puzzle
  // generation is best-effort and can skip a mode, so requiring every theoretical mode would leave
  // the daily permanently incomplete when one is missing.
  const availableModes = DAILY_PLAYABLE_MODES.filter((modeId) => puzzles.some((p) => p.modeId === modeId));
  const allComplete =
    availableModes.length > 0 && availableModes.every((modeId) => completedModeIds.includes(modeId));

  return {
    date,
    alreadyPlayed: allComplete,
    completedModeIds,
    completionXpByMode,
    games,
  };
}

/** Strip secrets from puzzle JSON before shipping to clients. */
export function sanitizePublicPuzzle(modeId: string, puzzleJson: unknown): unknown {
  if (!puzzleJson || typeof puzzleJson !== 'object') return puzzleJson;

  if (modeId === 'draft_master') {
    const p = puzzleJson as Record<string, unknown>;
    const { optimalLineup: _omit, ...rest } = p;
    return rest;
  }

  if (modeId === 'one_more') {
    const p = puzzleJson as {
      rounds?: Array<{ options?: Array<Record<string, unknown>> }>;
      [key: string]: unknown;
    };
    if (!Array.isArray(p.rounds)) return puzzleJson;
    return {
      ...p,
      rounds: p.rounds.map((round) => ({
        ...round,
        options: (round.options ?? []).map(({ value: _v, ...opt }) => opt),
      })),
    };
  }

  if (modeId === 'darts_501') {
    return parseDarts501Puzzle(puzzleJson) ?? puzzleJson;
  }

  if (modeId === 'last_man_standing') {
    const puzzle = puzzleJson as {
      questions?: Array<{ type?: string; options?: unknown[]; [key: string]: unknown }>;
      [key: string]: unknown;
    };
    if (!Array.isArray(puzzle.questions)) return puzzleJson;
    return {
      ...puzzle,
      questions: puzzle.questions.map((question) =>
        question.type === 'custom_question'
          ? { ...question, options: [] }
          : question
      ),
    };
  }

  return puzzleJson;
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
    // The user's actual answer inputs (order/picks/etc.), used to recompute the score server-side.
    // Optional so older clients that only send an aggregate score still work.
    answer?: unknown;
  }
): Promise<DailyCompleteResponse> {
  // Client sends its local calendar day (NYT-style). Allow a small window for offline sync.
  if (!isAcceptableCompletionDate(input.date)) {
    throw new Error('Completion date is not the current daily');
  }

  const puzzle = await db
    .select()
    .from(dailyPuzzles)
    .where(and(eq(dailyPuzzles.date, input.date), eq(dailyPuzzles.modeId, input.modeId)))
    .limit(1);

  // Every mode is server-generated and shipped in the bundle — a completion for a puzzle that
  // doesn't exist means the client played something that wasn't the global daily.
  if (!puzzle[0]) {
    throw new Error('Daily puzzle not found');
  }

  // Server-authoritative scoring: when the client sends its answer inputs, recompute the score/won
  // from the stored puzzle so XP can't be fabricated. Otherwise clamp the client's reported score
  // to a plausible bound. XP, the stored completion and the league ledger all use these values.
  const effective = await resolveCompletionScore(input.modeId, puzzle[0], input);
  const effectiveScore = effective.score;
  const effectiveWon = effective.won;

  const xpEarned = computeXp(input.modeId, effectiveScore, input.guesses, effectiveWon);

  // The unique index on (user_id, date, mode_id) makes this the single source of truth for
  // "already completed" — concurrent requests race here and exactly one row wins.
  const inserted = await db
    .insert(dailyCompletions)
    .values({
      userId,
      date: input.date,
      modeId: input.modeId,
      score: effectiveScore,
      guesses: input.guesses,
      won: effectiveWon,
      shareGrid: input.shareGrid,
    })
    .onConflictDoNothing({
      target: [dailyCompletions.userId, dailyCompletions.date, dailyCompletions.modeId],
    })
    .returning({ id: dailyCompletions.id });

  if (inserted.length === 0) {
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

  const progressRows = await db
    .select()
    .from(userProgress)
    .where(eq(userProgress.userId, userId))
    .limit(1);
  const progress = progressRows[0]!;

  const playDate = input.date;
  // Day streak only advances when every available daily mode for this date is done —
  // partial play still banks XP, but does not count as a streak day.
  const dayFullyCleared = await hasClearedDaily(userId, playDate);
  let newStreak = progress.streak;
  let lastPlayedDate = progress.lastPlayedDate;

  if (dayFullyCleared && lastPlayedDate !== playDate) {
    if (lastPlayedDate === previousDay(playDate)) {
      newStreak = progress.streak + 1;
    } else {
      newStreak = 1;
    }
    lastPlayedDate = playDate;
  }

  const todayXp = progress.todayXpDate === playDate ? progress.todayXp + xpEarned : xpEarned;
  const newXp = progress.xp + xpEarned;
  const newLevel = computeLevel(newXp);

  await db
    .update(userProgress)
    .set({
      xp: newXp,
      level: newLevel,
      streak: newStreak,
      lastPlayedDate,
      todayXp,
      todayXpDate: playDate,
    })
    .where(eq(userProgress.userId, userId));

  // Feed the league system: append to the XP ledger and sync weekly pyramid XP/table.
  const ledgerWrote = await recordXp(userId, input.modeId, xpEarned, input.date);
  if (ledgerWrote || xpEarned > 0) {
    await syncWeeklyLeagueAfterXp(userId, input.date);
  }

  const response: DailyCompleteResponse = {
    xpEarned,
    newXp,
    newLevel,
    streak: newStreak,
    todayXp,
  };

  // Draft XI: perfect lineup is stripped from the live puzzle — reveal it only after completion.
  if (input.modeId === 'draft_master') {
    const draft = puzzle[0].puzzleJson as {
      optimalLineup?: DailyCompleteResponse['optimalLineup'];
      optimalScore?: number;
    };
    if (Array.isArray(draft.optimalLineup)) {
      response.optimalLineup = draft.optimalLineup;
    }
    if (typeof draft.optimalScore === 'number') {
      response.optimalScore = draft.optimalScore;
    }
  }

  return response;
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
 * Hint priority: reveal CLUB first, then NATIONALITY. If both are already known there's nothing
 * useful left, so return an empty hint (the client hides the button). The client renders the
 * returned field as a green "hint" row.
 */
export async function guessWhoHint(
  date: string,
  known: string[]
): Promise<{ field: GuessWhoField; value: string | number } | { field: null; value: null }> {
  const answer = await loadGuessWhoAnswer(date);
  const field: GuessWhoField | null = !known.includes('club')
    ? 'club'
    : !known.includes('nationality')
      ? 'nationality'
      : null;
  if (field === null) return { field: null, value: null };
  return { field, value: guessWhoAttributes(answer)[field] };
}

export { todayUTC, GAME_MODES, generateDailyPuzzleForMode };
