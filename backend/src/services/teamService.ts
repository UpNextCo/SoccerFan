import { inArray, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { teams } from '../db/schema.js';
import {
  LEAGUE_ID_BY_NAME,
  teamLogoUrl,
} from '../constants/footballMedia.js';
import { normalizeSearchText } from '../utils/playerSearch.js';
import { normalizeTeamName } from '../utils/teamName.js';

export type TeamLogoMatch = {
  teamId: number;
  logoUrl: string;
};

function pairKey(club: string, league: string): string {
  return `${normalizeTeamName(club)}|${normalizeSearchText(league)}`;
}

export function resolveLeagueBadgeId(leagueName: string): number | null {
  const key = normalizeSearchText(leagueName);
  return LEAGUE_ID_BY_NAME[key] ?? null;
}

export async function lookupTeamLogo(
  club: string,
  league: string
): Promise<TeamLogoMatch | null> {
  const batch = await lookupTeamLogos([{ club, league }]);
  return batch.get(pairKey(club, league)) ?? null;
}

export async function lookupTeamLogos(
  pairs: Array<{ club: string; league: string }>
): Promise<Map<string, TeamLogoMatch>> {
  const result = new Map<string, TeamLogoMatch>();
  if (pairs.length === 0) return result;

  const uniquePairs = new Map<
    string,
    { club: string; league: string; nameNorm: string; leagueId: number | null }
  >();
  for (const pair of pairs) {
    const key = pairKey(pair.club, pair.league);
    if (uniquePairs.has(key)) continue;
    uniquePairs.set(key, {
      club: pair.club,
      league: pair.league,
      nameNorm: normalizeTeamName(pair.club),
      leagueId: resolveLeagueBadgeId(pair.league),
    });
  }

  const nameNorms = [...new Set([...uniquePairs.values()].map((p) => p.nameNorm))].filter(Boolean);
  if (nameNorms.length === 0) return result;

  const rows = await db
    .select({
      id: teams.id,
      nameNorm: teams.nameNorm,
      leagueId: teams.leagueId,
      logoUrl: teams.logoUrl,
    })
    .from(teams)
    .where(inArray(teams.nameNorm, nameNorms));

  const byNorm = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byNorm.get(row.nameNorm) ?? [];
    list.push(row);
    byNorm.set(row.nameNorm, list);
  }

  for (const [key, pair] of uniquePairs) {
    const candidates = byNorm.get(pair.nameNorm) ?? [];
    if (candidates.length === 0) continue;

    const match =
      (pair.leagueId != null
        ? candidates.find((row) => row.leagueId === pair.leagueId)
        : undefined) ??
      candidates.find((row) => row.leagueId == null) ??
      candidates[0];

    result.set(key, { teamId: match.id, logoUrl: match.logoUrl });
  }

  return result;
}

export type TeamSearchResult = {
  id: number;
  name: string;
  logoUrl: string;
  leagueId: number | null;
  country: string | null;
};

/**
 * Team picker search. Empty query returns current top-5-league clubs; otherwise
 * substring-matches on the normalized name. Big leagues + prefix matches rank first.
 */
export async function searchTeams(query: string, limit = 30): Promise<TeamSearchResult[]> {
  const q = normalizeTeamName(query);
  const like = `%${q}%`;
  const prefix = `${q}%`;

  const rows = (await db.execute(sql`
    SELECT id, name, logo_url, league_id, country
    FROM teams
    WHERE (${q} = '' AND league_id IS NOT NULL)
       OR (${q} <> '' AND name_norm LIKE ${like})
    ORDER BY
      (league_id IN (39, 140, 135, 78, 61)) DESC,
      (name_norm LIKE ${prefix}) DESC,
      length(name) ASC,
      name ASC
    LIMIT ${limit}
  `)) as unknown as Array<{
    id: number;
    name: string;
    logo_url: string;
    league_id: number | null;
    country: string | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    logoUrl: row.logo_url,
    leagueId: row.league_id,
    country: row.country,
  }));
}

export async function upsertTeam(row: {
  id: number;
  name: string;
  leagueId?: number | null;
  country?: string | null;
  logoUrl?: string;
}): Promise<void> {
  const nameNorm = normalizeTeamName(row.name);
  await db
    .insert(teams)
    .values({
      id: row.id,
      name: row.name,
      nameNorm,
      leagueId: row.leagueId ?? null,
      country: row.country ?? null,
      logoUrl: row.logoUrl ?? teamLogoUrl(row.id),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: teams.id,
      set: {
        name: row.name,
        nameNorm,
        leagueId: row.leagueId ?? null,
        country: row.country ?? null,
        logoUrl: row.logoUrl ?? teamLogoUrl(row.id),
        updatedAt: new Date(),
      },
    });
}
