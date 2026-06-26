/**
 * Blind Rank generator — themed, fame-gated rounds.
 *
 * The old version ranked players purely by a league/cup stat gradient with NO fame filter,
 * so rounds were full of unrecognisable players (e.g. "most Europa League appearances").
 * This picks a THEME (a pool of recognisable players, e.g. "Premier League Legends") and a
 * compatible CATEGORY (e.g. "Peak Market Value"), then selects 10 players from that pool
 * with distinct, well-spread values — so every name is knowable and the fun is "where does
 * he go?", not "who is this?".
 */
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  BLIND_RANK_SLOT_COUNT,
  PuzzleValidationError,
  validateBlindRankSelection,
} from './puzzleValidator.js';
import type { FactPackPlayer, GeneratedDailyPuzzle } from './dailyPuzzleTypes.js';

const SAMPLE_RANGE = 40; // sample the 10 from the most recognisable slice

interface Category {
  title: string;
  subtitle: string;
  col: string; // aggregated column in the AGG CTE
  min: number;
  noun: string;
  prefix: string;
}

const CATEGORIES: Record<string, Category> = {
  peak_market_value: { title: 'Peak Market Value', subtitle: 'Rank by peak market value', col: 'peak_m', min: 5, noun: 'm', prefix: '€' },
  biggest_transfer_fee: { title: 'Biggest Transfer Fee', subtitle: 'Rank by biggest transfer fee', col: 'fee_m', min: 1, noun: 'm', prefix: '€' },
  career_goals: { title: 'Career Goals', subtitle: 'Rank by career goals', col: 'career_goals', min: 40, noun: 'goals', prefix: '' },
  career_assists: { title: 'Career Assists', subtitle: 'Rank by career assists', col: 'career_assists', min: 25, noun: 'assists', prefix: '' },
  premier_league_goals: { title: 'Premier League Goals', subtitle: 'Rank by Premier League goals', col: 'pl_goals', min: 10, noun: 'goals', prefix: '' },
  premier_league_assists: { title: 'Premier League Assists', subtitle: 'Rank by Premier League assists', col: 'pl_assists', min: 10, noun: 'assists', prefix: '' },
  premier_league_appearances: { title: 'Premier League Appearances', subtitle: 'Rank by Premier League appearances', col: 'pl_apps', min: 50, noun: 'apps', prefix: '' },
  champions_league_goals: { title: 'Champions League Goals', subtitle: 'Rank by Champions League goals', col: 'cl_goals', min: 5, noun: 'goals', prefix: '' },
  champions_league_appearances: { title: 'Champions League Appearances', subtitle: 'Rank by Champions League appearances', col: 'cl_apps', min: 20, noun: 'apps', prefix: '' },
  international_caps: { title: 'International Caps', subtitle: 'Rank by international caps', col: 'intl_caps', min: 20, noun: 'caps', prefix: '' },
};

interface Theme {
  id: string;
  title: string;
  where: ReturnType<typeof sql>;
  cats: string[];
}

const THEMES: Theme[] = [
  { id: 'premier_league_legends', title: 'Premier League Legends', where: sql`a.mvt >= 4 AND a.pl_apps >= 150`, cats: ['peak_market_value', 'biggest_transfer_fee', 'premier_league_goals', 'premier_league_assists', 'premier_league_appearances', 'career_goals'] },
  { id: 'champions_league_legends', title: 'Champions League Legends', where: sql`a.mvt >= 4 AND a.cl_apps >= 50`, cats: ['champions_league_goals', 'champions_league_appearances', 'peak_market_value', 'career_goals'] },
  { id: 'current_superstars', title: 'Current Superstars', where: sql`a.mvt >= 5 AND a.peak_m >= 50`, cats: ['peak_market_value', 'career_goals', 'career_assists', 'champions_league_goals', 'biggest_transfer_fee'] },
  { id: 'football_icons', title: 'Football Icons', where: sql`a.mvt >= 5 AND a.total_apps >= 300`, cats: ['peak_market_value', 'career_goals', 'career_assists', 'biggest_transfer_fee'] },
  { id: 'premier_league_strikers', title: 'Premier League Strikers', where: sql`a.position = 'Attacker' AND a.pl_apps >= 100 AND a.mvt >= 3`, cats: ['premier_league_goals', 'career_goals', 'peak_market_value', 'biggest_transfer_fee'] },
  { id: 'premier_league_midfielders', title: 'Premier League Midfielders', where: sql`a.position = 'Midfielder' AND a.pl_apps >= 150 AND a.mvt >= 3`, cats: ['premier_league_assists', 'career_assists', 'premier_league_appearances', 'peak_market_value'] },
  { id: 'premier_league_defenders', title: 'Premier League Defenders', where: sql`a.position = 'Defender' AND a.pl_apps >= 150 AND a.mvt >= 3`, cats: ['premier_league_appearances', 'peak_market_value', 'biggest_transfer_fee'] },
  { id: 'world_cup_heroes', title: 'World Cup Heroes', where: sql`a.wc = true AND a.mvt >= 4`, cats: ['career_goals', 'international_caps', 'peak_market_value'] },
];

