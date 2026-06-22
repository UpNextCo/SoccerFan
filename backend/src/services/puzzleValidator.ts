import { inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { players } from '../db/schema.js';
import type {
  DailyPuzzleAnswer,
  DailyPuzzlePublic,
  FactPackPlayer,
  GeneratedDailyPuzzle,
  TargetManStatCategory,
} from './dailyPuzzleTypes.js';

export class PuzzleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PuzzleValidationError';
  }
}

async function assertPlayersExist(playerIds: string[]): Promise<void> {
  const unique = [...new Set(playerIds)];
  if (unique.length === 0) {
    throw new PuzzleValidationError('No players in puzzle');
  }

  const rows = await db
    .select({ id: players.id })
    .from(players)
    .where(inArray(players.id, unique));

  if (rows.length !== unique.length) {
    throw new PuzzleValidationError('One or more puzzle players were not found');
  }
}

function assertStrictDescending(values: number[], minSpread: number): void {
  for (let index = 0; index < values.length - 1; index += 1) {
    const current = values[index]!;
    const next = values[index + 1]!;
    if (current <= next) {
      throw new PuzzleValidationError('Ranking contains ties or wrong order');
    }
  }

  const spread = values[0]! - values[values.length - 1]!;
  if (spread < minSpread) {
    throw new PuzzleValidationError(`Ranking spread ${spread} below minimum ${minSpread}`);
  }
}

export function validateBlindRankSelection(
  selected: FactPackPlayer[],
  minSpread = 8
): { correctRanking: string[]; statValues: Record<string, number> } {
  if (selected.length !== 5) {
    throw new PuzzleValidationError('Blind rank requires exactly 5 players');
  }

  const ids = selected.map((player) => player.playerId);
  if (new Set(ids).size !== ids.length) {
    throw new PuzzleValidationError('Blind rank players must be unique');
  }

  const sorted = [...selected].sort((a, b) => {
    if (a.statValue === b.statValue) return a.name.localeCompare(b.name);
    return b.statValue - a.statValue;
  });

  assertStrictDescending(
    sorted.map((player) => player.statValue),
    minSpread
  );

  const statValues = Object.fromEntries(selected.map((player) => [player.playerId, player.statValue]));

  return {
    correctRanking: sorted.map((player) => player.playerId),
    statValues,
  };
}

export function validateTargetManPuzzle(input: {
  leagueId: number;
  category: TargetManStatCategory;
  target: number;
}): void {
  if (input.leagueId <= 0) {
    throw new PuzzleValidationError('Invalid league id');
  }
  if (input.target <= 0) {
    throw new PuzzleValidationError('Target must be positive');
  }

  const maxByCategory: Record<TargetManStatCategory, number> = {
    goals: 1200,
    assists: 600,
    appearances: 600,
    yellowCards: 200,
    redCards: 30,
    cleanSheets: 200,
    minutesPlayed: 50_000,
    saves: 1500,
    foulsCommitted: 400,
    tacklesWon: 800,
  };

  if (input.target > maxByCategory[input.category]) {
    throw new PuzzleValidationError('Target exceeds plausible range');
  }
}

export async function validateGeneratedPuzzle(puzzle: GeneratedDailyPuzzle): Promise<void> {
  const publicJson = puzzle.puzzleJson as DailyPuzzlePublic;

  switch (publicJson.modeId) {
    case 'guess_who': {
      if (!puzzle.answerPlayerId) {
        throw new PuzzleValidationError('Guess Who requires answerPlayerId');
      }
      await assertPlayersExist([puzzle.answerPlayerId]);
      return;
    }
    case 'target_man': {
      validateTargetManPuzzle({
        leagueId: publicJson.leagueId,
        category: publicJson.category,
        target: publicJson.target,
      });
      if (!puzzle.answerJson || puzzle.answerJson.modeId !== 'target_man') {
        throw new PuzzleValidationError('Target Man requires answer payload');
      }
      return;
    }
    case 'blind_rank': {
      const playerIds = publicJson.presentationOrder.map((player) => player.id);
      if (playerIds.length !== 5) {
        throw new PuzzleValidationError('Blind rank requires 5 presentation players');
      }
      await assertPlayersExist(playerIds);

      if (!puzzle.answerJson || puzzle.answerJson.modeId !== 'blind_rank') {
        throw new PuzzleValidationError('Blind rank requires answer payload');
      }

      const answer = puzzle.answerJson.answer;
      if (answer.correctRanking.length !== 5) {
        throw new PuzzleValidationError('Blind rank answer must contain 5 ids');
      }

      await assertPlayersExist(answer.correctRanking);
      const values = answer.correctRanking.map((playerId) => answer.statValues[playerId] ?? -1);
      assertStrictDescending(values, 8);
      return;
    }
    default:
      throw new PuzzleValidationError(`Unsupported mode: ${(publicJson as { modeId: string }).modeId}`);
  }
}

export function isDailyPuzzleAnswer(value: unknown): value is DailyPuzzleAnswer {
  if (!value || typeof value !== 'object') return false;
  return 'modeId' in value;
}
