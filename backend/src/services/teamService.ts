import { inArray, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { teams } from '../db/schema.js';
import {
  CUP_OR_TOURNAMENT_LEAGUE_IDS,
  LEAGUE_ID_BY_NAME,
  SYNTHETIC_TEAM_ID_MIN,
  isSyntheticTeamId,
  teamLogoUrl,
} from '../constants/footballMedia.js';
import { isYouthOrReserveSide } from '../utils/nationalTeam.js';
import { normalizeSearchText } from '../utils/playerSearch.js';
import { normalizeTeamName } from '../utils/teamName.js';

const PREMIER_LEAGUE_ID = 39;

/**
 * Current Premier League club IDs (API-Football) for the team-picker default list.
 * 2026/27: Coventry, Hull, Ipswich up; Burnley, West Ham, Wolves down.
 * Update each summer when the new season's 20 is confirmed.
 */
const CURRENT_PREMIER_LEAGUE_TEAM_IDS = [
  42, // Arsenal
  66, // Aston Villa
  35, // Bournemouth
  55, // Brentford
  51, // Brighton
  49, // Chelsea
  1346, // Coventry
  52, // Crystal Palace
  45, // Everton
  36, // Fulham
  64, // Hull City
  57, // Ipswich
  63, // Leeds
  40, // Liverpool
  50, // Manchester City
  33, // Manchester United
  34, // Newcastle
  65, // Nottingham Forest
  746, // Sunderland
  47, // Tottenham
] as const;

/** SQL: drop U21 / reserves / women's sides from team-picker results. */
function seniorClubNameSql(column = 'name') {
  const col = sql.raw(column);
  return sql`
    ${col} !~* '\\mU\\d{1,2}(\\s+W)?\\M'
    AND ${col} !~* '\\s+(II|B)$'
    AND ${col} !~* ' Castilla$'
    AND ${col} !~* '\\s+(Women|Ladies|WFC|Reserves?|Academy|Amateurs|Youth)$'
    AND ${col} !~* '\\s+W$'
  `;
}

export type TeamLogoMatch = {
  teamId: number;
  logoUrl: string;
};

const TOP5_LEAGUE_IDS = new Set([39, 140, 135, 78, 61]);
const EFL_LEAGUE_IDS = new Set([40, 41, 42]);

function homeLeagueTier(leagueId: number | null | undefined): number {
  if (leagueId == null) return 8;
  if (CUP_OR_TOURNAMENT_LEAGUE_IDS.has(leagueId)) return 7;
  if (TOP5_LEAGUE_IDS.has(leagueId)) return 0;
  if (EFL_LEAGUE_IDS.has(leagueId)) return 1;
  return 3;
}

/** Domestic league a club should live under on the registry (never a cup). */
export function pickHomeLeagueId(
  rows: Array<{ leagueId: number; appearances: number }>
): number | null {
  const usable = rows.filter((r) => r.leagueId > 0);
  if (usable.length === 0) return null;
  return [...usable].sort((a, b) => {
    const tier = homeLeagueTier(a.leagueId) - homeLeagueTier(b.leagueId);
    if (tier !== 0) return tier;
    return b.appearances - a.appearances;
  })[0]!.leagueId;
}

function compareTeamCandidates(
  a: { id: number; leagueId: number | null },
  b: { id: number; leagueId: number | null }
): number {
  const syn = Number(isSyntheticTeamId(a.id)) - Number(isSyntheticTeamId(b.id));
  if (syn !== 0) return syn;
  const tier = homeLeagueTier(a.leagueId) - homeLeagueTier(b.leagueId);
  if (tier !== 0) return tier;
  return a.id - b.id;
}

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
  const hit = batch.get(pairKey(club, league));
  if (hit) return hit;

  // Canonical tile labels ("Roma") often miss the teams-table prefix ("AS Roma") and may carry a
  // wrong default league — retry without league, then fuzzy-resolve from tokens.
  if (league) {
    const loose = await lookupTeamLogos([{ club, league: '' }]);
    const hit2 = loose.get(pairKey(club, ''));
    if (hit2) return hit2;
  }

  return resolveClubLogo(club);
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
    const rawNorm = normalizeTeamName(pair.club);
    uniquePairs.set(key, {
      club: pair.club,
      league: pair.league,
      nameNorm: CLUB_ALIAS[rawNorm] ?? rawNorm,
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

    // Prefer the exact league match; otherwise favour a real (top-5) league club over a
    // league-less duplicate, since name collisions like "Athletic Club" (Bilbao vs an obscure
    // Brazilian side with no league) would otherwise resolve to the wrong, unrecognisable crest.
    const real = candidates.filter((row) => !isSyntheticTeamId(row.id));
    const pool = real.length > 0 ? real : candidates;
    const match =
      (pair.leagueId != null
        ? [...pool]
            .filter((row) => row.leagueId === pair.leagueId)
            .sort(compareTeamCandidates)[0]
        : undefined) ?? [...pool].sort(compareTeamCandidates)[0];

    result.set(key, { teamId: match.id, logoUrl: match.logoUrl });
  }

  return result;
}

/**
 * Tolerant club→crest resolver for historical squad clubs (e.g. Wikipedia spellings like
 * "Paris Saint-Germain", "Leicester City") that the exact-match lookupTeamLogo misses. Splits on
 * ALL non-alphanumerics (so hyphens/dots don't matter) and matches by token containment either way
 * ("Leicester" ⊆ "Leicester City", "Paris Saint Germain" == "Paris Saint-Germain"), preferring the
 * senior top-5-league club and the fullest token overlap.
 */
const CLUB_STOPWORDS = new Set(['fc', 'cf', 'sc', 'ac', 'afc', 'cd', 'ss', 'as', 'ssc', 'the']);
// Historical squad-club spellings that differ from the teams table (native name, alias, etc.).
const CLUB_ALIAS: Record<string, string> = {
  'bayern munich': 'bayern munchen',
  'athletic bilbao': 'athletic club',
  'inter milan': 'inter', internazionale: 'inter',
  roma: 'as roma',
  'sporting lisbon': 'sporting cp', 'spartak moscow': 'spartak moskva',
};
function clubTokens(s: string): string[] {
  return normalizeSearchText(s)
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t && !CLUB_STOPWORDS.has(t));
}

