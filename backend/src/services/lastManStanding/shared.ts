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
  mvt: number;
  plApps: number;
  uclApps: number;
}

export async function famousPlayers(minTier = 4, limit = 500): Promise<FamousPlayer[]> {
  const rows = (await db.execute(sql`
    WITH agg AS (
      SELECT p.id, p.name, p.nationality, p.position, p.market_value_tier AS mvt,
        COALESCE(SUM(s.appearances) FILTER (WHERE s.league_id = 39), 0)::int AS pl_apps,
        COALESCE(SUM(s.appearances) FILTER (WHERE s.league_id = 2), 0)::int AS ucl_apps,
        (p.market_value_tier * 10
          + LEAST(COALESCE(MAX(fa.finals), 0), 6) * 4
          + LEAST(COALESCE(MAX(aw.awards), 0), 4) * 6)::int AS prestige
      FROM players p
      LEFT JOIN player_stats s ON s.player_id = p.id
      LEFT JOIN (
        SELECT player_id, count(*)::int AS finals
        FROM final_appearances GROUP BY player_id
      ) fa ON fa.player_id = p.id
      LEFT JOIN (
        SELECT player_id, count(*)::int AS awards
        FROM player_awards GROUP BY player_id
      ) aw ON aw.player_id = p.id
      WHERE p.market_value_tier >= ${minTier}
        -- Drop intl-only shells (e.g. duplicate Dani Carvajal with WC/Euro rows but no clubs).
        AND (
          EXISTS (
            SELECT 1 FROM player_career c
            WHERE c.player_id = p.id AND c.team_id > 0
          )
          OR EXISTS (
            SELECT 1 FROM player_stats s2
            WHERE s2.player_id = p.id AND s2.appearances > 0
              AND s2.league_id IN (39, 140, 135, 78, 61, 2)
          )
        )
      GROUP BY p.id, p.name, p.nationality, p.position, p.market_value_tier
    )
    SELECT id, name, nationality, position, prestige, mvt, pl_apps, ucl_apps
    FROM agg
    ORDER BY prestige DESC
    LIMIT ${limit}
  `)) as unknown as Array<{
    id: string;
    name: string;
    nationality: string;
    position: string;
    prestige: number;
    mvt: number;
    pl_apps: number;
    ucl_apps: number;
  }>;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    nationality: r.nationality,
    position: r.position,
    prestige: r.prestige,
    mvt: r.mvt,
    plApps: r.pl_apps,
    uclApps: r.ucl_apps,
  }));
}

export const PL_LEAGUE = 'Premier League';
export const BIG6 = ['Manchester United', 'Manchester City', 'Chelsea', 'Arsenal', 'Liverpool', 'Tottenham'];
