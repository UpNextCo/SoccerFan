import { eq, sql } from 'drizzle-orm';
import { resolveHeadshot } from '../constants/footballMedia.js';
import { db } from '../db/index.js';
import { players } from '../db/schema.js';
import { getPhotoOverrides } from './photoOverrides.js';
import { searchPlayers } from './playerService.js';
import { lookupTeamLogo, searchTeams, type TeamSearchResult } from './teamService.js';
import type { PlayerSearchResult } from '../types.js';

const COMMON_LEAGUES = [
  { id: 39, name: 'Premier League' },
  { id: 140, name: 'La Liga' },
  { id: 135, name: 'Serie A' },
  { id: 78, name: 'Bundesliga' },
  { id: 61, name: 'Ligue 1' },
  { id: 2, name: 'Champions League' },
  { id: 3, name: 'Europa League' },
  { id: 848, name: 'Conference League' },
  { id: 45, name: 'FA Cup' },
  { id: 48, name: 'EFL Cup' },
  { id: 1, name: 'International' },
] as const;

export type AdminLeagueHit = { id: number; name: string };
export type AdminNationalityHit = { name: string };

export async function adminSearchPlayers(q: string): Promise<PlayerSearchResult[]> {
  return searchPlayers(q, 20);
}

export async function adminSearchTeams(q: string): Promise<TeamSearchResult[]> {
  return searchTeams(q, 20);
}

export async function adminSearchLeagues(q: string): Promise<AdminLeagueHit[]> {
  const needle = q.trim().toLowerCase();
  if (!needle) return [...COMMON_LEAGUES];
  return COMMON_LEAGUES.filter((l) => l.name.toLowerCase().includes(needle));
}

export async function adminSearchNationalities(q: string): Promise<AdminNationalityHit[]> {
  const needle = q.trim();
  if (needle.length < 2) return [];
  const like = `%${needle}%`;
  const rows = (await db.execute(sql`
    SELECT nationality AS name, COUNT(*)::int AS n
    FROM players
    WHERE nationality ILIKE ${like}
      AND nationality IS NOT NULL
      AND nationality <> ''
      AND nationality <> 'Unknown'
    GROUP BY nationality
    ORDER BY n DESC, nationality ASC
    LIMIT 20
  `)) as unknown as Array<{ name: string; n: number }>;
  return rows.map((r) => ({ name: r.name }));
}

