import { sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { lookupTeamLogo } from '../teamService.js';

export function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

export function seededIndex(seed: string, mod: number): number {
  if (mod <= 0) return 0;
  return hashStr(seed) % mod;
}

export function seededShuffle<T>(items: T[], seed: string): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = hashStr(`${seed}:${i}`) % (i + 1);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

export function pickN<T>(items: T[], seed: string, n: number): T[] {
  return seededShuffle(items, seed).slice(0, Math.min(n, items.length));
}

export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return name;
  return parts[parts.length - 1] ?? name;
}

export function makeOptionId(questionId: string, key: string): string {
  return `${questionId}-${key}`;
}

export async function teamLogoForClub(club: string): Promise<string | undefined> {
  const hit = await lookupTeamLogo(club, '');
  return hit?.logoUrl ?? undefined;
}

export interface FamousPlayer {
  id: string;
  name: string;
  nationality: string;
  position: string;
  prestige: number;
}

export async function famousPlayers(minTier = 4, limit = 500): Promise<FamousPlayer[]> {
  const rows = (await db.execute(sql`
    WITH agg AS (
      SELECT p.id, p.name, p.nationality, p.position, p.market_value_tier AS mvt,
        (p.market_value_tier * 10
          + LEAST(COALESCE(fa.finals, 0), 6) * 4
          + LEAST(COALESCE(aw.awards, 0), 4) * 6)::int AS prestige
      FROM players p
      LEFT JOIN (
        SELECT player_id, count(*)::int AS finals
        FROM final_appearances GROUP BY player_id
      ) fa ON fa.player_id = p.id
      LEFT JOIN (
        SELECT player_id, count(*)::int AS awards
        FROM player_awards GROUP BY player_id
      ) aw ON aw.player_id = p.id
      WHERE p.market_value_tier >= ${minTier}
    )
    SELECT id, name, nationality, position, prestige
    FROM agg
    ORDER BY prestige DESC
    LIMIT ${limit}
  `)) as unknown as FamousPlayer[];
  return rows;
}

export const PL_LEAGUE = 'Premier League';
export const BIG6 = ['Manchester United', 'Manchester City', 'Chelsea', 'Arsenal', 'Liverpool', 'Tottenham'];
