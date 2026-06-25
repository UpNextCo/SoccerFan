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

export interface OneMorePuzzle {
  modeId: 'one_more';
  puzzleId: string;
  date: string;
  leagueId: number;
  league: string;
  category: Category;
  minimum: number;
  title: string;
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

    const puzzle: OneMorePuzzle = {
      modeId: 'one_more',
      puzzleId: `${date}-one_more`,
      date,
      leagueId: comp.id,
      league: comp.name,
      category,
      minimum: best.min,
      title: titleFor(comp.name, category, best.min),
    };

    // Healthy pool → use today's rotated combo immediately.
    if (best.pool >= MIN_POOL) return { puzzle, pool: best.pool };
    // Otherwise remember the deepest pool seen and keep looking.
    if (!fallback || best.pool > fallback.pool) fallback = { puzzle, pool: best.pool };
  }

  if (fallback) return fallback;
  throw new Error('One More: no competition produced a viable prompt');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);
  generateOneMorePuzzle(date)
    .then(({ puzzle, pool }) => {
      console.log(`\n=== ONE MORE ${date} ===`);
      console.log(`  ${puzzle.title}`);
      console.log(`  league ${puzzle.leagueId} · category ${puzzle.category} · minimum ${puzzle.minimum} · pool ${pool} qualifying players`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
