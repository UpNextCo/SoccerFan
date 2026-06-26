/**
 * One More generator (binary pick). Picks a daily METRIC (e.g. "career penalty goals",
 * "Champions League knockout goals", "Premier League goals") and a threshold that yields a
 * healthy pool, then pre-builds ~20 ramped binary rounds: each pairs a genuine qualifier
 * (>= threshold) with a tempting distractor (< threshold but believable). The deliberate move
 * away from "Champions League appearances"-style prompts toward richer, match-level categories.
 *
 * Match-level metrics come from player_extra_stats (the Transfermarkt events ingest).
 * Dry run: DATABASE_URL=... npx tsx src/services/oneMoreGenerator.ts [date]
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

const TARGET_POOL = 50;
const MIN_POOL = 20;
const MAX_POOL = 200;
const ROUND_TARGET = 20;
const MIN_ROUNDS = 10;

const BIG6 = ['Manchester United', 'Manchester City', 'Chelsea', 'Arsenal', 'Liverpool', 'Tottenham'];
const big6Sql = sql.join(BIG6.map((t) => sql`${t}`), sql`, `);

interface Metric {
  id: string;
  title: string;   // shown as "WHO HAS {min}+ {title}?"
  noun: string;    // reveal unit, e.g. "goals", "pens", "caps"
  col: string;     // value column in AGG
  part: string;    // participation column (must be > 0 to appear) in AGG
  ladder: number[];
  goalLike: boolean; // exclude goalkeepers from distractors when true
}

const METRICS: Metric[] = [
  { id: 'pl_goals', title: 'Premier League goals', noun: 'goals', col: 'pl_goals', part: 'pl_apps', ladder: [20, 30, 40, 50, 60, 75], goalLike: true },
  { id: 'pl_assists', title: 'Premier League assists', noun: 'assists', col: 'pl_assists', part: 'pl_apps', ladder: [15, 20, 30, 40, 50], goalLike: false },
  { id: 'laliga_goals', title: 'La Liga goals', noun: 'goals', col: 'liga_goals', part: 'liga_apps', ladder: [20, 30, 40, 50, 75], goalLike: true },
  { id: 'seriea_goals', title: 'Serie A goals', noun: 'goals', col: 'seriea_goals', part: 'seriea_apps', ladder: [20, 30, 40, 50, 75], goalLike: true },
  { id: 'cl_goals', title: 'Champions League goals', noun: 'goals', col: 'cl_goals', part: 'cl_apps', ladder: [10, 15, 20, 25, 30], goalLike: true },
  { id: 'cl_knockout_goals', title: 'Champions League knockout goals', noun: 'goals', col: 'ucl_ko_goals', part: 'cl_apps', ladder: [3, 5, 8, 12, 18], goalLike: true },
  { id: 'penalty_goals', title: 'career penalty goals', noun: 'pens', col: 'penalty_goals', part: 'total_apps', ladder: [15, 20, 30, 40, 50], goalLike: true },
  { id: 'hattricks', title: 'career hat-tricks', noun: 'hat-tricks', col: 'hattricks', part: 'total_apps', ladder: [3, 5, 8, 10, 15], goalLike: true },
  { id: 'intl_caps', title: 'international caps', noun: 'caps', col: 'intl_caps', part: 'total_apps', ladder: [30, 50, 75, 100, 125], goalLike: false },
  { id: 'goals_before_21', title: 'goals before turning 21', noun: 'goals', col: 'goals_u21', part: 'total_apps', ladder: [5, 8, 12, 18, 25], goalLike: true },
  { id: 'weak_foot_goals', title: 'weak-foot goals', noun: 'goals', col: 'weak_foot_goals', part: 'total_apps', ladder: [15, 25, 40, 60], goalLike: true },
  { id: 'non_big6_pl_goals', title: 'Premier League goals for a non–Big Six club', noun: 'goals', col: 'pl_nonbig6_goals', part: 'pl_apps', ladder: [20, 30, 40, 50, 60], goalLike: true },
  { id: 'seriea_ligue1_goals', title: 'Serie A and Ligue 1 goals combined', noun: 'goals', col: 'seriea_ligue1_goals', part: 'seriea_ligue1_apps', ladder: [30, 50, 75, 100], goalLike: true },
];

export interface OneMoreOption {
  id: string;
  name: string;
  clubs: string;
  position: string;
  value: number;
}
export interface OneMoreRound {
  options: [OneMoreOption, OneMoreOption];
}
export interface OneMorePuzzle {
  modeId: 'one_more';
  puzzleId: string;
  date: string;
  title: string;
  valueNoun: string;
  minimum: number;
  rounds: OneMoreRound[];
}

function dayNumber(date: string): number {
  const ms = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.floor(ms / 86_400_000) : 0;
}
function makeRng(seed: number): () => number {
  let s = (seed ^ 0x9e3779b9) >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0x100000000; };
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
    SELECT p.id, p.name, p.position,
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
      COALESCE(MAX(e.penalty_goals), 0)::int AS penalty_goals,
      COALESCE(MAX(e.career_hattricks), 0)::int AS hattricks,
      COALESCE(MAX(e.ucl_knockout_goals), 0)::int AS ucl_ko_goals,
      COALESCE(MAX(e.weak_foot_goals), 0)::int AS weak_foot_goals,
      COALESCE(MAX(e.goals_before_21), 0)::int AS goals_u21,
      COALESCE(MAX(e.intl_caps), 0)::int AS intl_caps
    FROM players p
      LEFT JOIN player_stats s ON s.player_id = p.id
      LEFT JOIN player_extra_stats e ON e.player_id = p.id
      LEFT JOIN (SELECT player_id, COUNT(*) AS finals FROM final_appearances GROUP BY player_id) fa ON fa.player_id = p.id
      LEFT JOIN (SELECT player_id, COUNT(*) AS awards FROM player_awards GROUP BY player_id) aw ON aw.player_id = p.id
    GROUP BY p.id, p.name, p.position, p.market_value_tier, fa.finals, aw.awards
  )`;

interface Candidate { id: string; name: string; position: string; prestige: number; value: number; }

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

export async function generateOneMorePuzzle(date: string): Promise<{ puzzle: OneMorePuzzle; pool: number }> {
  const stride = 7; // coprime with metric count
  const start = ((dayNumber(date) * stride) % METRICS.length + METRICS.length) % METRICS.length;

  let fallback: { puzzle: OneMorePuzzle; pool: number } | null = null;
  for (let offset = 0; offset < METRICS.length; offset += 1) {
    const metric = METRICS[(start + offset) % METRICS.length]!;
    const built = await assembleMetric(metric, date);
    if (!built) continue;
    if (built.pool >= MIN_POOL) return built;
    if (!fallback || built.pool > fallback.pool) fallback = built;
  }
  if (fallback) return fallback;
  throw new Error('One More: no metric produced a viable round');
}

/** Build the metric's candidate pool + ramped rounds, with clubs attached. */
async function assembleMetric(metric: Metric, date: string): Promise<{ puzzle: OneMorePuzzle; pool: number } | null> {
  const rows = (await db.execute(sql`
    ${AGG}
    SELECT id, name, position, prestige, ${sql.raw(metric.col)} AS value
    FROM agg WHERE ${sql.raw(metric.part)} > 0
  `)) as unknown as Candidate[];

  let chosenMin: number | null = null;
  let chosenPool = 0;
  let fbMin = 0;
  let fbPool = -1;
  for (const min of metric.ladder) {
    const pool = rows.filter((r) => r.value >= min).length;
    if (pool > fbPool) { fbPool = pool; fbMin = min; }
    if (pool >= MIN_POOL && pool <= MAX_POOL && (chosenMin === null || Math.abs(pool - TARGET_POOL) < Math.abs(chosenPool - TARGET_POOL))) {
      chosenMin = min; chosenPool = pool;
    }
  }
  const minimum = chosenMin ?? fbMin;
  const pool = chosenMin ? chosenPool : fbPool;

  const qualifiers = rows.filter((r) => r.value >= minimum).sort((a, b) => b.prestige - a.prestige);
  const temptation = (r: Candidate) => r.prestige + (r.value / minimum) * 45;
  const distractors = rows
    .filter((r) => r.value < minimum && (r.value >= minimum * 0.5 || r.prestige >= 44))
    .filter((r) => !metric.goalLike || r.position !== 'Goalkeeper')
    .sort((a, b) => temptation(a) - temptation(b));

  const n = Math.min(ROUND_TARGET, qualifiers.length, distractors.length);
  if (n < MIN_ROUNDS) return null;

  const chosenD: Candidate[] = [];
  let last = -1;
  for (let i = 0; i < n; i += 1) {
    let idx = Math.round((i * (distractors.length - 1)) / Math.max(1, n - 1));
    if (idx <= last) idx = last + 1;
    if (idx >= distractors.length) break;
    chosenD.push(distractors[idx]!);
    last = idx;
  }
  const roundsN = Math.min(n, chosenD.length);
  if (roundsN < MIN_ROUNDS) return null;

  const rng = makeRng(dayNumber(date) + metric.id.length * 31);
  const ids = [...qualifiers.slice(0, roundsN), ...chosenD].map((c) => c.id);
  const clubs = await clubsByPlayer(ids);
  const toOption = (c: Candidate): OneMoreOption => ({
    id: c.id, name: c.name, clubs: clubs.get(c.id) ?? '', position: c.position, value: c.value,
  });

  const rounds: OneMoreRound[] = [];
  for (let i = 0; i < roundsN; i += 1) {
    const q = toOption(qualifiers[i]!);
    const d = toOption(chosenD[i]!);
    rounds.push({ options: rng() < 0.5 ? [q, d] : [d, q] });
  }

  return {
    puzzle: { modeId: 'one_more', puzzleId: `${date}-one_more`, date, title: metric.title, valueNoun: metric.noun, minimum, rounds },
    pool,
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
