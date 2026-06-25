import { and, eq, isNotNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { dailyPuzzles, players } from '../db/schema.js';
import { INGEST_LEAGUES } from '../jobs/ingest-config.js';
import {
  buildDailyFactPack,
  metricForTargetCategory,
  targetCategoryLabel,
  topPlayersByLeagueMetric,
} from './dailyFactPack.js';
import type {
  DailyFactPack,
  FactPackPlayer,
  GeneratedDailyPuzzle,
  TargetManStatCategory,
} from './dailyPuzzleTypes.js';
import type { StatMetric } from './statsService.js';
import {
  BLIND_RANK_SLOT_COUNT,
  PuzzleValidationError,
  validateBlindRankSelection,
  validateGeneratedPuzzle,
  validateTargetManPuzzle,
} from './puzzleValidator.js';

const DAILY_MODES = ['guess_who', 'target_man', 'blind_rank'] as const;

const TARGET_MAN_CATEGORIES: TargetManStatCategory[] = ['goals', 'assists', 'appearances'];

interface BlindRankCategoryDef {
  id: string;
  leagueId: number;
  metric: StatMetric;
  /** Minimum career total to enter the pool (keeps the long tail of 0/1 out). */
  min: number;
  title: string;
  valueNoun: string;
  valuePrefix: string;
  rankHint: string;
}

/** How many of the top distinct-value players we sample the 10 slots from. Keeps
 *  the puzzle recognisable while still leaving a clear gradient between players. */
const BLIND_RANK_SAMPLE_RANGE = 36;

function plMetric(
  leagueId: number,
  league: string,
  metric: StatMetric,
  min: number,
  noun: string
): BlindRankCategoryDef {
  const metricLabel = metric === 'appearances' ? 'Appearances' : metric === 'assists' ? 'Assists' : 'Goals';
  return {
    id: `${league.toLowerCase().replace(/\s+/g, '_')}_${metric}`,
    leagueId,
    metric,
    min,
    title: `${league} ${metricLabel}`,
    valueNoun: noun,
    valuePrefix: '',
    rankHint: 'Most → least',
  };
}

const BLIND_RANK_LEAGUES: Array<{ id: number; name: string }> = [
  { id: 39, name: 'Premier League' },
  { id: 140, name: 'La Liga' },
  { id: 135, name: 'Serie A' },
  { id: 78, name: 'Bundesliga' },
  { id: 61, name: 'Ligue 1' },
];

const BLIND_RANK_CATEGORIES: BlindRankCategoryDef[] = [
  ...BLIND_RANK_LEAGUES.flatMap((league) => [
    plMetric(league.id, league.name, 'goals', 5, 'goals'),
    plMetric(league.id, league.name, 'assists', 3, 'assists'),
    plMetric(league.id, league.name, 'appearances', 20, 'apps'),
  ]),
  plMetric(2, 'Champions League', 'goals', 3, 'goals'),
  plMetric(2, 'Champions League', 'assists', 2, 'assists'),
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

interface BlindRankSelection {
  players: FactPackPlayer[];
  correctRanking: string[];
  statValues: Record<string, number>;
}

/**
 * Pick {@link BLIND_RANK_SLOT_COUNT} players that form a clear, evenly spread
 * gradient for the category. Returns null (instead of throwing) when the pool is
 * too thin, so the caller can try another category.
 */
function pickBlindRankPlayers(pool: FactPackPlayer[], seed: number): BlindRankSelection | null {
  // Pool arrives sorted desc by statValue. Keep one player per distinct value so
  // there are never ties — every player "applies in a varying amount".
  const distinct: FactPackPlayer[] = [];
  const seenValues = new Set<number>();
  for (const player of pool) {
    if (!seenValues.has(player.statValue)) {
      seenValues.add(player.statValue);
      distinct.push(player);
    }
  }

  if (distinct.length < BLIND_RANK_SLOT_COUNT) return null;

  // Sample evenly across the most recognisable slice, with a per-slot seed jitter
  // so the daily puzzle varies without clustering the values.
  const range = Math.min(distinct.length, BLIND_RANK_SAMPLE_RANGE);
  const step = range / BLIND_RANK_SLOT_COUNT;
  const chosen: FactPackPlayer[] = [];
  let lastIndex = -1;

  for (let i = 0; i < BLIND_RANK_SLOT_COUNT; i += 1) {
    const base = Math.floor(i * step);
    const jitterSpan = Math.max(1, Math.floor(step));
    const jitter = Math.floor(seed / (i + 7)) % jitterSpan;
    let index = Math.min(range - 1, base + jitter);
    if (index <= lastIndex) index = lastIndex + 1;
    if (index >= range) break;
    chosen.push(distinct[index]!);
    lastIndex = index;
  }

  // If jitter collisions ran us off the end, fall back to a clean even slice.
  if (chosen.length !== BLIND_RANK_SLOT_COUNT) {
    chosen.length = 0;
    for (let i = 0; i < BLIND_RANK_SLOT_COUNT; i += 1) {
      chosen.push(distinct[Math.min(range - 1, Math.floor(i * step))]!);
    }
  }

  try {
    const { correctRanking, statValues } = validateBlindRankSelection(chosen);
    const byId = new Map(chosen.map((player) => [player.playerId, player]));
    const players = correctRanking
      .map((id) => byId.get(id))
      .filter((player): player is FactPackPlayer => Boolean(player));
    return { players, correctRanking, statValues };
  } catch {
    return null;
  }
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
  _factPack: DailyFactPack
): Promise<GeneratedDailyPuzzle> {
  const seed = hashString(`${date}:blind_rank`);
  const startIndex = seed % BLIND_RANK_CATEGORIES.length;

  // Rotate categories by date, then walk the list so a thin pool for one
  // league/metric falls through to the next instead of failing the whole mode.
  for (let offset = 0; offset < BLIND_RANK_CATEGORIES.length; offset += 1) {
    const category = BLIND_RANK_CATEGORIES[(startIndex + offset) % BLIND_RANK_CATEGORIES.length]!;
    const pool = await topPlayersByLeagueMetric(category.leagueId, category.metric, category.min, 60);
    const selection = pickBlindRankPlayers(pool, seed);
    if (!selection) continue;

    const presentationOrder = seededShuffle(selection.players, seed ^ 0x9e37).map((player) => ({
      id: player.playerId,
      name: player.name,
      club: player.club,
      league: player.league,
      nationality: player.nationality,
      position: player.position,
      statValue: player.statValue,
    }));

    const puzzleJson = {
      modeId: 'blind_rank' as const,
      puzzleId: `${date}-blind_rank`,
      date,
      category: category.id,
      categoryTitle: category.title,
      rankHint: category.rankHint,
      valueNoun: category.valueNoun,
      valuePrefix: category.valuePrefix,
      presentationOrder,
    };

    return {
      modeId: 'blind_rank',
      puzzleJson,
      answerPlayerId: selection.correctRanking[0] ?? null,
      answerJson: {
        modeId: 'blind_rank',
        answer: {
          correctRanking: selection.correctRanking,
          statValues: selection.statValues,
        },
      },
    };
  }

  throw new PuzzleValidationError('No blind rank category had enough players');
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
