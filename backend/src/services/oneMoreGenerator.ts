/**
 * One More generator (binary pick). Picks a daily METRIC (e.g. "career penalty goals",
 * "Champions League knockout goals", "Premier League goals") and a threshold that yields a
 * healthy pool, then pre-builds 10 ramped binary rounds: each pairs a genuine qualifier
 * (>= threshold) with a tempting distractor (< threshold but believable). The deliberate move
 * away from "Champions League appearances"-style prompts toward richer, match-level categories.
 *
 * Match-level metrics come from player_extra_stats (the Transfermarkt events ingest).
 * Dry run: DATABASE_URL=... npx tsx src/services/oneMoreGenerator.ts [date]
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { resolveHeadshot } from '../constants/footballMedia.js';
import { getPhotoOverrides } from './photoOverrides.js';
import { lookupTeamLogo } from './teamService.js';
import { oneMorePairKey, recentOneMorePairs } from './puzzleHistory.js';
import { oneMoreEligibilityErrors } from './oneMoreEligibility.js';
import { trustedIntlCapsSql } from './statMetrics.js';

// Always exactly 10 rounds, so each correct answer is a clean +90 XP toward the 900 max.
const ROUND_TARGET = 10;
const MIN_ROUNDS = 10;
/** An exact (metric, pair) round can't recur inside this window. */
const ONE_MORE_REPEAT_WINDOW_DAYS = 180;

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

const BIG6 = ['Manchester United', 'Manchester City', 'Chelsea', 'Arsenal', 'Liverpool', 'Tottenham'];
const big6Sql = sql.join(BIG6.map((t) => sql`${t}`), sql`, `);

export interface OneMoreMetricDefinition {
  id: string;
  title: string;   // shown as "WHO HAS {min}+ {title}?" or "Who has more {title}?"
  noun: string;    // reveal unit, e.g. "goals", "pens", "caps"
  col: string;     // value column in AGG
  part: string;    // participation column (must be > 0 to appear) in AGG
  ladder: number[];
  goalLike: boolean;   // exclude goalkeepers from distractors when true
  eventBased?: boolean; // Transfermarkt-event metric (only complete ~2010+) → see gating below
}

const METRICS: OneMoreMetricDefinition[] = [
  { id: 'pl_goals', title: 'Premier League goals', noun: 'goals', col: 'pl_goals', part: 'pl_apps', ladder: [20, 30, 40, 50, 60, 75], goalLike: true },
  { id: 'pl_assists', title: 'Premier League assists', noun: 'assists', col: 'pl_assists', part: 'pl_apps', ladder: [15, 20, 30, 40, 50], goalLike: false },
  { id: 'laliga_goals', title: 'La Liga goals', noun: 'goals', col: 'liga_goals', part: 'liga_apps', ladder: [20, 30, 40, 50, 75], goalLike: true },
  { id: 'seriea_goals', title: 'Serie A goals', noun: 'goals', col: 'seriea_goals', part: 'seriea_apps', ladder: [20, 30, 40, 50, 75], goalLike: true },
  { id: 'cl_goals', title: 'Champions League goals', noun: 'goals', col: 'cl_goals', part: 'cl_apps', ladder: [10, 15, 20, 25, 30], goalLike: true },
  { id: 'cl_knockout_goals', title: 'Champions League knockout goals', noun: 'goals', col: 'ucl_ko_goals', part: 'cl_apps', ladder: [3, 5, 8, 12, 18], goalLike: true, eventBased: true },
  { id: 'pl_penalties', title: 'Premier League penalty goals', noun: 'pens', col: 'pl_penalties', part: 'pl_apps', ladder: [10, 15, 20, 30, 40], goalLike: true },
  { id: 'laliga_penalties', title: 'La Liga penalty goals', noun: 'pens', col: 'laliga_penalties', part: 'liga_apps', ladder: [10, 15, 20, 30], goalLike: true },
  { id: 'seriea_penalties', title: 'Serie A penalty goals', noun: 'pens', col: 'seriea_penalties', part: 'seriea_apps', ladder: [10, 15, 20, 30], goalLike: true },
  // Wikipedia league + international lists cover every era, so this is NOT eventBased (unlike
  // weak-foot / CL-knockout which still come from the Transfermarkt match dump).
  { id: 'hattricks', title: 'career hat-tricks', noun: 'hat-tricks', col: 'hattricks', part: 'total_apps', ladder: [3, 5, 8, 10, 15], goalLike: true },
  { id: 'intl_caps', title: 'international caps', noun: 'caps', col: 'intl_caps', part: 'total_apps', ladder: [30, 50, 75, 100, 125], goalLike: false },
  { id: 'goals_before_21', title: 'goals before turning 21', noun: 'goals', col: 'goals_u21', part: 'total_apps', ladder: [5, 8, 12, 18, 25], goalLike: true },
  { id: 'weak_foot_goals', title: 'weak-foot goals', noun: 'goals', col: 'weak_foot_goals', part: 'total_apps', ladder: [15, 25, 40, 60], goalLike: true, eventBased: true },
  { id: 'non_big6_pl_goals', title: 'Premier League goals for a non–Big Six club', noun: 'goals', col: 'pl_nonbig6_goals', part: 'pl_apps', ladder: [20, 30, 40, 50, 60], goalLike: true },
  { id: 'seriea_ligue1_goals', title: 'Serie A and Ligue 1 goals combined', noun: 'goals', col: 'seriea_ligue1_goals', part: 'seriea_ligue1_apps', ladder: [30, 50, 75, 100], goalLike: true },
];

