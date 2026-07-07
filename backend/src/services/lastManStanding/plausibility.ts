import { sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { isNationalTeam, isYouthOrReserveSide, nationSet } from '../../utils/nationalTeam.js';
import type { FamousPlayer } from './shared.js';
import { pickN, seededIndex } from './shared.js';
import type { LMSTier } from './difficulty.js';

export interface PlayerClubIndex {
  /** Club-only names from career + stats (national/youth stripped). */
  clubsByPlayer: Map<string, Set<string>>;
  /** Apps at club ÷ total club apps (0–1). */
  associationByPlayer: Map<string, Map<string, number>>;
  primaryClubByPlayer: Map<string, string>;
  leagueIdsByPlayer: Map<string, Set<number>>;
  leagueByClub: Map<string, number>;
  prestigeByPlayer: Map<string, number>;
  playerIdByName: Map<string, string>;
}

let cachedIndex: PlayerClubIndex | null = null;

export function resetPlayerClubIndex(): void {
  cachedIndex = null;
}

export async function buildPlayerClubIndex(pool: FamousPlayer[]): Promise<PlayerClubIndex> {
  if (cachedIndex) return cachedIndex;

  const nations = await nationSet();
  const prestigeByPlayer = new Map(pool.map((p) => [p.id, p.prestige]));

  const nameRows = (await db.execute(sql`
    SELECT id, name, (market_value_tier * 10)::int AS prestige
    FROM players WHERE market_value_tier >= 4
  `)) as unknown as Array<{ id: string; name: string; prestige: number }>;
  const playerIdByName = new Map<string, string>();
  for (const r of nameRows) {
    playerIdByName.set(r.name, r.id);
    if (!prestigeByPlayer.has(r.id)) prestigeByPlayer.set(r.id, r.prestige);
  }

  const statRows = (await db.execute(sql`
    WITH per_club AS (
      SELECT ps.player_id, ps.team_name, MAX(ps.league_id) AS league_id,
        SUM(ps.appearances)::int AS apps
      FROM player_stats ps
      JOIN players p ON p.id = ps.player_id
      WHERE p.market_value_tier >= 4 AND ps.appearances > 0
        AND ps.team_name IS NOT NULL AND ps.team_name <> ''
      GROUP BY ps.player_id, ps.team_name
    ),
    totals AS (
      SELECT player_id, SUM(apps)::int AS total_apps FROM per_club GROUP BY player_id
    )
    SELECT pc.player_id, pc.team_name, pc.league_id, pc.apps,
      pc.apps::float / NULLIF(t.total_apps, 0) AS assoc
    FROM per_club pc
    JOIN totals t ON t.player_id = pc.player_id
  `)) as unknown as Array<{
    player_id: string;
    team_name: string;
    league_id: number | null;
    apps: number;
    assoc: number;
  }>;

  const careerRows = (await db.execute(sql`
    SELECT pc.player_id, pc.team_name, t.league_id
    FROM player_career pc
    JOIN players p ON p.id = pc.player_id
    LEFT JOIN teams t ON t.id = pc.team_id
    WHERE p.market_value_tier >= 4 AND pc.team_id > 0
  `)) as unknown as Array<{ player_id: string; team_name: string; league_id: number | null }>;

  const clubsByPlayer = new Map<string, Set<string>>();
  const associationByPlayer = new Map<string, Map<string, number>>();
  const leagueIdsByPlayer = new Map<string, Set<number>>();
  const leagueByClub = new Map<string, number>();
  const primaryClubByPlayer = new Map<string, string>();

  const addClub = (playerId: string, club: string, leagueId: number | null, assoc?: number) => {
    const name = club.trim();
    if (!name || isNationalTeam(name, nations) || isYouthOrReserveSide(name)) return;

    let set = clubsByPlayer.get(playerId);
    if (!set) {
      set = new Set();
      clubsByPlayer.set(playerId, set);
    }
    set.add(name);

    if (leagueId != null) {
      leagueByClub.set(name, leagueId);
      let leagues = leagueIdsByPlayer.get(playerId);
      if (!leagues) {
        leagues = new Set();
        leagueIdsByPlayer.set(playerId, leagues);
      }
      leagues.add(leagueId);
    }

    if (assoc != null) {
      let map = associationByPlayer.get(playerId);
      if (!map) {
        map = new Map();
        associationByPlayer.set(playerId, map);
      }
      const prev = map.get(name) ?? 0;
      map.set(name, Math.max(prev, assoc));
    }
  };

  for (const r of statRows) {
    addClub(r.player_id, r.team_name, r.league_id, r.assoc);
  }
  for (const r of careerRows) {
    addClub(r.player_id, r.team_name, r.league_id);
  }

  for (const [playerId, assocMap] of associationByPlayer) {
    let bestClub = '';
    let bestScore = -1;
    for (const [club, score] of assocMap) {
      if (score > bestScore) {
        bestScore = score;
        bestClub = club;
      }
    }
    if (bestClub) primaryClubByPlayer.set(playerId, bestClub);
  }

  cachedIndex = {
    clubsByPlayer,
    associationByPlayer,
    primaryClubByPlayer,
    leagueIdsByPlayer,
    leagueByClub,
    prestigeByPlayer,
    playerIdByName,
  };
  return cachedIndex;
}

export function pathOverlapCount(index: PlayerClubIndex, playerId: string, path: string[]): number {
  const clubs = index.clubsByPlayer.get(playerId);
  if (!clubs) return 0;
  return path.filter((c) => clubs.has(c)).length;
}

export function associationAt(index: PlayerClubIndex, playerId: string, club: string): number {
  return index.associationByPlayer.get(playerId)?.get(club) ?? 0;
}

export function prestigeSpread(index: PlayerClubIndex, ids: string[]): number {
  const values = ids.map((id) => index.prestigeByPlayer.get(id) ?? 0);
  return Math.max(...values) - Math.min(...values);
}

export function minCareerOverlapClubs(_tier: LMSTier): number {
  return 1;
}

/** Prefer tighter overlap when enough candidates exist. */
export function preferredCareerOverlap(tier: LMSTier): number {
  return tier === 'signature' ? 2 : 1;
}

/** Max association for which-club clue players (lower = harder to guess from names). */
export function maxClueAssociation(tier: LMSTier): number {
  if (tier === 'easy') return 0.45;
  if (tier === 'medium') return 0.36;
  if (tier === 'signature') return 0.28;
  return 0.32;
}

export function maxOddPrestigeSpread(tier: LMSTier): number {
  if (tier === 'easy') return 14;
  if (tier === 'medium') return 11;
  return 9;
}

export function careerPrestigeBand(tier: LMSTier): number {
  if (tier === 'signature') return 10;
  if (tier === 'hard') return 12;
  return 14;
}

export function pickPlausibleCareerDistractors(
  pool: FamousPlayer[],
  index: PlayerClubIndex,
  targetId: string,
  targetPrestige: number,
  nationality: string,
  path: string[],
  minOverlap: number,
  band: number,
  seed: string
): FamousPlayer[] {
  const nat = nationality.trim();
  const candidates = pool.filter((p) => {
    if (p.id === targetId) return false;
    if (p.nationality !== nat) return false;
    if (Math.abs(p.prestige - targetPrestige) > band) return false;
    return pathOverlapCount(index, p.id, path) >= minOverlap;
  });
  if (candidates.length < 3) return [];
  return pickN(candidates, seed, 3);
}

export function playerPlayedInLeague(index: PlayerClubIndex, playerId: string, leagueId: number): boolean {
  return index.leagueIdsByPlayer.get(playerId)?.has(leagueId) ?? false;
}
