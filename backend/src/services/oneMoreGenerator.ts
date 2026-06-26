/**
 * One More generator. Picks a daily "name a {league} player with {min}+ {stat}" prompt
 * from real career data, choosing a minimum that yields a healthy pool (challenging but
 * playable). Answers are validated server-side against the same career sums.
 *
 * Dry run: DATABASE_URL=... npm run job:gen-onemore [date]
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

type Category = 'goals' | 'assists' | 'appearances';
const CATEGORIES: Category[] = ['goals', 'assists', 'appearances'];

interface Competition {
  id: number;
  name: string;
  minimums: Record<Category, number[]>;
}

/** Domestic-league career-total ladders (full-length careers → high thresholds). */
const DOMESTIC_MINIMUMS: Record<Category, number[]> = {
  goals: [20, 30, 40, 50, 60, 75],
  assists: [15, 20, 25, 30, 40],
  appearances: [100, 150, 200, 250, 300],
};

/** Continental-cup ladders — far fewer games per season, so lower thresholds. */
const CUP_MINIMUMS: Record<Category, number[]> = {
  goals: [10, 15, 20, 25, 30],
  assists: [6, 8, 10, 15],
  appearances: [30, 50, 75, 100],
};

const COMPETITIONS: Competition[] = [
  { id: 39, name: 'Premier League', minimums: DOMESTIC_MINIMUMS },
  { id: 140, name: 'La Liga', minimums: DOMESTIC_MINIMUMS },
  { id: 135, name: 'Serie A', minimums: DOMESTIC_MINIMUMS },
  { id: 78, name: 'Bundesliga', minimums: DOMESTIC_MINIMUMS },
  { id: 61, name: 'Ligue 1', minimums: DOMESTIC_MINIMUMS },
  { id: 2, name: 'Champions League', minimums: CUP_MINIMUMS },
  { id: 3, name: 'Europa League', minimums: CUP_MINIMUMS },
];

const TARGET_POOL = 60;
const MIN_POOL = 25;
const MAX_POOL = 160;

const ROUND_TARGET = 20; // how many binary rounds we try to pre-build per day
const MIN_ROUNDS = 10;   // below this, the combo is too thin — try another

/** One pickable name in a round; `value` is its career total of the category in the league. */
export interface OneMoreOption {
  id: string;
  name: string;
  clubs: string;
  position: string;
  value: number;
}

/** A binary round: exactly two options, one of which clears the day's threshold. */
export interface OneMoreRound {
  options: [OneMoreOption, OneMoreOption];
}

export interface OneMorePuzzle {
  modeId: 'one_more';
  puzzleId: string;
  date: string;
  leagueId: number;
  league: string;
  category: Category;
  minimum: number;
  title: string;
  rounds: OneMoreRound[];
}

/** Whole days since the Unix epoch for a YYYY-MM-DD date (UTC). */
function dayNumber(date: string): number {
  const ms = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.floor(ms / 86_400_000) : 0;
}