export interface OneMoreOption {
  id: string;
  name: string;
  clubs: string;
  position: string;
  nationality: string;
  value: number;
  headshotUrl?: string;
  teamId?: number;
  teamLogoUrl?: string;
}
export interface OneMoreRound {
  options: [OneMoreOption, OneMoreOption];
}
export interface OneMorePuzzle {
  modeId: 'one_more';
  puzzleId: string;
  date: string;
  metricId?: string;
  title: string;
  valueNoun: string;
  minimum: number;
  compareMode?: boolean;
  rounds: OneMoreRound[];
}

function dayNumber(date: string): number {
  const ms = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.floor(ms / 86_400_000) : 0;
}
/** Legacy per-pick validator (kept for the old /onemore/validate route; play is now client-side). */
export async function oneMoreStatValue(playerId: string, leagueId: number, category: string): Promise<number> {
  const col = sql.raw(['goals', 'assists', 'appearances'].includes(category) ? category : 'goals');
  const rows = (await db.execute(sql`
    SELECT COALESCE(SUM(${col}), 0)::int AS total FROM player_stats WHERE player_id = ${playerId} AND league_id = ${leagueId}
  `)) as unknown as Array<{ total: number }>;
  return rows[0]?.total ?? 0;
}

const AGG = sql`
  WITH agg AS (
    SELECT p.id, p.name, p.position, p.api_football_id, p.nationality,
      EXTRACT(YEAR FROM p.birth_date)::int AS birth_year,
      (p.market_value_tier * 10 + LEAST(COALESCE(fa.finals, 0), 6) * 4 + LEAST(COALESCE(aw.awards, 0), 4) * 6)::int AS prestige,
      COALESCE(SUM(s.goals)       FILTER (WHERE s.league_id = 39), 0)::int AS pl_goals,
      COALESCE(SUM(s.assists)     FILTER (WHERE s.league_id = 39), 0)::int AS pl_assists,
      COALESCE(SUM(s.appearances) FILTER (WHERE s.league_id = 39), 0)::int AS pl_apps,
      COALESCE(SUM(s.goals)       FILTER (WHERE s.league_id = 140), 0)::int AS liga_goals,
      COALESCE(SUM(s.appearances) FILTER (WHERE s.league_id = 140), 0)::int AS liga_apps,
      COALESCE(SUM(s.goals)       FILTER (WHERE s.league_id = 135), 0)::int AS seriea_goals,
      COALESCE(SUM(s.appearances) FILTER (WHERE s.league_id = 135), 0)::int AS seriea_apps,
      COALESCE(SUM(s.goals)       FILTER (WHERE s.league_id = 2), 0)::int AS cl_goals,
      COALESCE(SUM(s.appearances) FILTER (WHERE s.league_id = 2), 0)::int AS cl_apps,
      COALESCE(SUM(s.goals)       FILTER (WHERE s.league_id = 39 AND s.team_name NOT IN (${big6Sql})), 0)::int AS pl_nonbig6_goals,
      COALESCE(SUM(s.goals)       FILTER (WHERE s.league_id IN (135, 61)), 0)::int AS seriea_ligue1_goals,
      COALESCE(SUM(s.appearances) FILTER (WHERE s.league_id IN (135, 61)), 0)::int AS seriea_ligue1_apps,
      COALESCE(SUM(s.appearances), 0)::int AS total_apps,
      COALESCE(MAX(e.pl_penalties), 0)::int AS pl_penalties,
      COALESCE(MAX(e.laliga_penalties), 0)::int AS laliga_penalties,
      COALESCE(MAX(e.seriea_penalties), 0)::int AS seriea_penalties,
      COALESCE(MAX(e.career_hattricks), 0)::int AS hattricks,
      COALESCE(MAX(e.ucl_knockout_goals), 0)::int AS ucl_ko_goals,
      COALESCE(MAX(e.weak_foot_goals), 0)::int AS weak_foot_goals,
      -- Goals before turning 21, from season totals + DOB → covers all eras (not just TM events).
      COALESCE(SUM(s.goals) FILTER (WHERE s.league_id <> 1 AND p.birth_date IS NOT NULL AND s.season <= EXTRACT(YEAR FROM p.birth_date) + 20), 0)::int AS goals_u21,
      COALESCE(MAX(${trustedIntlCapsSql('e')}), 0)::int AS intl_caps
    FROM players p
      LEFT JOIN player_stats s ON s.player_id = p.id
      LEFT JOIN player_extra_stats e ON e.player_id = p.id
      LEFT JOIN (SELECT player_id, COUNT(*) AS finals FROM final_appearances GROUP BY player_id) fa ON fa.player_id = p.id
      LEFT JOIN (SELECT player_id, COUNT(*) AS awards FROM player_awards GROUP BY player_id) aw ON aw.player_id = p.id
    GROUP BY p.id, p.name, p.position, p.api_football_id, p.nationality, p.market_value_tier, p.birth_date, fa.finals, aw.awards
  )`;

