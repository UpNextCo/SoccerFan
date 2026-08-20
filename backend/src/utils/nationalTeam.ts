import { sql, type SQL } from 'drizzle-orm';
import { db } from '../db/index.js';
import { CUP_OR_TOURNAMENT_LEAGUE_IDS, INTERNATIONAL_COMPETITION_LEAGUE_IDS } from '../constants/footballMedia.js';
import { canonicalNationality } from './nationality.js';

/** True for a domestic club league — not World Cup / Euro / AFCON / UEFA club competitions. */
export function isDomesticClubLeague(leagueId: number | null | undefined): boolean {
  return leagueId != null && leagueId > 0 && !CUP_OR_TOURNAMENT_LEAGUE_IDS.has(leagueId);
}

function cupLeagueIdSql(): SQL {
  return sql.join(
    [...CUP_OR_TOURNAMENT_LEAGUE_IDS].sort((a, b) => a - b).map((id) => sql`${id}`),
    sql`, `
  );
}

let NATION_SET: Set<string> | null = null;

export async function nationSet(): Promise<Set<string>> {
  if (NATION_SET) return NATION_SET;
  const rows = (await db.execute(sql`
    SELECT DISTINCT nationality FROM players WHERE nationality IS NOT NULL AND nationality <> ''
  `)) as unknown as Array<{ nationality: string }>;
  const s = new Set<string>();
  for (const r of rows) {
    s.add(r.nationality.trim());
    s.add(canonicalNationality(r.nationality));
  }
  NATION_SET = s;
  return s;
}

/**
 * Country names arrive spelled several ways across sources ("Rep. Of Ireland" vs "Republic of
 * Ireland", "Bosnia & Herzegovina" vs "Bosnia and Herzegovina"). Comparing raw strings let those
 * variants pass as clubs, which in Club Chain means two international teammates count as club
 * teammates — exactly the nationality link the game forbids.
 */
function nationalityKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\brep\b\.?/g, 'republic')
    .replace(/\band\b|&/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/** Normalized forms of a nationality set, derived once per set instance. */
const KEYS_BY_NATION_SET = new WeakMap<Set<string>, Set<string>>();
function nationalityKeys(nations: Set<string>): Set<string> {
  const cached = KEYS_BY_NATION_SET.get(nations);
  if (cached) return cached;
  const keys = new Set<string>();
  for (const n of nations) {
    keys.add(nationalityKey(n));
    keys.add(nationalityKey(canonicalNationality(n)));
  }
  KEYS_BY_NATION_SET.set(nations, keys);
  return keys;
}

/** Strip a youth / Olympic suffix: "England U19", "France U17 W", "Nigeria Olympic". */
function withoutAgeGroup(name: string): string {
  return name
    .replace(/\s+U\d{1,2}(\s+W)?$/i, '')
    .replace(/\s+(Olympics?|Olympic)$/i, '')
    .trim();
}

/**
 * National or national-youth side (API-Football career rows).
 *
 * Note this is name-only: a club named after a country still matches. Callers deciding whether two
 * players were CLUB teammates should use `isNationalTeamRow`, which lets real clubs through.
 */
export function isNationalTeam(name: string, nations: Set<string>): boolean {
  const n = name.trim();
  if (nations.has(n) || nations.has(canonicalNationality(n))) return true;
  const base = withoutAgeGroup(n);
  if (base !== n && (nations.has(base) || nations.has(canonicalNationality(base)))) return true;
  // Spelling variants the exact checks above miss ("Rep. Of Ireland", "Bosnia & Herzegovina").
  const keys = nationalityKeys(nations);
  return keys.has(nationalityKey(n)) || keys.has(nationalityKey(base));
}

/** England U19 / Ghana U20 / Nigeria Olympic — never a club, even if `teams.league_id` is domestic. */
export function isYouthNationalOrOlympicSide(name: string, nations: Set<string>): boolean {
  const n = name.trim();
  return withoutAgeGroup(n) !== n && isNationalTeam(n, nations);
}

/**
 * Drop this career row from club-teammate graphs.
 * Senior nationals (England) drop unless the team_id is a real domestic club (Monaco).
 * Youth / Olympic nationals always drop (Ghana U20 was stamped with Premier League id 39).
 */
export function isExcludedNationalSpell(
  teamId: number,
  teamName: string,
  nations: Set<string>,
  clubs: Set<number>
): boolean {
  if (!isNationalTeam(teamName, nations)) return false;
  if (isYouthNationalOrOlympicSide(teamName, nations)) return true;
  return !clubs.has(teamId);
}

/** World Cup / Euro / AFCON / Copa América — never a club competition. */
export function isInternationalCompetition(leagueId: number): boolean {
  return INTERNATIONAL_COMPETITION_LEAGUE_IDS.has(leagueId);
}

/**
 * Stats row games must not treat as a club appearance: international tournaments, or a
 * national / youth-national side (Jamaica in Copa América, England in the World Cup).
 * Domestic cups and UEFA club comps stay — those are club football.
 */
export function isExcludedNationalStat(
  leagueId: number,
  teamId: number,
  teamName: string | null | undefined,
  nations: Set<string>,
  clubs: Set<number>
): boolean {
  if (isInternationalCompetition(leagueId)) return true;
  if (!teamName?.trim()) return false;
  return isExcludedNationalSpell(teamId, teamName, nations, clubs);
}

let CLUB_TEAM_IDS: Set<number> | null = null;

/**
 * Teams with a domestic league — real clubs even when named after a country, so AS Monaco and Wales
 * (the club) are not mistaken for national sides. World Cup / Euro / AFCON / UEFA club competitions
 * do not count (England has league_id 1 from the World Cup feed). `clubCareerOnlySql` uses the same
 * escape.
 */
export async function clubTeamIds(): Promise<Set<number>> {
  if (CLUB_TEAM_IDS) return CLUB_TEAM_IDS;
  const rows = (await db.execute(sql`
    SELECT id FROM teams
    WHERE id > 0
      AND league_id IS NOT NULL
      AND league_id NOT IN (${cupLeagueIdSql()})
  `)) as unknown as Array<{ id: number }>;
  CLUB_TEAM_IDS = new Set(rows.map((r) => Number(r.id)));
  return CLUB_TEAM_IDS;
}

/**
 * True when a career row is a national side rather than a club. Prefer this over `isNationalTeam` for
 * anything that decides whether two players were CLUB teammates: it both recognises spelling variants
 * and refuses to discard a club that merely shares a country's name.
 */
export async function isNationalTeamRow(teamId: number, teamName: string): Promise<boolean> {
  return isExcludedNationalSpell(teamId, teamName, await nationSet(), await clubTeamIds());
}

/** Reserve / youth / women's sides — not useful for career paths or the team picker. */
export function isYouthOrReserveSide(name: string): boolean {
  return (
    /\bU\d{1,2}(\s+W)?\b/i.test(name) ||
    /\s+(II|B)$/i.test(name) ||
    / Castilla$/i.test(name) ||
    /\s+(Women|Ladies|WFC|Reserves?|Academy|Amateurs|Youth)$/i.test(name) ||
    / Next Gen$/i.test(name) ||
    /\s+W$/i.test(name)
  );
}

/**
 * SQL predicate: team name looks like a youth / reserve / academy side.
 * Keep in sync with `isYouthOrReserveSide`.
 */
export function youthOrReserveSideSql(teamName: SQL): SQL {
  return sql`(
    ${teamName} ~* '\\mU\\d{1,2}(\\s+W)?\\M'
    OR ${teamName} ~* '\\s+(II|B)$'
    OR ${teamName} ~* ' Castilla$'
    OR ${teamName} ~* '\\s+(Women|Ladies|WFC|Reserves?|Academy|Amateurs|Youth)$'
    OR ${teamName} ~* ' Next Gen$'
    OR ${teamName} ~* '\\s+W$'
  )`;
}

/**
 * SQL predicate for `player_career pc`: keep real clubs only.
 * Drops national / youth-national sides (Belgium, Belgium U21, …) while keeping
 * club sides that share a country name but have a domestic league_id (e.g. Monaco).
 */
export function clubCareerOnlySql(alias = 'pc'): SQL {
  const a = sql.raw(alias);
  const youthOrOlympicSuffix = sql`(
    ${a}.team_name ~* '\\s+U\\d{1,2}(\\s+W)?$'
    OR ${a}.team_name ~* '\\s+(Olympics?|Olympic)$'
  )`;
  const nameIsNation = sql`(
    EXISTS (
      SELECT 1 FROM players _nat
      WHERE _nat.nationality <> '' AND _nat.nationality = ${a}.team_name
    )
    OR EXISTS (
      SELECT 1 FROM players _nat
      WHERE _nat.nationality <> ''
        AND _nat.nationality = regexp_replace(${a}.team_name, '\\s+U\\d{1,2}(\\s+W)?$', '', 'i')
    )
    OR ${a}.team_name ~* '\\s+(Olympics?|Olympic)$'
  )`;
  const isDomesticClub = sql`EXISTS (
    SELECT 1 FROM teams _t
    WHERE _t.id = ${a}.team_id
      AND _t.league_id IS NOT NULL
      AND _t.league_id NOT IN (${cupLeagueIdSql()})
  )`;
  return sql`(
    NOT (
      (${youthOrOlympicSuffix} AND ${nameIsNation})
      OR (${nameIsNation} AND NOT ${isDomesticClub})
    )
  )`;
}
