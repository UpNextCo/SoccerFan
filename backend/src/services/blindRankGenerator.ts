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
};

interface Theme {
  id: string;
  title: string;
  /** Structural universe (NO fame gate) — defines who belongs to the theme. We tier by
   *  fame WITHIN this universe so each round can mix elite / good / weak players. */
  structure: ReturnType<typeof sql>;
  cats: string[];
}

// Market value / transfer fee inflate massively by era, so ranking older players by them is
// meaningless ("Scholes < Gibbs-White"). They're ONLY used on Current Superstars (single era);
// every historical/mixed-era theme ranks by on-pitch stats, which don't inflate.
const THEMES: Theme[] = [
  { id: 'premier_league_legends', title: 'Premier League Legends', structure: sql`a.pl_apps >= 150`, cats: ['premier_league_goals', 'premier_league_assists', 'premier_league_appearances', 'career_goals'] },
  { id: 'champions_league_legends', title: 'Champions League Legends', structure: sql`a.cl_apps >= 40`, cats: ['champions_league_goals', 'champions_league_appearances', 'career_goals'] },
  { id: 'current_superstars', title: 'Current Superstars', structure: sql`a.peak_m >= 40`, cats: ['peak_market_value', 'biggest_transfer_fee', 'career_goals', 'career_assists', 'champions_league_goals'] },
  { id: 'football_icons', title: 'Football Icons', structure: sql`a.total_apps >= 300 AND a.peak_m >= 25`, cats: ['career_goals', 'career_assists', 'champions_league_appearances'] },
  { id: 'premier_league_strikers', title: 'Premier League Strikers', structure: sql`a.position = 'Attacker' AND a.pl_apps >= 100`, cats: ['premier_league_goals', 'career_goals', 'champions_league_goals'] },
  { id: 'premier_league_midfielders', title: 'Premier League Midfielders', structure: sql`a.position = 'Midfielder' AND a.pl_apps >= 150`, cats: ['premier_league_assists', 'career_assists', 'premier_league_appearances'] },
  { id: 'premier_league_defenders', title: 'Premier League Defenders', structure: sql`a.position = 'Defender' AND a.pl_apps >= 150`, cats: ['premier_league_appearances', 'champions_league_appearances', 'career_goals'] },
  { id: 'world_cup_heroes', title: 'World Cup Heroes', structure: sql`a.wc = true`, cats: ['career_goals', 'career_assists', 'champions_league_appearances'] },
];

