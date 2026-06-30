/**
 * Blind Rank generator — themed, fame-gated rounds.
 *
 * The old version ranked players purely by a league/cup stat gradient with NO fame filter,
 * so rounds were full of unrecognisable players (e.g. "most Europa League appearances").
 * This picks a THEME (e.g. "Premier League Legends") and a compatible CATEGORY (e.g. "Peak
 * Market Value"), then composes 10 players as a QUALITY MIX within that theme — roughly
 * 5-6 elite, 2-3 good, 1-2 weak, varying by day. The weak slots are the suspense: leaving
 * the #1 spot open might land a megastar, or a quietly-underwhelming squad name. Values are
 * always distinct and well-spread so there's a clean correct ranking.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { resolveHeadshot } from '../constants/footballMedia.js';
import { getPhotoOverrides } from './photoOverrides.js';
import {
  BLIND_RANK_SLOT_COUNT,
  PuzzleValidationError,
  validateBlindRankSelection,
} from './puzzleValidator.js';
import type { FactPackPlayer, GeneratedDailyPuzzle } from './dailyPuzzleTypes.js';

/**
 * Vetted "stinker" bank (recognisable flops per theme), built offline by
 * `job:build-stinker-bank` (Claude nominates → DB validates). Loaded once; empty if absent,
 * so the generator degrades gracefully to the data-only quality mix.
 */
function loadStinkerBank(): Record<string, Array<{ id: string; name: string }>> {
  const candidates = [
    path.join(process.cwd(), 'src/data/stinker-bank.json'),
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../data/stinker-bank.json'),
  ];
  for (const p of candidates) {
    try { return JSON.parse(readFileSync(p, 'utf8')); } catch { /* try next */ }
  }
  return {};
}
const STINKER_BANK = loadStinkerBank();

// Sample window as a fraction of the distinct pool. < 1 leaves "slide room" so a
// date-seeded offset moves the window through the pool — different (still famous)
// players surface each day instead of the same marquee names anchoring every round.
const SAMPLE_DEPTH = 0.65;

interface Category {
  title: string;
  subtitle: string;
  col: string; // aggregated column in the AGG CTE
  min: number;
  noun: string;
  prefix: string;
  /** Derived from Transfermarkt match events (only complete ~2010+). When true, the universe is
   *  gated to players born >= 1990 so pre-coverage legends aren't undercounted and mis-ranked. */
  eventGated?: boolean;
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
  // Match-level / curated categories (the interesting ones). Event-derived ones are gated to the
  // covered era (born >= 1990) so undercounted pre-2010 legends aren't mis-ranked.
  premier_league_penalties: { title: 'Premier League Penalties', subtitle: 'Rank by Premier League penalty goals', col: 'pl_penalties', min: 1, noun: 'pens', prefix: '' },
  la_liga_penalties: { title: 'La Liga Penalties', subtitle: 'Rank by La Liga penalty goals', col: 'laliga_penalties', min: 1, noun: 'pens', prefix: '' },
  serie_a_penalties: { title: 'Serie A Penalties', subtitle: 'Rank by Serie A penalty goals', col: 'seriea_penalties', min: 1, noun: 'pens', prefix: '' },
  career_hattricks: { title: 'Career Hat-tricks', subtitle: 'Rank by career hat-tricks', col: 'hattricks', min: 1, noun: 'hat-tricks', prefix: '', eventGated: true },
  champions_league_knockout_goals: { title: 'Champions League Knockout Goals', subtitle: 'Rank by Champions League knockout goals', col: 'ucl_ko_goals', min: 1, noun: 'goals', prefix: '', eventGated: true },
  champions_league_goals_vs_english: { title: 'CL Goals vs English Clubs', subtitle: 'Rank by Champions League goals against English clubs', col: 'ucl_vs_eng', min: 1, noun: 'goals', prefix: '', eventGated: true },
  weak_foot_goals: { title: 'Weak-foot Goals', subtitle: 'Rank by career weak-foot goals', col: 'weak_foot_goals', min: 1, noun: 'goals', prefix: '', eventGated: true },
  goals_before_21: { title: 'Goals Before 21', subtitle: 'Rank by goals scored before turning 21', col: 'goals_u21', min: 1, noun: 'goals', prefix: '' },
  international_caps: { title: 'International Caps', subtitle: 'Rank by international caps', col: 'intl_caps', min: 1, noun: 'caps', prefix: '' },
  non_big6_pl_goals: { title: 'Premier League Goals (non–Big Six)', subtitle: 'Rank by Premier League goals for clubs outside the Big Six', col: 'pl_nonbig6_goals', min: 1, noun: 'goals', prefix: '' },
  london_goals: { title: 'Goals for London Clubs', subtitle: 'Rank by goals for London clubs', col: 'london_goals', min: 1, noun: 'goals', prefix: '' },
  london_appearances: { title: 'Appearances for London Clubs', subtitle: 'Rank by appearances for London clubs', col: 'london_apps', min: 1, noun: 'apps', prefix: '' },
};

