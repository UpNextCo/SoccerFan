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

const LEAGUES = [
  { id: 39, name: 'Premier League' },
  { id: 140, name: 'La Liga' },
  { id: 135, name: 'Serie A' },
  { id: 78, name: 'Bundesliga' },
  { id: 61, name: 'Ligue 1' },
];

type Category = 'goals' | 'assists' | 'appearances';
const CATEGORIES: Category[] = ['goals', 'assists', 'appearances'];

/** Candidate minimums per category (career totals within one league). */
const MINIMUMS: Record<Category, number[]> = {
  goals: [20, 30, 40, 50, 60, 75],
  assists: [15, 20, 25, 30, 40],
  appearances: [100, 150, 200, 250, 300],
};

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

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
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

export async function generateOneMorePuzzle(date: string): Promise<{ puzzle: OneMorePuzzle; pool: number }> {
  // Independent salted hashes so league and category vary day to day.
  const league = LEAGUES[hashStr(`${date}:one_more:league`) % LEAGUES.length]!;
  const category = CATEGORIES[hashStr(`${date}:one_more:category`) % CATEGORIES.length]!;

  // Pick the minimum whose qualifying pool is closest to TARGET within [MIN,MAX].
  let best: { min: number; pool: number } | null = null;
  for (const min of MINIMUMS[category]) {
    const pool = await countQualifying(league.id, category, min);
    const inRange = pool >= MIN_POOL && pool <= MAX_POOL;
    if (inRange) {
      if (!best || Math.abs(pool - TARGET_POOL) < Math.abs(best.pool - TARGET_POOL)) best = { min, pool };
    }
  }
  // Fallback: if nothing in range, take the minimum giving the largest pool >= MIN_POOL,
  // else the smallest minimum (most inclusive).
  if (!best) {
    for (const min of MINIMUMS[category]) {
      const pool = await countQualifying(league.id, category, min);
      if (!best || pool > best.pool) best = { min, pool };
    }
  }

  const minimum = best!.min;
  return {
    puzzle: {
      modeId: 'one_more',
      puzzleId: `${date}-one_more`,
      date,
      leagueId: league.id,
      league: league.name,
      category,
      minimum,
      title: titleFor(league.name, category, minimum),
    },
    pool: best!.pool,
  };
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