export async function resolveClubLogo(club: string): Promise<TeamLogoMatch | null> {
  let tokens = clubTokens(club);
  const aliased = CLUB_ALIAS[tokens.join(' ')];
  if (aliased) tokens = clubTokens(aliased);
  if (!tokens.length) return null;
  const first = tokens[0]!;
  const norm = tokens.join(' ');
  const rows = (await db.execute(sql`
    SELECT id, name_norm AS "nameNorm", logo_url AS "logoUrl", league_id AS "leagueId"
    FROM teams
    WHERE (name_norm = ${norm} OR name_norm LIKE ${first + '%'})
      AND id < ${SYNTHETIC_TEAM_ID_MIN}
    LIMIT 300
  `)) as unknown as Array<{ id: number; nameNorm: string; logoUrl: string; leagueId: number | null }>;

  const clubSet = new Set(tokens);
  let best: { row: (typeof rows)[number]; score: number } | null = null;
  for (const r of rows) {
    const tt = clubTokens(r.nameNorm);
    if (!tt.length) continue;
    const teamInClub = tt.every((t) => clubSet.has(t));
    const clubInTeam = tokens.every((t) => tt.includes(t));
    if (!teamInClub && !clubInTeam) continue; // unrelated club that just shares the first token
    const overlap = tt.filter((t) => clubSet.has(t)).length;
    let score = overlap * 10;
    if (tt.join(' ') === norm) score += 100; // exact
    if (isSyntheticTeamId(r.id)) score -= 50;
    else score += 8;
    score += Math.max(0, 7 - homeLeagueTier(r.leagueId));
    if (r.id < 2000) score += 2; // prefer canonical API-Football ids
    if (!best || score > best.score) best = { row: r, score };
  }
  return best ? { teamId: best.row.id, logoUrl: best.row.logoUrl } : null;
}