/** Full player card for Club Chain / One More / LMS options. */
export async function resolveAdminPlayer(playerId: string) {
  const rows = await db
    .select({
      id: players.id,
      name: players.name,
      nationality: players.nationality,
      position: players.position,
      currentClub: players.currentClub,
      currentLeague: players.currentLeague,
      apiFootballId: players.apiFootballId,
      aliases: players.aliases,
    })
    .from(players)
    .where(eq(players.id, playerId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const overrides = await getPhotoOverrides();
  const headshotUrl = resolveHeadshot(overrides.get(row.id), row.apiFootballId) ?? undefined;

  // Top clubs by apps (One More / Club Chain card subtitle). The badge MUST be this primary club —
  // looking up players.currentClub put Modrić's Real Madrid label under an AC Milan crest, Rooney
  // under Everton, etc., every time Ops re-enriched a puzzle.
  const clubRows = (await db.execute(sql`
    SELECT s.team_name, SUM(s.appearances)::int AS apps
    FROM player_stats s
    WHERE s.player_id = ${row.id}::uuid
      AND s.league_id <> 1
      AND s.team_name IS NOT NULL
      AND s.team_name <> ${row.nationality}
    GROUP BY s.team_name
    ORDER BY apps DESC
    LIMIT 3
  `)) as unknown as Array<{ team_name: string; apps: number }>;
  const primaryClub = clubRows[0]?.team_name || row.currentClub;
  const logo =
    (primaryClub ? await lookupTeamLogo(primaryClub, '') : null)
    ?? (row.currentClub ? await lookupTeamLogo(row.currentClub, row.currentLeague) : null);

  // Prefer the teams-table spelling for the primary club so the label matches the crest
  // ("Milan" → "AC Milan", not a second line that says AC Milan under a Milan badge).
  let clubsNames = clubRows.map((c) => c.team_name);
  if (logo?.teamId != null && clubsNames.length) {
    const canon = (await db.execute(sql`
      SELECT name FROM teams WHERE id = ${logo.teamId} LIMIT 1
    `)) as unknown as Array<{ name: string }>;
    if (canon[0]?.name) {
      clubsNames = [canon[0].name, ...clubsNames.filter((n) => n !== canon[0]!.name && n !== primaryClub)];
    }
  }
  const clubs = clubsNames.join(' · ');

  return {
    id: row.id,
    name: row.name,
    nationality: row.nationality,
    position: row.position || '',
    club: row.currentClub,
    league: row.currentLeague,
    aliases: Array.isArray(row.aliases) ? row.aliases : [],
    headshotUrl,
    teamId: logo?.teamId ?? undefined,
    teamLogoUrl: logo?.logoUrl ?? undefined,
    clubs,
  };
}

/** Golf answer row: id + name + aliases from DB. */
export async function resolveAdminGolfAnswer(playerId: string) {
  const player = await resolveAdminPlayer(playerId);
  if (!player) return null;
  return {
    id: player.id,
    name: player.name,
    aliases: player.aliases,
    headshotUrl: player.headshotUrl,
  };
}

/**
 * Bingo player pool entry — same shape fields the matcher needs.
 * Stats are best-effort so replacing a pool player still works for matching.
 */
export async function resolveAdminBingoPlayer(playerId: string) {
  const base = await resolveAdminPlayer(playerId);
  if (!base) return null;

  const idList = sql`${playerId}::uuid`;
  const statRows = (await db.execute(sql`
    SELECT
      COALESCE(SUM(appearances) FILTER (WHERE league_id = 39), 0)::int AS pl_apps,
      COALESCE(SUM(goals) FILTER (WHERE league_id = 39), 0)::int AS pl_goals,
      COALESCE(SUM(appearances) FILTER (WHERE league_id = 140), 0)::int AS laliga_apps,
      COALESCE(SUM(appearances) FILTER (WHERE league_id = 135), 0)::int AS seriea_apps,
      COALESCE(SUM(appearances) FILTER (WHERE league_id = 78), 0)::int AS bundes_apps,
      COALESCE(SUM(appearances) FILTER (WHERE league_id = 61), 0)::int AS ligue1_apps,
      COALESCE(SUM(appearances) FILTER (WHERE league_id IN (39,140,135,78,61)), 0)::int AS top_apps,
      COALESCE(SUM(goals) FILTER (WHERE league_id IN (39,140,135,78,61)), 0)::int AS top_goals,
      COALESCE(SUM(appearances) FILTER (WHERE league_id <> 1), 0)::int AS club_apps,
      COALESCE(SUM(appearances) FILTER (WHERE league_id = 2), 0)::int AS cl_apps,
      COALESCE(SUM(goals) FILTER (WHERE league_id = 2), 0)::int AS cl_goals,
      COALESCE(SUM(appearances) FILTER (WHERE league_id = 1), 0)::int AS intl_caps,
      COALESCE(SUM(goals) FILTER (WHERE league_id = 1), 0)::int AS intl_goals,
      COUNT(DISTINCT league_id) FILTER (WHERE league_id IN (39,140,135,78,61))::int AS top5_leagues
    FROM player_stats WHERE player_id = ${idList}
  `)) as unknown as Array<Record<string, number>>;
  const s = statRows[0] ?? {};

  const clubRows = (await db.execute(sql`
    SELECT DISTINCT team_name
    FROM player_stats
    WHERE player_id = ${idList}
      AND league_id <> 1
      AND team_name IS NOT NULL
      AND team_name <> ''
  `)) as unknown as Array<{ team_name: string }>;
  const clubs = clubRows.map((r) => r.team_name);

  const leagueRows = (await db.execute(sql`
    SELECT DISTINCT league_name
    FROM player_stats
    WHERE player_id = ${idList}
      AND league_name IS NOT NULL
      AND league_name <> ''
  `)) as unknown as Array<{ league_name: string }>;

  const trophyRows = (await db.execute(sql`
    SELECT DISTINCT competition FROM player_honours
    WHERE player_id = ${idList} AND placement ILIKE '%winner%'
  `)) as unknown as Array<{ competition: string }>;

  const awardRows = (await db.execute(sql`
    SELECT DISTINCT award FROM player_awards WHERE player_id = ${idList}
  `)) as unknown as Array<{ award: string }>;

  const feeRows = (await db.execute(sql`
    SELECT COALESCE(MAX(fee_eur_m), 0)::int AS max_fee
    FROM player_transfers WHERE player_id = ${idList} AND fee_eur_m IS NOT NULL
  `)) as unknown as Array<{ max_fee: number }>;

  const stats: Record<string, number> = {
    pl_apps: s.pl_apps ?? 0,
    pl_goals: s.pl_goals ?? 0,
    laliga_apps: s.laliga_apps ?? 0,
    seriea_apps: s.seriea_apps ?? 0,
    bundesliga_apps: s.bundes_apps ?? 0,
    ligue1_apps: s.ligue1_apps ?? 0,
    top_apps: s.top_apps ?? 0,
    top_goals: s.top_goals ?? 0,
    club_apps: s.club_apps ?? 0,
    cl_apps: s.cl_apps ?? 0,
    cl_goals: s.cl_goals ?? 0,
    intl_caps: s.intl_caps ?? 0,
    intl_goals: s.intl_goals ?? 0,
    top5_leagues: s.top5_leagues ?? 0,
    top5_clubs: clubs.length,
    transfer_eur_m: feeRows[0]?.max_fee ?? 0,
  };

  return {
    id: base.id,
    name: base.name,
    nationality: base.nationality,
    position: base.position,
    clubs,
    leagues: leagueRows.map((r) => r.league_name),
    trophies: trophyRows.map((r) => r.competition),
    teammates: [] as string[],
    managers: [] as string[],
    awards: awardRows.map((r) => r.award),
    stats,
    premierLeagueApps: stats.pl_apps,
    topLeagueGoals: stats.top_goals,
    topLeagueApps: stats.top_apps,
    headshotUrl: base.headshotUrl ?? null,
  };
}

export async function resolveAdminTeam(teamId: number) {
  const rows = (await db.execute(sql`
    SELECT id, name, logo_url AS "logoUrl", league_id AS "leagueId", country
    FROM teams WHERE id = ${teamId}
    LIMIT 1
  `)) as unknown as Array<{
    id: number;
    name: string;
    logoUrl: string;
    leagueId: number | null;
    country: string | null;
  }>;
  const row = rows[0];
  if (!row) return null;
  const league = COMMON_LEAGUES.find((l) => l.id === row.leagueId);
  return {
    id: row.id,
    name: row.name,
    logoUrl: row.logoUrl,
    leagueId: row.leagueId,
    leagueName: league?.name ?? null,
    country: row.country,
  };
}