export interface OneMoreMetricCandidate {
  id: string;
  name: string;
  position: string;
  nationality: string;
  prestige: number;
  value: number;
  birth_year: number | null;
  api_football_id: number | null;
}

type Candidate = OneMoreMetricCandidate;

export interface OneMoreMetricCatalogItem {
  id: string;
  title: string;
  noun: string;
  ladder: number[];
  goalLike: boolean;
  eventBased: boolean;
}

export interface OneMoreMetricPreview {
  metric: OneMoreMetricCatalogItem;
  threshold: number;
  suggestedThreshold: number;
  counts: {
    participating: number;
    qualifying: number;
    distractors: number;
    nearQualifying: number;
    nearDistractors: number;
    verifiedPairs: number;
  };
  samples: {
    qualifying: OneMoreMetricCandidate[];
    distractors: OneMoreMetricCandidate[];
  };
  warnings: string[];
}

function catalogItem(metric: OneMoreMetricDefinition): OneMoreMetricCatalogItem {
  return {
    id: metric.id,
    title: metric.title,
    noun: metric.noun,
    ladder: [...metric.ladder],
    goalLike: metric.goalLike,
    eventBased: metric.eventBased ?? false,
  };
}

function metricById(metricId: string): OneMoreMetricDefinition | undefined {
  return METRICS.find((metric) => metric.id === metricId);
}

export function listOneMoreMetrics(): OneMoreMetricCatalogItem[] {
  return METRICS.map(catalogItem);
}

async function loadMetricCandidates(metric: OneMoreMetricDefinition): Promise<Candidate[]> {
  return (await db.execute(sql`
    ${AGG}
    SELECT id, name, position, nationality, birth_year, api_football_id, prestige, ${sql.raw(metric.col)} AS value
    FROM agg WHERE ${sql.raw(metric.part)} > 0
  `)) as unknown as Candidate[];
}

interface OneMoreMetricVerificationFact {
  id: string;
  value: number;
  participation: number;
  position: string;
  birth_year: number | null;
}

