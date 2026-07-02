import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { dailyPuzzles, players } from '../db/schema.js';
import { buildDailyFactPack } from './dailyFactPack.js';
import type { DailyFactPack, GeneratedDailyPuzzle } from './dailyPuzzleTypes.js';
import { TARGET_CATEGORIES, topPlayersForCategory } from './targetManCategories.js';
import { PuzzleValidationError, validateGeneratedPuzzle } from './puzzleValidator.js';
import { generateBlindRankPuzzle as generateThemedBlindRank } from './blindRankGenerator.js';
import { recentGuessWhoAnswerIds, recentTargetManQuestions, targetManQuestionKey } from './puzzleHistory.js';

const DAILY_MODES = ['guess_who', 'target_man', 'blind_rank'] as const;

// Repeat-suppression windows (days). Content used inside the window can't be picked again;
// once outside it only returns by seeded chance — never on a fixed schedule.
const GUESS_WHO_REPEAT_WINDOW_DAYS = 180;
const TARGET_MAN_REPEAT_WINDOW_DAYS = 240;

/** Seeded Fisher–Yates (LCG) — deterministic per seed, no Math.random. */
function seededShuffle<T>(arr: T[], seed: number): T[] {
  const r = [...arr];
  let state = BigInt(seed === 0 ? 1 : seed);
  for (let i = r.length - 1; i > 0; i -= 1) {
    state = (state * 6364136223846793005n + 1n) & ((1n << 64n) - 1n);
    const j = Number(state % BigInt(i + 1));
    [r[i], r[j]] = [r[j]!, r[i]!];
  }
  return r;
}

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
  factPack: DailyFactPack,
  opts?: { recentAnswerIds?: Set<string> }
): Promise<GeneratedDailyPuzzle> {
  if (factPack.playerCount === 0) {
    throw new PuzzleValidationError('No players available for Guess Who');
  }

  // Repeat suppression: never reuse an answer from the last ~6 months. The pool is ~530+, so
  // excluding ≤180 recent answers always leaves hundreds of candidates; selection within the
  // remainder stays hash-random, so there's no fixed comeback schedule either.
  const recentAnswers = opts?.recentAnswerIds ?? (await recentGuessWhoAnswerIds(date, GUESS_WHO_REPEAT_WINDOW_DAYS));

  // The answer must be recognisable AND CURRENTLY ACTIVE. We require recent big-5 minutes
  // (season >= 2024): that keeps the deduction attributes (club/league/age) current AND drops
  // retired players whose stale `current_league` would otherwise leak them in (e.g. Koscielny,
  // David Silva). Within that, gate by a PRESTIGE score (value tier + major finals + individual
  // awards, like Blind Rank) so it's a known name, and order by prestige so the pool is the ~500
  // most recognisable current players — good variety, never an obscure random.
  const PRESTIGE = sql`(p.market_value_tier * 10 + LEAST(COALESCE(fa.finals, 0), 6) * 4 + LEAST(COALESCE(aw.awards, 0), 4) * 6)`;
  // Outside the Premier League we only allow the genuinely big/known clubs of each league, so the
  // answer is never an obscure mid-table name (a random La Liga/Ligue 1 squad player is unguessable).
  // The PL itself stays broad (most starters are recognisable), and a true mvt5 star is allowed anywhere.
  const MARQUEE_NON_PL = [
    'Real Madrid', 'Barcelona', 'Atletico Madrid', 'Sevilla', 'Athletic Club', 'Real Sociedad', 'Villarreal', 'Real Betis',
    'Inter', 'Juventus', 'AC Milan', 'AS Roma', 'Napoli', 'Lazio', 'Atalanta', 'Fiorentina',
    'Bayern München', 'Borussia Dortmund', 'Bayer Leverkusen', 'RB Leipzig',
    'Paris Saint Germain', 'Monaco', 'Marseille', 'Lyon', 'Lille', 'Nice',
  ];
  const marqueeList = sql.join(MARQUEE_NON_PL.map((c) => sql`${c}`), sql`, `);
  const poolRows = (await db.execute(sql`
    WITH recent AS (
      SELECT player_id, SUM(appearances)::int AS a
      FROM player_stats WHERE league_id IN (39, 140, 135, 78, 61) AND season >= 2024
      GROUP BY player_id
    ),
    fa AS (SELECT player_id, COUNT(*) AS finals FROM final_appearances GROUP BY player_id),
    aw AS (SELECT player_id, COUNT(*) AS awards FROM player_awards GROUP BY player_id)
    SELECT p.id, p.current_league, ${PRESTIGE} AS prestige
    FROM players p
      JOIN recent r ON r.player_id = p.id AND r.a >= 10
      LEFT JOIN fa ON fa.player_id = p.id
      LEFT JOIN aw ON aw.player_id = p.id
    WHERE p.external_id IS NOT NULL
      AND p.current_league IN ('Premier League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1')
      AND p.foot IS NOT NULL
      AND ${PRESTIGE} >= 32
      AND (
        p.current_league = 'Premier League'
        OR p.market_value_tier >= 5
        OR p.current_club IN (${marqueeList})
      )
    ORDER BY prestige DESC, r.a DESC, p.id
    LIMIT 600
  `)) as unknown as Array<{ id: string; current_league: string }>;

  // Drop recently-used answers (fall back to the full pool only if that somehow empties it).
  const freshRows = poolRows.filter((r) => !recentAnswers.has(r.id));
  const eligibleRows = freshRows.length > 0 ? freshRows : poolRows;

  // ~2/3 of days the answer is a Premier League player, ~1/3 one of the other big-5 leagues.
  const pl = eligibleRows.filter((r) => r.current_league === 'Premier League').map((r) => r.id);
  const other = eligibleRows.filter((r) => r.current_league !== 'Premier League').map((r) => r.id);
  // 2-in-3 cadence (every 3rd day is a non-PL league) — a clean ~2/3 PL split without the long
  // same-league runs a string hash produces.
  const wantPL = dayNumber(date) % 3 !== 0;
  let ids = wantPL
    ? (pl.length > 0 ? pl : other)
    : (other.length > 0 ? other : pl);
  if (ids.length === 0) ids = eligibleRows.map((row) => row.id);

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
    const fresh = fb.map((row) => row.id).filter((id) => !recentAnswers.has(id));
    ids = fresh.length > 0 ? fresh : fb.map((row) => row.id);
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
  _factPack: DailyFactPack,
  opts?: { recentQuestions?: Set<string> }
): Promise<GeneratedDailyPuzzle> {
  const seed = hashString(`${date}:target_man`);

  // Repeat suppression: the same category coming back every ~19 days is fine (it's a fresh
  // number), but the EXACT question (category + target) must not recur for months.
  const recentQuestions = opts?.recentQuestions ?? (await recentTargetManQuestions(date, TARGET_MAN_REPEAT_WINDOW_DAYS));

  // Rotate across the curated category list with a coprime stride, then walk the list so a
  // thin pool falls through to the next category instead of failing the whole mode.
  const cats = TARGET_CATEGORIES;
  const stride = 7; // coprime with the (19) category count
  const start = ((dayNumber(date) * stride) % cats.length + cats.length) % cats.length;

  for (let offset = 0; offset < cats.length; offset += 1) {
    const def = cats[(start + offset) % cats.length]!;

    const ranked = await topPlayersForCategory(def, 30);
    if (ranked.length < 5) continue;

    // Pick 5 from below the elite tier so the target is challenging, not just the top names.
    // A seeded 5-of-N draw (not a sliding window of 6 offsets) gives thousands of possible
    // samples per category; salted re-draws dodge any target used in the last few months.
    const sample = ranked.length >= 9 ? ranked.slice(4) : ranked;
    let chosen: typeof ranked = [];
    let target = 0;
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const draw = seededShuffle(sample, hashString(`${date}:${def.id}:${attempt}:${seed}`)).slice(0, 5);
      if (draw.length < 5) break;
      const combined = draw.reduce((sum, player) => sum + player.statValue, 0);
      const rounded = roundTarget(combined, def.round);
      if (rounded <= 0) continue;
      if (recentQuestions.has(targetManQuestionKey(def.id, rounded))) continue;
      chosen = draw;
      target = rounded;
      break;
    }
    if (chosen.length < 5 || target <= 0) continue;

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