interface Theme {
  id: string;
  title: string;
  /** Structural universe (NO fame gate) — defines who belongs to the theme. We then keep only
   *  the most PRESTIGIOUS members (see POOL_SIZE) so every name is recognisable. */
  structure: ReturnType<typeof sql>;
  cats: string[];
}

// Market value / transfer fee inflate massively by era, so ranking older players by them is
// meaningless ("Scholes < Gibbs-White"). They're ONLY used on Current Superstars (single era);
// every historical/mixed-era theme ranks by on-pitch stats, which don't inflate.
const THEMES: Theme[] = [
  { id: 'premier_league_legends', title: 'Premier League Legends', structure: sql`a.pl_apps >= 150`, cats: ['premier_league_goals', 'premier_league_assists', 'career_goals', 'premier_league_penalties', 'career_hattricks', 'goals_before_21', 'london_appearances'] },
  { id: 'champions_league_legends', title: 'Champions League Legends', structure: sql`a.cl_apps >= 40`, cats: ['champions_league_goals', 'champions_league_knockout_goals', 'champions_league_goals_vs_english', 'career_goals'] },
  { id: 'current_superstars', title: 'Current Superstars', structure: sql`a.peak_m >= 40`, cats: ['peak_market_value', 'biggest_transfer_fee', 'career_goals', 'career_assists', 'champions_league_goals', 'la_liga_penalties', 'goals_before_21', 'career_hattricks'] },
  { id: 'football_icons', title: 'Football Icons', structure: sql`a.total_apps >= 300 AND a.peak_m >= 40`, cats: ['career_goals', 'career_assists', 'la_liga_penalties', 'serie_a_penalties', 'career_hattricks', 'international_caps', 'weak_foot_goals'] },
  { id: 'premier_league_strikers', title: 'Premier League Strikers', structure: sql`a.position = 'Attacker' AND a.pl_apps >= 100`, cats: ['premier_league_goals', 'career_goals', 'champions_league_goals', 'premier_league_penalties', 'career_hattricks', 'goals_before_21', 'non_big6_pl_goals', 'london_goals'] },
  { id: 'world_cup_heroes', title: 'World Cup Heroes', structure: sql`a.wc = true`, cats: ['career_goals', 'career_assists', 'international_caps', 'goals_before_21', 'career_hattricks'] },
];

// How many of the most prestigious theme members we keep as the round's pool. Everyone in here
// is a recognisable name; we then spread 10 across the category's stat. Bigger pools = more
// day-to-day variety; small enough that the floor stays genuinely well-known.
const POOL_SIZE = 80;

// Per round, the chance we deliberately drop in a curated "stinker" (a recognisable flop) —
// kept variable so it's a surprise, not every round.
const STINKER_CHANCE = 3; // out of 5

/**
 * Prestige = how strongly fans ASSOCIATE with a player, which is what makes a "lesser" name
 * interesting (Klose: low market value, but a World Cup icon) vs forgettable (Zielinski: decent
 * value, zero honours). Market value alone gets this backwards, so we score by the achievement-
 * aware tier PLUS major finals and individual awards.
 */