async function loadMetricVerificationFacts(
  metric: OneMoreMetricDefinition,
  playerIds: string[]
): Promise<Map<string, OneMoreMetricVerificationFact>> {
  if (playerIds.length === 0) return new Map();
  const ids = sql.join(playerIds.map((playerId) => sql`${playerId}::uuid`), sql`, `);
  const rows = (await db.execute(sql`
    ${AGG}
    SELECT id, ${sql.raw(metric.col)} AS value, ${sql.raw(metric.part)} AS participation,
      position, birth_year
    FROM agg WHERE id IN (${ids})
  `)) as unknown as OneMoreMetricVerificationFact[];
  return new Map(rows.map((row) => [row.id, row]));
}

async function clubsByPlayer(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const list = sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);
  const rows = (await db.execute(sql`
    SELECT s.player_id, s.team_name, SUM(s.appearances)::int AS apps
    FROM player_stats s JOIN players p ON p.id = s.player_id
    WHERE s.player_id IN (${list}) AND s.league_id <> 1 AND s.team_name IS NOT NULL AND s.team_name <> p.nationality
    GROUP BY s.player_id, s.team_name ORDER BY apps DESC
  `)) as unknown as Array<{ player_id: string; team_name: string }>;
  const top = new Map<string, string[]>();
  for (const r of rows) { const a = top.get(r.player_id) ?? []; if (a.length < 2) a.push(r.team_name); top.set(r.player_id, a); }
  return new Map([...top].map(([id, c]) => [id, c.join(' · ')]));
}

export async function generateOneMorePuzzle(
  date: string,
  opts?: { recentPairs?: Set<string> }
): Promise<{ puzzle: OneMorePuzzle; pool: number }> {
  const stride = 7; // coprime with metric count
  const start = ((dayNumber(date) * stride) % METRICS.length + METRICS.length) % METRICS.length;

  // Repeat suppression: the same metric coming back every ~15 days is fine, but it must bring
  // DIFFERENT rounds — exact (metric, player-pair) combos from the window are excluded.
  const recentPairs = opts?.recentPairs ?? (await recentOneMorePairs(date, ONE_MORE_REPEAT_WINDOW_DAYS));

  let fallback: { puzzle: OneMorePuzzle; pool: number } | null = null;
  for (let offset = 0; offset < METRICS.length; offset += 1) {
    const metric = METRICS[(start + offset) % METRICS.length]!;
    const built = await assembleMetric(metric, date, recentPairs);
    if (!built) continue;
    if (built.pool >= MIN_ROUNDS) return built;
    if (!fallback || built.pool > fallback.pool) fallback = built;
  }
  if (fallback) return fallback;
  throw new Error('One More: no metric produced a viable round');
}

/**
 * Recognisable players NEAR the threshold on each side. The whole point: both options are known
 * names AND both sit close to the line (one just over, one just under), so you can't win by
 * "pick the famous one" or "pick the megastar". Bands widen / fame floor drops only if a tight
 * pairing can't fill the round.
 */
/** Goalkeepers never belong on goal-like boards. Hat-tricks also drop defenders — a centre-back
 *  with 0 next to Salah is a giveaway, not a puzzle. */
function positionOk(metric: OneMoreMetricDefinition, position: string): boolean {
  if (!metric.goalLike) return true;
  if (position === 'Goalkeeper') return false;
  if (metric.id === 'hattricks' && position === 'Defender') return false;
  return true;
}

function nearPools(rows: Candidate[], min: number, above: number, below: number, floor: number, metric: OneMoreMetricDefinition) {
  const ok = (r: Candidate) => r.prestige >= floor && positionOk(metric, r.position);
  const Q = rows.filter((r) => r.value >= min && r.value <= min + above && ok(r));
  // Distractors on event-based metrics must be in the covered era (born >= 1990): we never want to
  // present a pre-2010 legend whose total we've undercounted as a wrong "doesn't qualify".
  const covered = (r: Candidate) => !metric.eventBased || (r.birth_year ?? 0) >= 1990;
  const D = rows.filter((r) => r.value < min && r.value >= min - below && ok(r) && covered(r));
  return { Q, D };
}

function metricBand(minimum: number): number {
  return Math.max(Math.round(minimum * 0.45), 8);
}

function suggestedThreshold(metric: OneMoreMetricDefinition, rows: Candidate[]): number {
  let selected = metric.ladder[0] ?? 1;
  let best = -1;
  for (const minimum of metric.ladder) {
    const width = metricBand(minimum);
    const { Q, D } = nearPools(rows, minimum, width, width, 44, metric);
    const pairs = Math.min(Q.length, D.length);
    if (pairs > best) {
      best = pairs;
      selected = minimum;
    }
  }
  return selected;
}