export type TeamSearchResult = {
  id: number;
  name: string;
  logoUrl: string;
  leagueId: number | null;
  country: string | null;
};

/**
 * Team picker search. Empty query returns the curated current Premier League 20
 * (`CURRENT_PREMIER_LEAGUE_TEAM_IDS`). Search substring-matches on normalized name;
 * youth/reserve/women's sides are excluded. Bigger leagues + exact/prefix matches
 * + shorter names rank first.
 */
export async function searchTeams(query: string, limit = 30): Promise<TeamSearchResult[]> {
  const q = normalizeTeamName(query);
  const like = `%${q}%`;
  const prefix = `${q}%`;

  const rows = (await db.execute(
    q === ''
      ? sql`
          SELECT t.id, t.name, t.logo_url, t.league_id, t.country
          FROM teams t
          WHERE t.id IN ${CURRENT_PREMIER_LEAGUE_TEAM_IDS}
            AND ${seniorClubNameSql('t.name')}
          ORDER BY t.name ASC
          LIMIT ${limit}
        `
      : sql`
          SELECT id, name, logo_url, league_id, country
          FROM teams
          WHERE name_norm LIKE ${like}
            AND id < ${SYNTHETIC_TEAM_ID_MIN}
            AND ${seniorClubNameSql('name')}
          ORDER BY
            CASE
              WHEN league_id = ${PREMIER_LEAGUE_ID} THEN 0
              WHEN league_id IN (140, 135, 78, 61) THEN 1
              WHEN league_id IN (40, 41, 42, 88, 94, 179, 203, 253, 262, 71, 307) THEN 2
              WHEN league_id IS NOT NULL AND league_id NOT IN (1, 2, 3, 4, 6, 9, 45, 48, 848) THEN 3
              WHEN league_id IS NOT NULL THEN 4
              ELSE 5
            END ASC,
            (name_norm = ${q}) DESC,
            (name_norm LIKE ${prefix}) DESC,
            length(name) ASC,
            name ASC
          LIMIT ${Math.max(limit * 3, 60)}
        `
  )) as unknown as Array<{
    id: number;
    name: string;
    logo_url: string;
    league_id: number | null;
    country: string | null;
  }>;

  // Dedupe near-identical labels (keep the higher-ranked row) and belt-and-braces youth filter.
  const seen = new Set<string>();
  const results: TeamSearchResult[] = [];
  for (const row of rows) {
    if (isYouthOrReserveSide(row.name)) continue;
    const key = normalizeTeamName(row.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    results.push({
      id: row.id,
      name: row.name,
      logoUrl: row.logo_url,
      leagueId: row.league_id,
      country: row.country,
    });
    if (results.length >= limit) break;
  }
  return results;
}

export async function upsertTeam(row: {
  id: number;
  name: string;
  leagueId?: number | null;
  country?: string | null;
  logoUrl?: string;
  /** overwrite existing row (API-Football). Default: insert-only so player-data cannot rename a club. */
  overwrite?: boolean;
}): Promise<void> {
  if (isSyntheticTeamId(row.id)) return;

  const nameNorm = normalizeTeamName(row.name);
  const logoUrl = row.logoUrl ?? teamLogoUrl(row.id);
  const values = {
    id: row.id,
    name: row.name,
    nameNorm,
    leagueId: row.leagueId ?? null,
    country: row.country ?? null,
    logoUrl,
    updatedAt: new Date(),
  };

  if (!row.overwrite) {
    await db.insert(teams).values(values).onConflictDoNothing();
    return;
  }

  const patch: {
    name: string;
    nameNorm: string;
    logoUrl: string;
    updatedAt: Date;
    leagueId?: number;
    country?: string;
  } = {
    name: row.name,
    nameNorm,
    logoUrl,
    updatedAt: new Date(),
  };
  if (row.leagueId != null) patch.leagueId = row.leagueId;
  if (row.country != null) patch.country = row.country;

  await db
    .insert(teams)
    .values(values)
    .onConflictDoUpdate({
      target: teams.id,
      set: patch,
    });
}