const PRESTIGE = sql.raw('(a.mvt * 10 + LEAST(a.finals, 6) * 4 + LEAST(a.awards, 4) * 6)');

// Hard fame floor: every pool member must be at least mid-tier by value OR have a major final /
// individual award (catches lower-value icons like Klose). This guarantees no genuinely obscure
// name can enter a round, on top of the top-PRESTIGE pool cap below.
const FAME_FLOOR = sql`(a.mvt >= 3 OR a.finals >= 1 OR a.awards >= 1)`;

const BIG6 = ['Manchester United', 'Manchester City', 'Chelsea', 'Arsenal', 'Liverpool', 'Tottenham'];
const LONDON = ['Arsenal', 'Chelsea', 'Tottenham', 'West Ham', 'Fulham', 'Crystal Palace', 'Brentford', 'Charlton Athletic', 'QPR', 'Wimbledon'];
const big6Sql = sql.join(BIG6.map((t) => sql`${t}`), sql`, `);
const londonSql = sql.join(LONDON.map((t) => sql`${t}`), sql`, `);

const AGG = sql`
  WITH agg AS (
    SELECT p.id, p.name, p.nationality, p.position, p.market_value_tier AS mvt, p.api_football_id,
      EXTRACT(YEAR FROM p.birth_date)::int AS birth_year,
      ROUND(COALESCE(p.peak_market_value_eur, 0) / 1000000.0)::int AS peak_m,
      ROUND(COALESCE(p.record_fee_eur, 0) / 1000000.0)::int AS fee_m,
      COALESCE(fa.finals, 0)::int AS finals,
      COALESCE(aw.awards, 0)::int AS awards,
      COALESCE(SUM(s.goals)       FILTER (WHERE s.league_id = 39), 0)::int AS pl_goals,
      COALESCE(SUM(s.assists)     FILTER (WHERE s.league_id = 39), 0)::int AS pl_assists,
      COALESCE(SUM(s.appearances) FILTER (WHERE s.league_id = 39), 0)::int AS pl_apps,
      COALESCE(SUM(s.goals)       FILTER (WHERE s.league_id = 2), 0)::int AS cl_goals,
      COALESCE(SUM(s.appearances) FILTER (WHERE s.league_id = 2), 0)::int AS cl_apps,
      COALESCE(SUM(s.goals)       FILTER (WHERE s.league_id <> 1), 0)::int AS career_goals,
      COALESCE(SUM(s.assists)     FILTER (WHERE s.league_id <> 1), 0)::int AS career_assists,
      COALESCE(SUM(s.appearances), 0)::int AS total_apps,
      COALESCE(SUM(s.goals)       FILTER (WHERE s.league_id = 39 AND s.team_name NOT IN (${big6Sql})), 0)::int AS pl_nonbig6_goals,
      COALESCE(SUM(s.goals)       FILTER (WHERE s.league_id <> 1 AND s.team_name IN (${londonSql})), 0)::int AS london_goals,
      COALESCE(SUM(s.appearances) FILTER (WHERE s.league_id <> 1 AND s.team_name IN (${londonSql})), 0)::int AS london_apps,
      -- Penalties PER LEAGUE from FBref (accurate + era-complete) — precise categories beat a
      -- fuzzy, undercounted all-competitions "career" total.
      COALESCE(MAX(e.pl_penalties), 0)::int AS pl_penalties,
      COALESCE(MAX(e.laliga_penalties), 0)::int AS laliga_penalties,
      COALESCE(MAX(e.seriea_penalties), 0)::int AS seriea_penalties,
      COALESCE(MAX(e.career_hattricks), 0)::int AS hattricks,
      COALESCE(MAX(e.ucl_knockout_goals), 0)::int AS ucl_ko_goals,
      COALESCE(MAX(e.ucl_goals_vs_english), 0)::int AS ucl_vs_eng,
      COALESCE(MAX(e.weak_foot_goals), 0)::int AS weak_foot_goals,
      -- Goals before turning 21, derived from season totals (back to 1992) + DOB so it covers
      -- ALL eras, not just the TM-event window. Counts club seasons up to the one they turn 21.
      COALESCE(SUM(s.goals) FILTER (WHERE s.league_id <> 1 AND p.birth_date IS NOT NULL AND s.season <= EXTRACT(YEAR FROM p.birth_date) + 20), 0)::int AS goals_u21,
      COALESCE(MAX(e.intl_caps), 0)::int AS intl_caps,
      EXISTS (SELECT 1 FROM final_appearances f WHERE f.player_id = p.id AND f.competition = 'World Cup') AS wc
    FROM players p
      LEFT JOIN player_stats s ON s.player_id = p.id
      LEFT JOIN player_extra_stats e ON e.player_id = p.id
      LEFT JOIN (SELECT player_id, COUNT(*) AS finals FROM final_appearances GROUP BY player_id) fa ON fa.player_id = p.id
      LEFT JOIN (SELECT player_id, COUNT(*) AS awards FROM player_awards GROUP BY player_id) aw ON aw.player_id = p.id
    GROUP BY p.id, p.name, p.nationality, p.position, p.market_value_tier, p.api_football_id, p.birth_date, p.peak_market_value_eur, p.record_fee_eur, fa.finals, aw.awards
  )`;

