import { desc, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { dailyPuzzles } from '../db/schema.js';
import { generateBattlePuzzleFromSeed, type BattlePuzzleJson } from './battleGenerator.js';
import { generateBackYourselfPuzzle } from './backYourselfGenerator.js';
import { generateDarts501Puzzle } from './darts501Generator.js';
import { generateTargetManPuzzle } from './dailyPuzzleGenerator.js';
import type { DailyFactPack } from './dailyPuzzleTypes.js';

export const VS_MODE_IDS = ['draft_master', 'back_yourself', 'darts_501', 'target_man'] as const;
export type VsModeId = (typeof VS_MODE_IDS)[number];

export const VS_MODE_TITLES: Record<VsModeId, string> = {
  draft_master: 'DRAFT XI',
  back_yourself: 'BACK YOURSELF',
  darts_501: 'FOOTBALL 501',
  target_man: 'TARGET MAN',
};

export const VS_MAX_PLAYERS = 4;

export function isVsModeId(value: string): value is VsModeId {
  return (VS_MODE_IDS as readonly string[]).includes(value);
}

export type VsGeneratedPuzzle = {
  puzzle: unknown;
  answer: unknown;
};

function hashSeed(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (h << 5) - h + input.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function backYourselfPoolSize(puzzle: unknown, answer: unknown): number {
  const p = puzzle && typeof puzzle === 'object' ? (puzzle as { maxPool?: number }) : {};
  if (typeof p.maxPool === 'number') return p.maxPool;
  const ids = answer && typeof answer === 'object'
    ? (answer as { validPlayerIds?: unknown }).validPlayerIds
    : null;
  return Array.isArray(ids) ? ids.length : 0;
}

/** Fallback only: last-resort reuse of a stored daily if live generation fails. */
async function storedDailyPuzzle(
  modeId: VsModeId,
  seedKey: string,
  excludeTitle?: string
): Promise<VsGeneratedPuzzle | null> {
  const rows = await db
    .select({
      puzzleJson: dailyPuzzles.puzzleJson,
      answerJson: dailyPuzzles.answerJson,
    })
    .from(dailyPuzzles)
    .where(eq(dailyPuzzles.modeId, modeId))
    .orderBy(desc(dailyPuzzles.date))
    .limit(45);

  if (rows.length === 0) return null;

  let pool = rows;
  if (modeId === 'back_yourself') {
    const wide = rows.filter((row) => backYourselfPoolSize(row.puzzleJson, row.answerJson) >= 40);
    if (wide.length > 0) pool = wide;
  }
  if (excludeTitle) {
    const different = pool.filter((row) => vsPuzzleMeta(modeId, row.puzzleJson).title !== excludeTitle);
    if (different.length > 0) pool = different;
  }

  const chosen = pool[hashSeed(seedKey) % pool.length]!;
  return { puzzle: chosen.puzzleJson, answer: chosen.answerJson };
}

async function generateFreshVsPuzzle(
  modeId: VsModeId,
  seedKey: string,
  excludeTitle?: string
): Promise<VsGeneratedPuzzle> {
  const today = new Date().toISOString().slice(0, 10);
  let last: VsGeneratedPuzzle | null = null;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const key = attempt === 0 ? seedKey : `${seedKey}:${attempt}`;
    const generated = await generateFreshVsPuzzleOnce(modeId, today, key);
    last = generated;
    if (!excludeTitle || vsPuzzleMeta(modeId, generated.puzzle).title !== excludeTitle) {
      return generated;
    }
  }
  if (last) return last;
  throw new Error('Could not generate a VS challenge right now. Try again.');
}

async function generateFreshVsPuzzleOnce(
  modeId: VsModeId,
  today: string,
  seedKey: string
): Promise<VsGeneratedPuzzle> {
  switch (modeId) {
    case 'draft_master': {
      const puzzle = await generateBattlePuzzleFromSeed(seedKey);
      if (!puzzle) {
        throw new Error('Could not generate a Draft XI challenge right now. Try again.');
      }
      return { puzzle, answer: null };
    }
    case 'back_yourself': {
      const generated = await generateBackYourselfPuzzle(today, { seedKey, minPool: 40 });
      if (!generated) {
        throw new Error('Could not generate a Back Yourself challenge right now. Try again.');
      }
      return { puzzle: generated.puzzle, answer: generated.answer };
    }
    case 'darts_501': {
      const generated = await generateDarts501Puzzle(today, { seedKey });
      if (!generated) {
        throw new Error('Could not generate a Football 501 challenge right now. Try again.');
      }
      return { puzzle: generated.puzzle, answer: generated.answer };
    }
    case 'target_man': {
      const generated = await generateTargetManPuzzle(today, {} as DailyFactPack, { seedKey });
      return { puzzle: generated.puzzleJson, answer: generated.answerJson };
    }
  }
}

export async function generateVsPuzzle(
  modeId: VsModeId,
  seedKey: string,
  opts?: { excludeTitle?: string }
): Promise<VsGeneratedPuzzle> {
  try {
    return await generateFreshVsPuzzle(modeId, seedKey, opts?.excludeTitle);
  } catch {
    const stored = await storedDailyPuzzle(modeId, seedKey, opts?.excludeTitle);
    if (stored) return stored;
    throw new Error('Could not generate a VS challenge right now. Try again.');
  }
}

export function vsPuzzleMeta(modeId: string, puzzle: unknown): { modeTitle: string; title: string; scoreNoun: string } {
  const modeTitle = VS_MODE_TITLES[modeId as VsModeId] ?? modeId.replace(/_/g, ' ').toUpperCase();
  const p = puzzle && typeof puzzle === 'object' ? (puzzle as Record<string, unknown>) : {};

  if (modeId === 'draft_master') {
    const battle = puzzle as BattlePuzzleJson | null;
    return {
      modeTitle,
      title: battle?.category?.title ?? 'Draft XI',
      scoreNoun: battle?.category?.noun ?? 'pts',
    };
  }
  if (modeId === 'back_yourself') {
    const category = p.category as { label?: string } | undefined;
    return { modeTitle, title: category?.label ?? 'Back Yourself', scoreNoun: 'named' };
  }
  if (modeId === 'target_man') {
    return {
      modeTitle,
      title: typeof p.categoryLabel === 'string' ? p.categoryLabel : 'Target Man',
      scoreNoun: typeof p.offNoun === 'string' ? p.offNoun : 'off',
    };
  }
  if (modeId === 'darts_501') {
    return {
      modeTitle,
      title: typeof p.formulaLabel === 'string' ? p.formulaLabel : 'Football 501',
      scoreNoun: 'left',
    };
  }
  return { modeTitle, title: modeTitle, scoreNoun: 'pts' };
}