function requireMetric(metricId: string): OneMoreMetricDefinition {
  const metric = metricById(metricId);
  if (!metric) throw new Error(`Unknown One More metric: ${metricId}`);
  return metric;
}

export async function previewOneMoreMetric(
  metricId: string,
  requestedThreshold?: number
): Promise<OneMoreMetricPreview> {
  const metric = requireMetric(metricId);
  const rows = await loadMetricCandidates(metric);
  const suggested = suggestedThreshold(metric, rows);
  const threshold = requestedThreshold ?? suggested;
  const width = metricBand(threshold);
  const near = nearPools(rows, threshold, width, width, 44, metric);
  const eligible = rows.filter((row) => positionOk(metric, row.position));
  const coveredDistractors = eligible.filter(
    (row) => !metric.eventBased || (row.birth_year ?? 0) >= 1990
  );
  const qualifying = eligible.filter((row) => row.value >= threshold);
  const distractors = coveredDistractors.filter((row) => row.value < threshold);
  const verifiedPairs = Math.min(near.Q.length, near.D.length);
  const warnings: string[] = [];
  if (metric.eventBased) {
    warnings.push('Event-derived coverage is incomplete before roughly 2010; distractors are limited to players born in 1990 or later.');
  }
  if (verifiedPairs < MIN_ROUNDS) {
    warnings.push(`Only ${verifiedPairs} close, recognisable pairs are available at this threshold.`);
  }
  if (qualifying.length < ROUND_TARGET) warnings.push(`Only ${qualifying.length} players qualify.`);
  if (distractors.length < ROUND_TARGET) warnings.push(`Only ${distractors.length} covered distractors are available.`);
  const sample = (candidates: Candidate[]) =>
    [...candidates].sort((a, b) => b.prestige - a.prestige || Math.abs(a.value - threshold) - Math.abs(b.value - threshold)).slice(0, 8);
  return {
    metric: catalogItem(metric),
    threshold,
    suggestedThreshold: suggested,
    counts: {
      participating: rows.length,
      qualifying: qualifying.length,
      distractors: distractors.length,
      nearQualifying: near.Q.length,
      nearDistractors: near.D.length,
      verifiedPairs,
    },
    samples: { qualifying: sample(near.Q), distractors: sample(near.D) },
    warnings,
  };
}

export interface OneMoreVerifiedCandidatePair {
  options: [OneMoreMetricCandidate, OneMoreMetricCandidate];
  qualifierId: string;
  verified: true;
}

interface SelectedCandidatePair {
  q: Candidate;
  d: Candidate;
}

function selectCandidatePairs(input: {
  metric: OneMoreMetricDefinition;
  rows: Candidate[];
  minimum: number;
  seed: string;
  target: number;
  recentPairs: Set<string>;
}): SelectedCandidatePair[] {
  let above = metricBand(input.minimum);
  let below = metricBand(input.minimum);
  let floor = 44;
  let { Q, D } = nearPools(input.rows, input.minimum, above, below, floor, input.metric);
  for (let guard = 0; (Q.length < input.target || D.length < input.target) && guard < 6; guard += 1) {
    above = Math.round(above * 1.5);
    below = Math.round(below * 1.5);
    if (guard >= 2) floor = Math.max(floor - 6, 30);
    ({ Q, D } = nearPools(input.rows, input.minimum, above, below, floor, input.metric));
  }
  const target = Math.min(input.target, Q.length, D.length);
  Q.sort((a, b) => b.prestige - a.prestige);
  D.sort((a, b) => b.prestige - a.prestige);
  const jitterKey = (side: string, id: string, index: number) =>
    index + (hashStr(`${input.seed}:${input.metric.id}:${side}:${id}`) % 500) / 100;
  const qualifiers = Q
    .map((candidate, index) => ({ candidate, order: jitterKey('q', candidate.id, index) }))
    .sort((a, b) => a.order - b.order)
    .map(({ candidate }) => candidate);
  const distractors = D
    .map((candidate, index) => ({ candidate, order: jitterKey('d', candidate.id, index) }))
    .sort((a, b) => a.order - b.order)
    .map(({ candidate }) => candidate);
  const usedDistractors = new Set<number>();
  const pickDistractor = (qualifierIndex: number, allowRecent: boolean): number => {
    for (let span = 0; span < distractors.length; span += 1) {
      for (const distractorIndex of [qualifierIndex - span, qualifierIndex + span]) {
        if (distractorIndex < 0 || distractorIndex >= distractors.length || usedDistractors.has(distractorIndex)) continue;
        if (!allowRecent && input.recentPairs.has(oneMorePairKey(
          input.metric.title,
          qualifiers[qualifierIndex]!.id,
          distractors[distractorIndex]!.id
        ))) continue;
        return distractorIndex;
      }
    }
    return -1;
  };
  const pairs: SelectedCandidatePair[] = [];
  for (let qualifierIndex = 0; qualifierIndex < qualifiers.length && pairs.length < target; qualifierIndex += 1) {
    let distractorIndex = pickDistractor(qualifierIndex, false);
    if (distractorIndex < 0) distractorIndex = pickDistractor(qualifierIndex, true);
    if (distractorIndex < 0) continue;
    usedDistractors.add(distractorIndex);
    pairs.push({ q: qualifiers[qualifierIndex]!, d: distractors[distractorIndex]! });
  }
  return pairs.sort((a, b) =>
    (b.q.prestige + b.d.prestige) - (a.q.prestige + a.d.prestige)
    || (b.q.value - b.d.value) - (a.q.value - a.d.value));
}

