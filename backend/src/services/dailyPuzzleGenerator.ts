import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { dailyPuzzles, players } from '../db/schema.js';
import { buildDailyFactPack } from './dailyFactPack.js';
import type { DailyFactPack, GeneratedDailyPuzzle } from './dailyPuzzleTypes.js';
import { TARGET_CATEGORIES, topPlayersForCategory } from './targetManCategories.js';
import { PuzzleValidationError, validateGeneratedPuzzle } from './puzzleValidator.js';
import { generateBlindRankPuzzle as generateThemedBlindRank } from './blindRankGenerator.js';

const DAILY_MODES = ['guess_who', 'target_man', 'blind_rank'] as const;

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

function roundTarget(value: number, step: number): number {
  return Math.max(step, Math.round(value / step) * step);
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

  // Rotate across the curated category list with a coprime stride, then walk the list so a
  // thin pool falls through to the next category instead of failing the whole mode.
  const cats = TARGET_CATEGORIES;
  const stride = 7; // coprime with the (19) category count
  const start = ((dayNumber(date) * stride) % cats.length + cats.length) % cats.length;

  for (let offset = 0; offset < cats.length; offset += 1) {
    const def = cats[(start + offset) % cats.length]!;

    const ranked = await topPlayersForCategory(def, 25);
    if (ranked.length < 5) continue;

    // Pick 5 from the mid-table so the target is challenging, not just the elite.
    const middle = ranked.slice(4, 14);
    const sample = middle.length >= 5 ? middle : ranked.slice(0, 5);
    const pickOffset = seed % Math.max(sample.length - 4, 1);
    const chosen = sample.slice(pickOffset, pickOffset + 5);
    if (chosen.length < 5) continue;

    const combined = chosen.reduce((sum, player) => sum + player.statValue, 0);
    const target = roundTarget(combined, def.round);
    if (target <= 0) continue;

    const puzzleJson = {
      modeId: 'target_man' as const,
      puzzleId: `${date}-target_man`,
      date,
      categoryId: def.id,
      categoryLabel: def.label,
      valueNoun: def.valueNoun,
      offNoun: def.offNoun,
      unit: def.unit,
      target,
      title: def.label,
    };

    return {
      modeId: 'target_man',
      puzzleJson,
      answerPlayerId: null,
      answerJson: {
        modeId: 'target_man',
        answer: { categoryId: def.id, target },
      },
    };
  }

  throw new PuzzleValidationError('No target man category produced a viable target');
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