const AGG = sql`
  WITH agg AS (
    SELECT p.id, p.name, p.nationality, p.position, p.market_value_tier AS mvt,
      ROUND(COALESCE(p.peak_market_value_eur, 0) / 1000000.0)::int AS peak_m,
      ROUND(COALESCE(p.record_fee_eur, 0) / 1000000.0)::int AS fee_m,
      COALESCE(SUM(s.goals)       FILTER (WHERE s.league_id = 39), 0)::int AS pl_goals,
      COALESCE(SUM(s.assists)     FILTER (WHERE s.league_id = 39), 0)::int AS pl_assists,
      COALESCE(SUM(s.appearances) FILTER (WHERE s.league_id = 39), 0)::int AS pl_apps,
      COALESCE(SUM(s.goals)       FILTER (WHERE s.league_id = 2), 0)::int AS cl_goals,
      COALESCE(SUM(s.appearances) FILTER (WHERE s.league_id = 2), 0)::int AS cl_apps,
      COALESCE(SUM(s.goals)       FILTER (WHERE s.league_id <> 1), 0)::int AS career_goals,
      COALESCE(SUM(s.assists)     FILTER (WHERE s.league_id <> 1), 0)::int AS career_assists,
      COALESCE(SUM(s.appearances) FILTER (WHERE s.league_id = 1), 0)::int AS intl_caps,
      COALESCE(SUM(s.appearances), 0)::int AS total_apps,
      EXISTS (SELECT 1 FROM final_appearances f WHERE f.player_id = p.id AND f.competition = 'World Cup') AS wc
    FROM players p LEFT JOIN player_stats s ON s.player_id = p.id
    GROUP BY p.id, p.name, p.nationality, p.position, p.market_value_tier, p.peak_market_value_eur, p.record_fee_eur
  )`;

interface PoolRow { id: string; name: string; nationality: string; position: string; stat: number; }

function hashString(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) { h = (h << 5) - h + input.charCodeAt(i); h |= 0; }
  return Math.abs(h);
}
function dayNumber(date: string): number {
  const ms = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.floor(ms / 86_400_000) : 0;
}
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

/** Distinct-value, evenly-spread sample of 10 from a desc-sorted famous pool. */
function pickSpread(pool: PoolRow[], seed: number): PoolRow[] | null {
  const distinct: PoolRow[] = [];
  const seen = new Set<number>();
  for (const p of pool) if (!seen.has(p.stat)) { seen.add(p.stat); distinct.push(p); }
  if (distinct.length < BLIND_RANK_SLOT_COUNT) return null;

  const range = Math.min(distinct.length, SAMPLE_RANGE);
  const step = range / BLIND_RANK_SLOT_COUNT;
  const chosen: PoolRow[] = [];
  let last = -1;
  for (let i = 0; i < BLIND_RANK_SLOT_COUNT; i += 1) {
    const base = Math.floor(i * step);
    const jitter = Math.floor(seed / (i + 7)) % Math.max(1, Math.floor(step));
    let idx = Math.min(range - 1, base + jitter);
    if (idx <= last) idx = last + 1;
    if (idx >= range) break;
    chosen.push(distinct[idx]!);
    last = idx;
  }
  if (chosen.length !== BLIND_RANK_SLOT_COUNT) {
    chosen.length = 0;
    for (let i = 0; i < BLIND_RANK_SLOT_COUNT; i += 1) chosen.push(distinct[Math.min(range - 1, Math.floor(i * step))]!);
  }
  // Validate via the shared rule (strict descending + spread) using a FactPackPlayer shim.
  try {
    const shim: FactPackPlayer[] = chosen.map((c) => ({
      playerId: c.id, name: c.name, club: '', league: '', nationality: c.nationality, position: c.position, statValue: c.stat,
    }));
    validateBlindRankSelection(shim);
    return chosen;
  } catch {
    return null;
  }
}