/** Close, famous pairs with different totals — the higher one is the answer. */
function selectComparePairs(input: {
  metric: OneMoreMetricDefinition;
  rows: Candidate[];
  target: number;
  recentPairs: Set<string>;
}): SelectedCandidatePair[] {
  let floor = 44;
  const eligible = () => input.rows.filter((row) =>
    positionOk(input.metric, row.position) && row.prestige >= floor && row.value > 0
  );
  let pool = eligible();
  for (let guard = 0; pool.length < input.target * 2 && guard < 4; guard += 1) {
    floor = Math.max(floor - 6, 28);
    pool = eligible();
  }
  pool.sort((a, b) => b.prestige - a.prestige || b.value - a.value);
  const maxGap = (left: number, right: number) => Math.max(8, Math.round(Math.max(left, right) * 0.35));
  const used = new Set<string>();
  const pairs: SelectedCandidatePair[] = [];
  for (let i = 0; i < pool.length && pairs.length < input.target; i += 1) {
    const first = pool[i]!;
    if (used.has(first.id)) continue;
    let best: Candidate | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let j = i + 1; j < Math.min(pool.length, i + 20); j += 1) {
      const second = pool[j]!;
      if (used.has(second.id) || first.value === second.value) continue;
      if (input.recentPairs.has(oneMorePairKey(input.metric.title, first.id, second.id))) continue;
      const gap = Math.abs(first.value - second.value);
      if (gap > maxGap(first.value, second.value)) continue;
      const score = gap * 3 + Math.abs(first.prestige - second.prestige);
      if (score < bestScore) {
        bestScore = score;
        best = second;
      }
    }
    if (!best) continue;
    used.add(first.id);
    used.add(best.id);
    const qualifier = first.value > best.value ? first : best;
    const distractor = first.value > best.value ? best : first;
    pairs.push({ q: qualifier, d: distractor });
  }
  return pairs;
}

export async function generateOneMoreCandidatePairs(input: {
  metricId: string;
  threshold: number;
  compareMode?: boolean;
  count?: number;
  seed?: string;
}): Promise<{
  metric: OneMoreMetricCatalogItem;
  threshold: number;
  compareMode: boolean;
  pairs: OneMoreVerifiedCandidatePair[];
  warnings: string[];
}> {
  const metric = requireMetric(input.metricId);
  const rows = await loadMetricCandidates(metric);
  const count = Math.min(Math.max(input.count ?? ROUND_TARGET, 1), 50);
  const compareMode = Boolean(input.compareMode);
  const seed = input.seed ?? `${input.metricId}:${compareMode ? 'compare' : input.threshold}`;
  const selected = compareMode
    ? selectComparePairs({
      metric,
      rows,
      target: count,
      recentPairs: new Set(),
    })
    : selectCandidatePairs({
      metric,
      rows,
      minimum: input.threshold,
      seed,
      target: count,
      recentPairs: new Set(),
    });
  const pairs: OneMoreVerifiedCandidatePair[] = selected.map(({ q: qualifier, d: distractor }, index) => {
    const qualifierFirst = hashStr(`${seed}:side:${index}`) % 2 === 0;
    return {
      options: (qualifierFirst ? [qualifier, distractor] : [distractor, qualifier]) as [Candidate, Candidate],
      qualifierId: qualifier.id,
      verified: true,
    };
  });
  const warnings = pairs.length < count ? [`Requested ${count} pairs but only ${pairs.length} verified pairs were available.`] : [];
  if (metric.eventBased) warnings.push('Event-based distractors are coverage-gated to players born in 1990 or later.');
  return { metric: catalogItem(metric), threshold: input.threshold, compareMode, pairs, warnings };
}

