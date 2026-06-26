import { and, eq, isNotNull, sql } from 'drizzle-orm';
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
  GeneratedDailyPuzzle,
  TargetManStatCategory,
} from './dailyPuzzleTypes.js';
import {
  PuzzleValidationError,
  validateGeneratedPuzzle,
  validateTargetManPuzzle,
} from './puzzleValidator.js';
import { generateBlindRankPuzzle as generateThemedBlindRank } from './blindRankGenerator.js';

const DAILY_MODES = ['guess_who', 'target_man', 'blind_rank'] as const;

/** Competitions for Target Man — big-5 plus continental cups (stats under ids 2/3). */
const TARGET_MAN_COMPETITIONS: Array<{ id: number; name: string }> = [
  ...INGEST_LEAGUES.map((l) => ({ id: l.id, name: l.name })),
  { id: 2, name: 'Champions League' },
  { id: 3, name: 'Europa League' },
];

/** Data-backed, scorable categories (clean sheets has no data; red cards too sparse). */
const TARGET_MAN_CATEGORIES: TargetManStatCategory[] = [
  'goals',
  'assists',
  'appearances',
  'minutesPlayed',
  'yellowCards',
  'tacklesWon',
  'foulsCommitted',
  'saves',
];

function hashString(input: string): number {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

/** Whole days since the Unix epoch for a YYYY-MM-DD date (UTC). */
function dayNumber(date: string): number {
  const ms = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.floor(ms / 86_400_000) : 0;
}

function roundTarget(value: number, category: TargetManStatCategory): number {
  if (category === 'minutesPlayed') {
    return Math.max(500, Math.round(value / 50) * 50);
  }
  return Math.max(5, Math.round(value / 5) * 5);
}

export async function generateGuessWhoPuzzle(
  date: string,
  factPack: DailyFactPack
): Promise<GeneratedDailyPuzzle> {
  if (factPack.playerCount === 0) {
    throw new PuzzleValidationError('No players available for Guess Who');
  }

  // The answer must be recognisable AND CURRENTLY ACTIVE. We require recent big-5 minutes
  // (season >= 2024): that keeps the deduction attributes (club/league/age) current AND drops
  // retired players whose stale `current_league` would otherwise leak them in (e.g. Koscielny,
  // David Silva). Within that, gate by a PRESTIGE score (value tier + major finals + individual
  // awards, like Blind Rank) so it's a known name, and order by prestige so the pool is the ~500
  // most recognisable current players — good variety, never an obscure random.
  const PRESTIGE = sql`(p.market_value_tier * 10 + LEAST(COALESCE(fa.finals, 0), 6) * 4 + LEAST(COALESCE(aw.awards, 0), 4) * 6)`;
  const poolRows = (await db.execute(sql`
    WITH recent AS (
      SELECT player_id, SUM(appearances)::int AS a
      FROM player_stats WHERE league_id IN (39, 140, 135, 78, 61) AND season >= 2024
      GROUP BY player_id
    ),
    fa AS (SELECT player_id, COUNT(*) AS finals FROM final_appearances GROUP BY player_id),
    aw AS (SELECT player_id, COUNT(*) AS awards FROM player_awards GROUP BY player_id)
    SELECT p.id, ${PRESTIGE} AS prestige
    FROM players p
      JOIN recent r ON r.player_id = p.id AND r.a >= 10
      LEFT JOIN fa ON fa.player_id = p.id
      LEFT JOIN aw ON aw.player_id = p.id
    WHERE p.external_id IS NOT NULL
      AND p.current_league IN ('Premier League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1')
      AND p.foot IS NOT NULL
      AND ${PRESTIGE} >= 40
    ORDER BY prestige DESC, r.a DESC, p.id
    LIMIT 500
  `)) as unknown as Array<{ id: string }>;

  let ids = poolRows.map((row) => row.id);
  if (ids.length === 0) {
    // Safe fallback: the most valuable currently-active big-5 players — NEVER an obscure random.
    const fb = (await db.execute(sql`
      WITH recent AS (
        SELECT player_id, SUM(appearances)::int AS a
        FROM player_stats WHERE league_id IN (39, 140, 135, 78, 61) AND season >= 2024 GROUP BY player_id
      )
      SELECT p.id FROM players p JOIN recent r ON r.player_id = p.id AND r.a >= 5
      WHERE p.external_id IS NOT NULL AND p.market_value_tier >= 4
      ORDER BY p.market_value_tier DESC, p.id LIMIT 200
    `)) as unknown as Array<{ id: string }>;
    ids = fb.map((row) => row.id);
  }
  if (ids.length === 0) {
    throw new PuzzleValidationError('No eligible players for Guess Who');
  }

  const answerPlayerId = ids[hashString(`${date}:guess_who`) % ids.length]!;

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
    answerPlayerId,
    answerJson: { modeId: 'guess_who', answerPlayerId },
  };
}

export async function generateTargetManPuzzle(
  date: string,
  _factPack: DailyFactPack
): Promise<GeneratedDailyPuzzle> {
  const seed = hashString(`${date}:target_man`);

  // Rotate evenly across every competition×category combo with a coprime stride,
  // then walk the list so a thin pool falls through instead of failing the mode.
  const combos: Array<{ comp: { id: number; name: string }; category: TargetManStatCategory }> = [];
  for (const comp of TARGET_MAN_COMPETITIONS) {
    for (const category of TARGET_MAN_CATEGORIES) combos.push({ comp, category });
  }
  const stride = 13; // coprime with 56 combos
  const start = ((dayNumber(date) * stride) % combos.length + combos.length) % combos.length;

  for (let offset = 0; offset < combos.length; offset += 1) {
    const { comp, category } = combos[(start + offset) % combos.length]!;
    const metric = metricForTargetCategory(category);

    const ranked = await topPlayersByLeagueMetric(comp.id, metric, 1, 25);
    if (ranked.length < 5) continue;

    // Pick 5 from the mid-table so the target is challenging, not just the elite.
    const middle = ranked.slice(4, 14);
    const sample = middle.length >= 5 ? middle : ranked.slice(0, 5);
    const pickOffset = seed % Math.max(sample.length - 4, 1);
    const chosen = sample.slice(pickOffset, pickOffset + 5);
    if (chosen.length < 5) continue;

    const combined = chosen.reduce((sum, player) => sum + player.statValue, 0);
    const target = roundTarget(combined, category);

    // A combo whose combined total exceeds the category ceiling must fall through
    // to the next combo, not abort the whole mode. Only swallow validation errors;
    // re-throw anything unexpected.
    try {
      validateTargetManPuzzle({ leagueId: comp.id, category, target });
    } catch (error) {
      if (error instanceof PuzzleValidationError) continue;
      throw error;
    }

    const puzzleJson = {
      modeId: 'target_man' as const,
      puzzleId: `${date}-target_man`,
      date,
      league: comp.name,
      leagueId: comp.id,
      category,
      categoryLabel: targetCategoryLabel(category),
      target,
      title: `${comp.name} ${targetCategoryLabel(category)}`,
    };

    return {
      modeId: 'target_man',
      puzzleJson,
      answerPlayerId: null,
      answerJson: {
        modeId: 'target_man',
        answer: { leagueId: comp.id, category, target },
      },
    };
  }

  throw new PuzzleValidationError('No target man competition produced a viable target');
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
      generated = await generateThemedBlindRank(date);
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