/** Top clubs (by appearances, excluding national teams) for the round's players. */
async function clubsByPlayer(ids: string[]): Promise<Map<string, string[]>> {
  const list = sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);
  // Exclude national-team rows: league_id 1, and any row whose team is the player's
  // own country (some international stats are ingested under non-1 league ids).
  const rows = (await db.execute(sql`
    SELECT s.player_id, s.team_name, SUM(s.appearances)::int AS apps
    FROM player_stats s JOIN players p ON p.id = s.player_id
    WHERE s.player_id IN (${list}) AND s.league_id <> 1 AND s.team_name IS NOT NULL
      AND s.team_name <> p.nationality
    GROUP BY s.player_id, s.team_name ORDER BY apps DESC
  `)) as unknown as Array<{ player_id: string; team_name: string }>;
  const m = new Map<string, string[]>();
  for (const r of rows) {
    const arr = m.get(r.player_id) ?? [];
    if (arr.length < 2) arr.push(r.team_name);
    m.set(r.player_id, arr);
  }
  return m;
}

export async function generateBlindRankPuzzle(date: string): Promise<GeneratedDailyPuzzle> {
  const seed = hashString(`${date}:blind_rank`);

  // All (theme, category) pairs, rotated by date so the daily varies and cycles evenly.
  const pairs = THEMES.flatMap((t) => t.cats.map((c) => ({ theme: t, cat: c })));
  const start = ((dayNumber(date) * 7) % pairs.length + pairs.length) % pairs.length;

  for (let offset = 0; offset < pairs.length; offset += 1) {
    const { theme, cat } = pairs[(start + offset) % pairs.length]!;
    const category = CATEGORIES[cat]!;

    const pool = (await db.execute(sql`
      ${AGG}
      SELECT a.id, a.name, a.nationality, a.position, a.${sql.raw(category.col)} AS stat
      FROM agg a
      WHERE ${theme.where} AND a.${sql.raw(category.col)} >= ${category.min}
      ORDER BY stat DESC
      LIMIT 60
    `)) as unknown as PoolRow[];

    const chosen = pickSpread(pool, seed);
    if (!chosen) continue;

    const clubs = await clubsByPlayer(chosen.map((c) => c.id));
    const correctRanking = chosen.map((c) => c.id);
    const statValues: Record<string, number> = {};
    for (const c of chosen) statValues[c.id] = c.stat;

    const presentationOrder = seededShuffle(chosen, seed ^ 0x9e37).map((c) => {
      const cl = clubs.get(c.id) ?? [];
      return {
        id: c.id,
        name: c.name,
        club: cl[0] ?? '',
        clubs: cl.join(' · '),
        league: '',
        nationality: c.nationality,
        position: c.position,
        statValue: c.stat,
      };
    });

    return {
      modeId: 'blind_rank',
      puzzleJson: {
        modeId: 'blind_rank' as const,
        puzzleId: `${date}-blind_rank`,
        date,
        category: `${theme.id}:${cat}`,
        themeTitle: theme.title,
        categoryTitle: category.title,
        subtitle: category.subtitle,
        rankHint: 'Most → least',
        valueNoun: category.noun,
        valuePrefix: category.prefix,
        presentationOrder,
      },
      answerPlayerId: correctRanking[0] ?? null,
      answerJson: {
        modeId: 'blind_rank',
        answer: { correctRanking, statValues },
      },
    };
  }

  throw new PuzzleValidationError('No blind rank theme/category produced a viable round');
}