export async function lookupOneMorePlayerMetricValue(
  metricId: string,
  playerId: string
): Promise<{ playerId: string; metricId: string; value: number } | null> {
  const metric = requireMetric(metricId);
  const facts = await loadMetricVerificationFacts(metric, [playerId]);
  const fact = facts.get(playerId);
  return fact === undefined ? null : { playerId, metricId, value: fact.value };
}

export interface OneMoreCandidateValueInput {
  playerId: string;
  expectedValue?: number;
}

export interface OneMoreCandidatePairVerification {
  valid: boolean;
  options: Array<{
    playerId: string;
    expectedValue?: number;
    actualValue: number | null;
    qualifies: boolean | null;
    valueMatches: boolean;
  }>;
  errors: string[];
}

/** Semantic validation for Ops saves: DB values must match and each pair needs exactly one qualifier. */
export async function verifyOneMoreCandidateValues(
  metricId: string,
  threshold: number,
  pairs: Array<[OneMoreCandidateValueInput, OneMoreCandidateValueInput]>,
  opts?: { compareMode?: boolean }
): Promise<OneMoreCandidatePairVerification[]> {
  const metric = requireMetric(metricId);
  const uniqueIds = [...new Set(pairs.flatMap((pair) => pair.map((option) => option.playerId)))];
  const facts = await loadMetricVerificationFacts(metric, uniqueIds);
  return pairs.map((pair) => {
    const raw = pair.map((option) => {
      const fact = facts.get(option.playerId);
      const actualValue = fact?.value ?? null;
      return {
        playerId: option.playerId,
        expectedValue: option.expectedValue,
        actualValue,
        valueMatches: actualValue !== null && (option.expectedValue === undefined || option.expectedValue === actualValue),
      };
    });
    const known = raw.map((option) => option.actualValue).filter((value): value is number => typeof value === 'number');
    const best = known.length === raw.length ? Math.max(...known) : null;
    const uniqueWinner = best !== null && known.filter((value) => value === best).length === 1;
    const options = raw.map((option) => ({
      ...option,
      qualifies: option.actualValue === null
        ? null
        : opts?.compareMode
          ? uniqueWinner && option.actualValue === best
          : option.actualValue >= threshold,
    }));
    const errors: string[] = [];
    if (options.some((option) => option.actualValue === null)) errors.push('A player was not found.');
    if (options.some((option) => !option.valueMatches)) errors.push('A supplied value does not match the database.');
    pair.forEach((option, index) => {
      const fact = facts.get(option.playerId);
      if (!fact) return;
      for (const message of oneMoreEligibilityErrors(metric, {
        participation: fact.participation,
        position: fact.position,
        birthYear: fact.birth_year,
        value: fact.value,
      }, opts?.compareMode ? 0 : threshold)) {
        errors.push(`Option ${index + 1}: ${message}`);
      }
    });
    if (opts?.compareMode) {
      if (known.length === raw.length && !uniqueWinner) {
        errors.push('Pair must have two different totals — the higher one is the answer.');
      }
    } else if (options.filter((option) => option.qualifies).length !== 1) {
      errors.push('Pair must contain exactly one qualifying player.');
    }
    return { valid: errors.length === 0, options, errors };
  });
}

