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

export const BLIND_RANK_SLOT_COUNT = 10;

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
  count = BLIND_RANK_SLOT_COUNT,
  minSpread = Math.max(8, count - 1)
): { correctRanking: string[]; statValues: Record<string, number> } {
  if (selected.length !== count) {
    throw new PuzzleValidationError(`Blind rank requires exactly ${count} players`);
  }

  const ids = selected.map((player) => player.playerId);
  if (new Set(ids).size !== ids.length) {
    throw new PuzzleValidationError('Blind rank players must be unique');
  }

  const sorted = [...selected].sort((a, b) => {
    if (a.statValue === b.statValue) return a.name.localeCompare(b.name);
    return b.statValue - a.statValue;
  });

  // Strictly descending guarantees there are no tied stat values, so every
  // player "applies to the category in a varying amount".
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

  // Targets are the COMBINED career total of 5 players, so these are sanity
  // ceilings for a 5-player sum (not per-player limits).
  const maxByCategory: Record<TargetManStatCategory, number> = {
    goals: 1_500,
    assists: 900,
    appearances: 3_500,
    yellowCards: 900,
    redCards: 200,
    cleanSheets: 1_200,
    minutesPlayed: 350_000,
    saves: 5_000,
    foulsCommitted: 4_000,
    tacklesWon: 5_000,
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
      if (playerIds.length !== BLIND_RANK_SLOT_COUNT) {
        throw new PuzzleValidationError(
          `Blind rank requires ${BLIND_RANK_SLOT_COUNT} presentation players`
        );
      }
      await assertPlayersExist(playerIds);

      const presentationValues = publicJson.presentationOrder.map((player) => player.statValue);
      if (presentationValues.some((value) => typeof value !== 'number')) {
        throw new PuzzleValidationError('Blind rank presentation players must include statValue');
      }
      if (new Set(presentationValues).size !== presentationValues.length) {
        throw new PuzzleValidationError('Blind rank presentation values must be unique');
      }

      if (!puzzle.answerJson || puzzle.answerJson.modeId !== 'blind_rank') {
        throw new PuzzleValidationError('Blind rank requires answer payload');
      }

      const answer = puzzle.answerJson.answer;
      if (answer.correctRanking.length !== BLIND_RANK_SLOT_COUNT) {
        throw new PuzzleValidationError(
          `Blind rank answer must contain ${BLIND_RANK_SLOT_COUNT} ids`
        );
      }

      await assertPlayersExist(answer.correctRanking);
      const values = answer.correctRanking.map((playerId) => answer.statValues[playerId] ?? -1);
      assertStrictDescending(values, Math.max(8, BLIND_RANK_SLOT_COUNT - 1));
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
