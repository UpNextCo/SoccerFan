import { and, eq, isNotNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { dailyPuzzles, players } from '../db/schema.js';
import { INGEST_LEAGUES } from '../jobs/ingest-config.js';
import {
  blindRankCategoryTitle,
  blindRankPoolForCategory,
  buildDailyFactPack,
  metricForTargetCategory,
  targetCategoryLabel,
  topPlayersByLeagueMetric,
} from './dailyFactPack.js';
import type {
  BlindRankStatCategory,
  DailyFactPack,
  FactPackPlayer,
  GeneratedDailyPuzzle,
  TargetManStatCategory,
} from './dailyPuzzleTypes.js';
import {
  PuzzleValidationError,
  validateBlindRankSelection,
  validateGeneratedPuzzle,
  validateTargetManPuzzle,
} from './puzzleValidator.js';

const DAILY_MODES = ['guess_who', 'target_man', 'blind_rank'] as const;

const TARGET_MAN_CATEGORIES: TargetManStatCategory[] = ['goals', 'assists', 'appearances'];

const BLIND_RANK_CATEGORIES: BlindRankStatCategory[] = [
  'premier_league_goals',
  'premier_league_assists',
  'premier_league_appearances',
];

function hashString(input: string): number {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function seededShuffle<T>(array: T[], seed: number): T[] {
  const result = [...array];
  let state = BigInt(seed === 0 ? 1 : seed);

  for (let index = result.length - 1; index > 0; index -= 1) {
    state = (state * 6364136223846793005n + 1n) & ((1n << 64n) - 1n);
    const swapIndex = Number(state % BigInt(index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex]!, result[index]!];
  }

  return result;
}

function roundTarget(value: number, category: TargetManStatCategory): number {
  if (category === 'minutesPlayed') {
    return Math.max(500, Math.round(value / 50) * 50);
  }
  return Math.max(5, Math.round(value / 5) * 5);
}

function pickBlindRankPlayers(pool: FactPackPlayer[], seed: number) {
  if (pool.length < 5) {
    throw new PuzzleValidationError('Not enough players in fact pack for blind rank');
  }

  let bestStart = 0;
  let bestSpread = -1;

  for (let start = 0; start <= pool.length - 5; start += 1) {
    const window = pool.slice(start, start + 8);
    for (let offset = 0; offset <= window.length - 5; offset += 1) {
      const candidate = window.slice(offset, offset + 5);
      const values = candidate.map((player) => player.statValue);
      const spread = values[0]! - values[values.length - 1]!;
      const hasTies = new Set(values).size !== values.length;
      if (!hasTies && spread > bestSpread) {
        bestSpread = spread;
        bestStart = start + offset;
      }
    }
  }

  const selected =
    bestSpread >= 8
      ? pool.slice(bestStart, bestStart + 5)
      : pool.slice((seed / 13) % Math.max(pool.length - 5, 1), ((seed / 13) % Math.max(pool.length - 5, 1)) + 5);

  return validateBlindRankSelection(selected);
}

export async function generateGuessWhoPuzzle(
  date: string,
  factPack: DailyFactPack
): Promise<GeneratedDailyPuzzle> {
  if (factPack.playerCount === 0) {
    throw new PuzzleValidationError('No players available for Guess Who');
  }

  const eligible = await db.select().from(players).where(isNotNull(players.externalId));
  const index = hashString(`${date}:guess_who`) % Math.max(eligible.length, 1);
  const answerPlayer = eligible[index]!;

  const puzzleJson = {
    modeId: 'guess_who' as const,
    puzzleId: `${date}-guess_who`,
    date,
    maxGuesses: 8,
    maxScore: 100,
  };

  return {
    modeId: 'guess_who',
    puzzleJson,
    answerPlayerId: answerPlayer.id,
    answerJson: { modeId: 'guess_who', answerPlayerId: answerPlayer.id },
  };
}

export async function generateTargetManPuzzle(
  date: string,
  _factPack: DailyFactPack
): Promise<GeneratedDailyPuzzle> {
  const seed = hashString(`${date}:target_man`);
  const league = INGEST_LEAGUES[seed % INGEST_LEAGUES.length]!;
  const category = TARGET_MAN_CATEGORIES[Math.floor((seed / 7) % TARGET_MAN_CATEGORIES.length)]!;
  const metric = metricForTargetCategory(category);

  const ranked = await topPlayersByLeagueMetric(league.id, metric, 1, 25);
  if (ranked.length < 5) {
    throw new PuzzleValidationError(`Not enough stat rows for Target Man (${league.name} ${category})`);
  }

  const middle = ranked.slice(4, 14);
  const sample = middle.length >= 5 ? middle : ranked.slice(0, 5);
  const pickOffset = seed % Math.max(sample.length - 4, 1);
  const chosen = sample.slice(pickOffset, pickOffset + 5);
  const combined = chosen.reduce((sum, player) => sum + player.statValue, 0);
  const target = roundTarget(combined, category);

  validateTargetManPuzzle({ leagueId: league.id, category, target });

  const puzzleJson = {
    modeId: 'target_man' as const,
    puzzleId: `${date}-target_man`,
    date,
    league: league.name,
    leagueId: league.id,
    category,
    categoryLabel: targetCategoryLabel(category),
    target,
    title: `${league.name} ${targetCategoryLabel(category)}`,
  };

  return {
    modeId: 'target_man',
    puzzleJson,
    answerPlayerId: null,
    answerJson: {
      modeId: 'target_man',
      answer: { leagueId: league.id, category, target },
    },
  };
}

export async function generateBlindRankPuzzle(
  date: string,
  factPack: DailyFactPack
): Promise<GeneratedDailyPuzzle> {
  const seed = hashString(`${date}:blind_rank`);
  const category = BLIND_RANK_CATEGORIES[seed % BLIND_RANK_CATEGORIES.length]!;
  const pool = blindRankPoolForCategory(factPack, category);
  const answer = pickBlindRankPlayers(pool, seed);

  const byId = new Map(pool.map((player) => [player.playerId, player]));
  const presentationSource = answer.correctRanking
    .map((playerId) => byId.get(playerId))
    .filter((player): player is FactPackPlayer => Boolean(player));

  const presentationOrder = seededShuffle(presentationSource, seed ^ 0x9e37).map((player) => ({
    id: player.playerId,
    name: player.name,
    club: player.club,
    league: player.league,
    nationality: player.nationality,
    position: player.position,
  }));

  const puzzleJson = {
    modeId: 'blind_rank' as const,
    puzzleId: `${date}-blind_rank`,
    date,
    category,
    categoryTitle: blindRankCategoryTitle(category),
    rankHint: 'Most → least',
    presentationOrder,
  };

  return {
    modeId: 'blind_rank',
    puzzleJson,
    answerPlayerId: answer.correctRanking[0] ?? null,
    answerJson: {
      modeId: 'blind_rank',
      answer,
    },
  };
}

export async function generateDailyPuzzleForMode(
  date: string,
  modeId: (typeof DAILY_MODES)[number],
  factPack?: DailyFactPack
): Promise<GeneratedDailyPuzzle> {
  const existing = await db
    .select()
    .from(dailyPuzzles)
    .where(and(eq(dailyPuzzles.date, date), eq(dailyPuzzles.modeId, modeId)))
    .limit(1);

  if (existing[0]) {
    return {
      modeId,
      puzzleJson: existing[0].puzzleJson as GeneratedDailyPuzzle['puzzleJson'],
      answerPlayerId: existing[0].answerPlayerId,
      answerJson: (existing[0].answerJson as GeneratedDailyPuzzle['answerJson']) ?? null,
    };
  }

  const pack = factPack ?? (await buildDailyFactPack(date));

  let generated: GeneratedDailyPuzzle;
  switch (modeId) {
    case 'guess_who':
      generated = await generateGuessWhoPuzzle(date, pack);
      break;
    case 'target_man':
      generated = await generateTargetManPuzzle(date, pack);
      break;
    case 'blind_rank':
      generated = await generateBlindRankPuzzle(date, pack);
      break;
    default:
      throw new PuzzleValidationError(`Unsupported mode: ${modeId}`);
  }

  await validateGeneratedPuzzle(generated);

  await db.insert(dailyPuzzles).values({
    date,
    modeId,
    puzzleJson: generated.puzzleJson,
    answerPlayerId: generated.answerPlayerId,
    answerJson: generated.answerJson,
  });

  console.log(`Generated ${modeId} puzzle for ${date}`);
  return generated;
}

export async function generateAllDailyPuzzles(date: string): Promise<void> {
  const factPack = await buildDailyFactPack(date);

  for (const modeId of DAILY_MODES) {
    try {
      await generateDailyPuzzleForMode(date, modeId, factPack);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Skipped ${modeId} for ${date}: ${message}`);
    }
  }
}

export { DAILY_MODES };