async function assembleMetric(
  metric: OneMoreMetricDefinition,
  date: string,
  recentPairs: Set<string>
): Promise<{ puzzle: OneMorePuzzle; pool: number } | null> {
  const rows = await loadMetricCandidates(metric);

  // Pick the threshold that yields the most CLOSE, recognisable pairs (one just over, one just
  // under), using a tight band around the line — that's what makes each round genuinely hard.
  let minimum = 0;
  let best = -1;
  for (const min of metric.ladder) {
    const { Q, D } = nearPools(rows, min, metricBand(min), metricBand(min), 44, metric);
    const pairs = Math.min(Q.length, D.length);
    if (pairs > best) { best = pairs; minimum = min; }
  }
  if (minimum === 0) return null;

  // Shared with Ops candidate generation so previews and daily output use identical pool,
  // fame matching, coverage gating, and deterministic jitter rules.
  const pairs = selectCandidatePairs({
    metric,
    rows,
    minimum,
    seed: date,
    target: ROUND_TARGET,
    recentPairs,
  });
  if (pairs.length < MIN_ROUNDS) return null;

  const ids = pairs.flatMap((p) => [p.q.id, p.d.id]);
  const clubs = await clubsByPlayer(ids);
  const primaryClub = (id: string) => (clubs.get(id) ?? '').split(' · ')[0] ?? '';
  // Resolve the primary club's crest (by name — lookup falls back to top-5 clubs) for the card badge.
  const logoByClub = new Map<string, { teamId: number; logoUrl: string }>();
  for (const club of [...new Set(ids.map(primaryClub).filter(Boolean))]) {
    const logo = await lookupTeamLogo(club, '');
    if (logo) logoByClub.set(club, logo);
  }
  const overrides = await getPhotoOverrides();
  const toOption = (c: Candidate): OneMoreOption => {
    const logo = logoByClub.get(primaryClub(c.id));
    return {
      id: c.id, name: c.name, clubs: clubs.get(c.id) ?? '', position: c.position, nationality: c.nationality, value: c.value,
      headshotUrl: resolveHeadshot(overrides.get(c.id), c.api_football_id) ?? undefined,
      teamId: logo?.teamId, teamLogoUrl: logo?.logoUrl,
    };
  };

  // Which side the qualifier sits on, per round. A well-mixed per-round hash (not an LCG top bit,
  // which can correlate into long runs), THEN a guard that breaks any run of >3 — so the correct
  // answer never sits on the same side for long.
  const seed = dayNumber(date) + metric.id.length * 31;
  const qualifierFirst = pairs.map((_, i) => {
    let x = (Math.imul(seed + 1, 0x9e3779b1) + Math.imul(i + 1, 0x85ebca77)) >>> 0;
    x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d) >>> 0; x ^= x >>> 13; x = Math.imul(x, 0x297a2d39) >>> 0; x ^= x >>> 16;
    return (x & 1) === 0;
  });
  let run = 1;
  for (let i = 1; i < qualifierFirst.length; i += 1) {
    if (qualifierFirst[i] === qualifierFirst[i - 1]) {
      run += 1;
      if (run > 3) { qualifierFirst[i] = !qualifierFirst[i]; run = 1; }
    } else run = 1;
  }

  const rounds: OneMoreRound[] = pairs.map(({ q, d }, i) =>
    ({ options: (qualifierFirst[i] ? [toOption(q), toOption(d)] : [toOption(d), toOption(q)]) as [OneMoreOption, OneMoreOption] }));

  return {
    puzzle: {
      modeId: 'one_more',
      puzzleId: `${date}-one_more`,
      date,
      metricId: metric.id,
      title: metric.title,
      valueNoun: metric.noun,
      minimum,
      rounds,
    },
    pool: pairs.length,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);
  generateOneMorePuzzle(date)
    .then(({ puzzle, pool }) => {
      console.log(`\n=== ONE MORE ${date} === ${puzzle.minimum}+ ${puzzle.title} (${puzzle.rounds.length} rounds · pool ${pool})`);
      for (const [i, r] of puzzle.rounds.entries()) {
        const tag = (o: OneMoreOption) => `${o.name} ${o.value >= puzzle.minimum ? '✅' : '❌'}(${o.value})`;
        console.log(`  ${String(i + 1).padStart(2)}. ${tag(r.options[0])}  vs  ${tag(r.options[1])}`);
      }
      process.exit(0);
    })
    .catch((err) => { console.error(err); process.exit(1); });
}