async function countQualifying(leagueId: number, category: Category, min: number): Promise<number> {
  const col = sql.raw(category); // safe: category is from a fixed union
  const rows = (await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM (
      SELECT player_id, SUM(${col})::int AS total
      FROM player_stats WHERE league_id = ${leagueId}
      GROUP BY player_id
    ) t WHERE total >= ${min}
  `)) as unknown as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

/** Stat total for one player in a league (for validation). */
export async function oneMoreStatValue(playerId: string, leagueId: number, category: Category): Promise<number> {
  const col = sql.raw(category);
  const rows = (await db.execute(sql`
    SELECT COALESCE(SUM(${col}), 0)::int AS total
    FROM player_stats WHERE player_id = ${playerId} AND league_id = ${leagueId}
  `)) as unknown as Array<{ total: number }>;
  return rows[0]?.total ?? 0;
}

function titleFor(league: string, category: Category, minimum: number): string {
  return `${league} players with ${minimum}+ ${category}`;
}

interface Candidate {
  id: string;
  name: string;
  position: string;
  value: number;        // category total in THIS league
  careerValue: number;  // category total across all club leagues (fame-elsewhere signal)
  prestige: number;
}

/** Deterministic per-day RNG so the round sequence is identical for everyone. */
function makeRng(seed: number): () => number {
  let s = (seed ^ 0x9e3779b9) >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** Top clubs (by appearances, excluding national teams) for a set of players. */
async function clubsByPlayer(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const list = sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);
  const rows = (await db.execute(sql`
    SELECT s.player_id, s.team_name, SUM(s.appearances)::int AS apps
    FROM player_stats s JOIN players p ON p.id = s.player_id
    WHERE s.player_id IN (${list}) AND s.league_id <> 1 AND s.team_name IS NOT NULL
      AND s.team_name <> p.nationality
    GROUP BY s.player_id, s.team_name ORDER BY apps DESC
  `)) as unknown as Array<{ player_id: string; team_name: string }>;
  const top = new Map<string, string[]>();
  for (const r of rows) {
    const arr = top.get(r.player_id) ?? [];
    if (arr.length < 2) arr.push(r.team_name);
    top.set(r.player_id, arr);
  }
  return new Map([...top].map(([id, clubs]) => [id, clubs.join(' · ')]));
}

/**
 * Build the day's binary rounds. Pairs a genuine qualifier (>= minimum) with a *tempting*
 * distractor (< minimum but plausible — close to the line, famous elsewhere, or a big name with
 * modest output here). Rounds ramp easy → hard: early rounds are an obvious star vs an obvious
 * dud; later rounds are a lesser qualifier vs a very tempting trap. Returns null if too thin.
 */
async function buildRounds(
  comp: Competition, category: Category, minimum: number, date: string
): Promise<OneMoreRound[] | null> {
  const col = sql.raw(category); // safe: fixed union
  const rows = (await db.execute(sql`
    WITH agg AS (
      SELECT p.id, p.name, p.position, p.market_value_tier AS mvt,
        COALESCE(fa.finals, 0) AS finals,
        COALESCE(aw.awards, 0) AS awards,
        COALESCE(SUM(s.${col})       FILTER (WHERE s.league_id = ${comp.id}), 0)::int AS value,
        COALESCE(SUM(s.appearances)  FILTER (WHERE s.league_id = ${comp.id}), 0)::int AS league_apps,
        COALESCE(SUM(s.${col})       FILTER (WHERE s.league_id <> 1), 0)::int AS career_value
      FROM players p
        LEFT JOIN player_stats s ON s.player_id = p.id
        LEFT JOIN (SELECT player_id, COUNT(*) AS finals FROM final_appearances GROUP BY player_id) fa ON fa.player_id = p.id
        LEFT JOIN (SELECT player_id, COUNT(*) AS awards FROM player_awards GROUP BY player_id) aw ON aw.player_id = p.id
      GROUP BY p.id, p.name, p.position, p.market_value_tier, fa.finals, aw.awards
    )
    SELECT id, name, position, value, career_value,
      (mvt * 10 + LEAST(finals, 6) * 4 + LEAST(awards, 4) * 6)::int AS prestige
    FROM agg WHERE league_apps > 0
  `)) as unknown as Candidate[];

  // Qualifiers: recognisable first.
  const qualifiers = rows.filter((r) => r.value >= minimum).sort((a, b) => b.prestige - a.prestige);

  // Distractors must be BELIEVABLE — either close to the line OR a genuinely recognisable name
  // (prestige). This excludes the long tail of unknowns sitting just over the plausibility floor,
  // which would make the pick obvious. "Temptation" = how much it LOOKS like it qualifies.
  const temptation = (r: Candidate) =>
    r.prestige + (r.value / minimum) * 45 + (r.careerValue >= minimum ? 15 : 0);
  const distractors = rows
    .filter((r) => r.value < minimum && (r.value >= minimum * 0.5 || r.prestige >= 44))
    // A keeper in a goals/assists round is an obvious "no" — keep distractors tempting.
    .filter((r) => category === 'appearances' || r.position !== 'Goalkeeper')
    .sort((a, b) => temptation(a) - temptation(b)); // least → most tempting

  const n = Math.min(ROUND_TARGET, qualifiers.length, distractors.length);
  if (n < MIN_ROUNDS) return null;

  // Even-spread the distractors across their temptation range so rounds ramp easy → hard.
  const chosenD: Candidate[] = [];
  let last = -1;
  for (let i = 0; i < n; i += 1) {
    let idx = Math.round((i * (distractors.length - 1)) / Math.max(1, n - 1));
    if (idx <= last) idx = last + 1;
    if (idx >= distractors.length) break;
    chosenD.push(distractors[idx]!);
    last = idx;
  }
  const rounds_n = Math.min(n, chosenD.length);
  if (rounds_n < MIN_ROUNDS) return null;

  const rng = makeRng(dayNumber(date) + comp.id * 31 + category.length);
  const ids = [...qualifiers.slice(0, rounds_n), ...chosenD].map((c) => c.id);
  const clubs = await clubsByPlayer(ids);
  const toOption = (c: Candidate): OneMoreOption => ({
    id: c.id, name: c.name, clubs: clubs.get(c.id) ?? '', position: c.position, value: c.value,
  });

  const rounds: OneMoreRound[] = [];
  for (let i = 0; i < rounds_n; i += 1) {
    const q = toOption(qualifiers[i]!);          // famous → less famous as rounds progress
    const d = toOption(chosenD[i]!);             // least → most tempting
    // Randomise which side the qualifier sits on so it isn't always the same position.
    rounds.push({ options: rng() < 0.5 ? [q, d] : [d, q] });
  }
  return rounds;
}

/** Best minimum for a competition+category: pool closest to target within range,
 *  else the largest available pool (so the caller can still compare/fallback). */
async function bestMinimum(
  comp: Competition,
  category: Category
): Promise<{ min: number; pool: number } | null> {
  let inRange: { min: number; pool: number } | null = null;
  let largest: { min: number; pool: number } | null = null;

  for (const min of comp.minimums[category]) {
    const pool = await countQualifying(comp.id, category, min);
    if (!largest || pool > largest.pool) largest = { min, pool };
    if (pool >= MIN_POOL && pool <= MAX_POOL) {
      if (!inRange || Math.abs(pool - TARGET_POOL) < Math.abs(inRange.pool - TARGET_POOL)) {
        inRange = { min, pool };
      }
    }
  }

  return inRange ?? largest;
}

export async function generateOneMorePuzzle(date: string): Promise<{ puzzle: OneMorePuzzle; pool: number }> {
  // Build every competition×category combo and rotate through them with a stride
  // coprime to the count, so days cycle evenly across all prompts (no clustering).
  const combos: Array<{ comp: Competition; category: Category }> = [];
  for (const comp of COMPETITIONS) {
    for (const category of CATEGORIES) combos.push({ comp, category });
  }
  const stride = 13; // coprime with 21 combos
  const start = ((dayNumber(date) * stride) % combos.length + combos.length) % combos.length;

  let fallback: { puzzle: OneMorePuzzle; pool: number } | null = null;

  for (let offset = 0; offset < combos.length; offset += 1) {
    const { comp, category } = combos[(start + offset) % combos.length]!;
    const best = await bestMinimum(comp, category);
    if (!best) continue;

    // Need a healthy pool AND enough buildable rounds for this combo.
    if (best.pool < MIN_POOL) {
      if (!fallback || best.pool > fallback.pool) {
        const rounds = await buildRounds(comp, category, best.min, date);
        if (rounds) fallback = { puzzle: assemble(comp, category, best.min, date, rounds), pool: best.pool };
      }
      continue;
    }
    const rounds = await buildRounds(comp, category, best.min, date);
    if (!rounds) continue;
    return { puzzle: assemble(comp, category, best.min, date, rounds), pool: best.pool };
  }

  if (fallback) return fallback;
  throw new Error('One More: no competition produced a viable prompt');
}

function assemble(
  comp: Competition, category: Category, minimum: number, date: string, rounds: OneMoreRound[]
): OneMorePuzzle {
  return {
    modeId: 'one_more',
    puzzleId: `${date}-one_more`,
    date,
    leagueId: comp.id,
    league: comp.name,
    category,
    minimum,
    title: titleFor(comp.name, category, minimum),
    rounds,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);
  generateOneMorePuzzle(date)
    .then(({ puzzle, pool }) => {
      console.log(`\n=== ONE MORE ${date} ===`);
      console.log(`  ${puzzle.title}  (${puzzle.rounds.length} rounds · pool ${pool})`);
      for (const [i, r] of puzzle.rounds.entries()) {
        const [a, b] = r.options;
        const tag = (o: typeof a) => `${o.name} ${o.value >= puzzle.minimum ? '✅' : '❌'}(${o.value})`;
        console.log(`  ${String(i + 1).padStart(2)}. ${tag(a)}   vs   ${tag(b)}`);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