// Per-round quality mix as [elite, good, weak] counts (sum 10). Picked by date seed so the
// blend varies: most rounds carry a weak slot or two, ~30% are all elite/good (no shocker),
// so leaving the #1 slot open is genuinely suspenseful — sometimes insane, sometimes a dud.
const MIXES: ReadonlyArray<readonly [number, number, number]> = [
  [5, 3, 2], [6, 2, 2], [6, 3, 1], [5, 4, 1], [7, 2, 1], [6, 4, 0], [7, 3, 0],
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
/** A universe row also carries fame signals so we can split into elite / good / weak bands. */
interface UniverseRow extends PoolRow { mvt: number; peak_m: number; }

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

/** Spread-sample n rows from a band: distinct stat values, slid by a date-seeded offset. */
function sampleBand<T extends PoolRow>(rows: T[], n: number, seed: number): T[] {
  if (n <= 0) return [];
  const sorted = [...rows].sort((a, b) => b.stat - a.stat);
  const distinct: T[] = [];
  const seen = new Set<number>();
  for (const r of sorted) if (!seen.has(r.stat)) { seen.add(r.stat); distinct.push(r); }
  if (distinct.length <= n) return distinct;

  const window = Math.min(distinct.length, Math.max(n, Math.floor(distinct.length * SAMPLE_DEPTH)));
  const maxStart = distinct.length - window;
  const start = maxStart > 0 ? seed % (maxStart + 1) : 0;
  const slice = distinct.slice(start, start + window);
  const step = slice.length / n;
  const out: T[] = [];
  let last = -1;
  for (let i = 0; i < n; i += 1) {
    const base = Math.floor(i * step);
    const jitter = Math.floor(seed / (i + 7)) % Math.max(1, Math.floor(step));
    let idx = Math.min(slice.length - 1, base + jitter);
    if (idx <= last) idx = last + 1;
    if (idx >= slice.length) break;
    out.push(slice[idx]!);
    last = idx;
  }
  return out;
}

/**
 * Compose 10 from a fame-tiered mix: ~5-6 elite, ~2-3 good, ~1-2 weak (varies by date).
 * Bands are by fame (peak value, then tier) WITHIN the theme universe, so "weak" = the
 * least celebrated players who still belong — the quietly-underwhelming names. Returns
 * null if it can't make a clean 10 (distinct, well-spread values); caller falls back.
 */
function isCleanTen(rows: UniverseRow[]): boolean {
  if (rows.length !== BLIND_RANK_SLOT_COUNT) return false;
  const vals = rows.map((c) => c.stat);
  const spread = vals[0]! - vals[vals.length - 1]!;
  return new Set(vals).size === vals.length && spread >= Math.max(8, BLIND_RANK_SLOT_COUNT - 1);
}

function composeTiered(universe: UniverseRow[], seed: number, shockerIds: Set<string>): UniverseRow[] | null {
  if (universe.length < BLIND_RANK_SLOT_COUNT) return null;
  const byFame = [...universe].sort((a, b) => b.peak_m - a.peak_m || b.mvt - a.mvt || b.stat - a.stat);
  const n = byFame.length;
  const elite = byFame.slice(0, Math.max(1, Math.floor(n * 0.40)));
  const good = byFame.slice(Math.floor(n * 0.40), Math.floor(n * 0.75));
  const weak = byFame.slice(Math.floor(n * 0.75));

  const [ne, ng, nw] = MIXES[seed % MIXES.length]!;
  let chosen = [
    ...sampleBand(elite, ne, seed),
    ...sampleBand(good, ng, seed ^ 0x11),
    ...sampleBand(weak, nw, seed ^ 0x22),
  ];

  // Collapse any stat-value collisions across bands, then top up to 10 from the rest.
  const used = new Set<number>();
  chosen = chosen.filter((c) => (used.has(c.stat) ? false : (used.add(c.stat), true)));
  if (chosen.length < BLIND_RANK_SLOT_COUNT) {
    for (const r of byFame) {
      if (chosen.length >= BLIND_RANK_SLOT_COUNT) break;
      if (!used.has(r.stat)) { used.add(r.stat); chosen.push(r); }
    }
  }
  if (chosen.length < BLIND_RANK_SLOT_COUNT) return null;
  chosen = chosen.slice(0, BLIND_RANK_SLOT_COUNT).sort((a, b) => b.stat - a.stat);
  if (!isCleanTen(chosen)) return null;

  // On most weak-bearing rounds, guarantee a RECOGNISABLE shocker (Drinkwater-type) rather
  // than only the quiet-bad data tier — but not always, so it stays a surprise. Swap in a
  // vetted shocker for the chosen pick closest in value (keeps the gradient intact).
  const wantShocker = nw > 0 && ((seed >> 3) % 5) < 3;
  if (wantShocker && shockerIds.size && !chosen.some((c) => shockerIds.has(c.id))) {
    const chosenIds = new Set(chosen.map((c) => c.id));
    const usedVals = new Set(chosen.map((c) => c.stat));
    const cands = universe.filter((r) => shockerIds.has(r.id) && !chosenIds.has(r.id) && !usedVals.has(r.stat));
    if (cands.length) {
      const shocker = cands[seed % cands.length]!;
      let dropIdx = 0;
      let best = Infinity;
      for (let i = 0; i < chosen.length; i += 1) {
        const d = Math.abs(chosen[i]!.stat - shocker.stat);
        if (d < best) { best = d; dropIdx = i; }
      }
      const trial = chosen.filter((_, i) => i !== dropIdx).concat(shocker).sort((a, b) => b.stat - a.stat);
      if (isCleanTen(trial)) return trial;
    }
  }

  return chosen;
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

    // Universe = the theme's structural members that have a real value for this category.
    // No fame gate: we want elite AND weak players present so we can build a quality mix.
    const universe = (await db.execute(sql`
      ${AGG}
      SELECT a.id, a.name, a.nationality, a.position, a.mvt, a.peak_m, a.${sql.raw(category.col)} AS stat
      FROM agg a
      WHERE ${theme.structure} AND a.${sql.raw(category.col)} >= 1
      ORDER BY stat DESC
      LIMIT 400
    `)) as unknown as UniverseRow[];

    // Tiered mix first; fall back to a plain spread (still recognisable) if it can't form a
    // clean 10 for this pair, then try the next pair.
    const shockerIds = new Set((STINKER_BANK[theme.id] ?? []).map((s) => s.id));
    const chosen = composeTiered(universe, seed, shockerIds) ?? pickSpread(universe, seed);
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