interface PoolRow { id: string; name: string; nationality: string; position: string; stat: number; api_football_id?: number | null; }
/** A universe row also carries the prestige signal used to keep the pool recognisable. */
interface UniverseRow extends PoolRow { prestige: number; }

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

  // Slide a window through the pool by a date-seeded offset, then sample 10 evenly
  // across it. Deeper pools (more distinct values) get a bigger slide, so popular
  // names rotate in and out instead of the top always being the same faces.
  const window = Math.min(
    distinct.length,
    Math.max(BLIND_RANK_SLOT_COUNT, Math.floor(distinct.length * SAMPLE_DEPTH))
  );
  const maxStart = distinct.length - window;
  const start = maxStart > 0 ? seed % (maxStart + 1) : 0;
  const slice = distinct.slice(start, start + window);

  const step = slice.length / BLIND_RANK_SLOT_COUNT;
  const chosen: PoolRow[] = [];
  let last = -1;
  for (let i = 0; i < BLIND_RANK_SLOT_COUNT; i += 1) {
    const base = Math.floor(i * step);
    const jitter = Math.floor(seed / (i + 7)) % Math.max(1, Math.floor(step));
    let idx = Math.min(slice.length - 1, base + jitter);
    if (idx <= last) idx = last + 1;
    if (idx >= slice.length) break;
    chosen.push(slice[idx]!);
    last = idx;
  }
  if (chosen.length !== BLIND_RANK_SLOT_COUNT) {
    chosen.length = 0;
    for (let i = 0; i < BLIND_RANK_SLOT_COUNT; i += 1) chosen.push(slice[Math.min(slice.length - 1, Math.floor(i * step))]!);
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

function isCleanTen(rows: PoolRow[]): boolean {
  if (rows.length !== BLIND_RANK_SLOT_COUNT) return false;
  const vals = rows.map((c) => c.stat);
  const spread = vals[0]! - vals[vals.length - 1]!;
  return new Set(vals).size === vals.length && spread >= Math.max(8, BLIND_RANK_SLOT_COUNT - 1);
}

/**
 * Lay the 10 out for play so lower-stat names never cluster: interleave a (shuffled) top half
 * and bottom half by stat, with a date-seeded start. The player therefore never faces a run of
 * 3-4 less-prominent names back-to-back.
 */
function balancedOrder(chosen: PoolRow[], seed: number): PoolRow[] {
  const sorted = [...chosen].sort((a, b) => b.stat - a.stat);
  const half = Math.ceil(sorted.length / 2);
  const top = seededShuffle(sorted.slice(0, half), seed ^ 0x00aa);
  const bottom = seededShuffle(sorted.slice(half), seed ^ 0x00bb);
  const topFirst = (seed & 1) === 0;
  const out: PoolRow[] = [];
  for (let i = 0; i < half; i += 1) {
    const a = topFirst ? top[i] : bottom[i];
    const b = topFirst ? bottom[i] : top[i];
    if (a) out.push(a);
    if (b) out.push(b);
  }
  return out;
}

/**
 * Occasionally drop in a curated "stinker" (a recognisable flop, e.g. Drinkwater) — but only
 * sometimes, so it stays a surprise. The stinker must be a valid member of this theme/category;
 * it replaces the chosen pick closest in value so the ranking gradient stays clean.
 */
async function injectStinker(
  chosen: PoolRow[], theme: Theme, col: string, seed: number
): Promise<PoolRow[]> {
  const bank = STINKER_BANK[theme.id] ?? [];
  if (!bank.length) return chosen;
  if (((seed >> 3) % 5) >= STINKER_CHANCE) return chosen;       // not this round
  if (chosen.some((c) => bank.some((b) => b.id === c.id))) return chosen; // already has one

  const list = sql.join(bank.map((b) => sql`${b.id}::uuid`), sql`, `);
  const cands = (await db.execute(sql`
    ${AGG}
    SELECT a.id, a.name, a.nationality, a.position, a.api_football_id, a.${sql.raw(col)} AS stat
    FROM agg a
    WHERE a.id IN (${list}) AND ${theme.structure} AND a.${sql.raw(col)} >= 1 AND ${FAME_FLOOR}
  `)) as unknown as PoolRow[];

  const chosenIds = new Set(chosen.map((c) => c.id));
  const usedVals = new Set(chosen.map((c) => c.stat));
  const pool = cands.filter((r) => !chosenIds.has(r.id) && !usedVals.has(r.stat));
  if (!pool.length) return chosen;

  const stinker = pool[seed % pool.length]!;
  let dropIdx = 0;
  let best = Infinity;
  for (let i = 0; i < chosen.length; i += 1) {
    const d = Math.abs(chosen[i]!.stat - stinker.stat);
    if (d < best) { best = d; dropIdx = i; }
  }
  const trial = chosen.filter((_, i) => i !== dropIdx).concat(stinker).sort((a, b) => b.stat - a.stat);
  return isCleanTen(trial) ? trial : chosen;
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

    // Pool = the theme's MOST PRESTIGIOUS members that have a value for this category. Capping
    // by prestige (not market value) means even the lowest-stat name is one fans associate with
    // — an "iconic but low here" surprise (Klose), never a forgettable squad player (Zielinski).
    const pool = (await db.execute(sql`
      ${AGG}
      SELECT a.id, a.name, a.nationality, a.position, a.api_football_id, ${PRESTIGE} AS prestige, a.${sql.raw(category.col)} AS stat
      FROM agg a
      WHERE ${theme.structure} AND a.${sql.raw(category.col)} >= 1
        AND ${FAME_FLOOR}
        AND ${category.eventGated ? sql`a.birth_year >= 1990` : sql`TRUE`}
      ORDER BY prestige DESC, stat DESC, a.id
      LIMIT ${POOL_SIZE}
    `)) as unknown as UniverseRow[];
    if (pool.length < BLIND_RANK_SLOT_COUNT) continue;

    // Spread 10 across the stat within the recognisable pool, then maybe swap in a curated stinker.
    const byStat = [...pool].sort((a, b) => b.stat - a.stat);
    const spread = pickSpread(byStat, seed);
    if (!spread) continue;
    const chosen = await injectStinker(spread, theme, category.col, seed);

    const clubs = await clubsByPlayer(chosen.map((c) => c.id));
    const ranked = [...chosen].sort((a, b) => b.stat - a.stat);
    const correctRanking = ranked.map((c) => c.id);
    const statValues: Record<string, number> = {};
    for (const c of chosen) statValues[c.id] = c.stat;

    const overrides = await getPhotoOverrides();
    const presentationOrder = balancedOrder(chosen, seed ^ 0x9e37).map((c) => {
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
        headshotUrl: resolveHeadshot(overrides.get(c.id), c.api_football_id) ?? undefined,
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
