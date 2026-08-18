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

export const VS_MAX_PLAYERS = 5;

export function isVsModeId(value: string): value is VsModeId {
  return (VS_MODE_IDS as readonly string[]).includes(value);
}

export type VsGeneratedPuzzle = {
  puzzle: unknown;
  answer: unknown;
};

export async function generateVsPuzzle(modeId: VsModeId, seedKey: string): Promise<VsGeneratedPuzzle> {
  const today = new Date().toISOString().slice(0, 10);

  switch (modeId) {
    case 'draft_master': {
      const puzzle = await generateBattlePuzzleFromSeed(seedKey);
      if (!puzzle) {
        throw new Error('Could not generate a Draft XI challenge right now. Try again.');
      }
      return { puzzle, answer: null };
    }
    case 'back_yourself': {
      const generated = await generateBackYourselfPuzzle(today, { seedKey });
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
