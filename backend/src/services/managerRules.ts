/**
 * "Played under manager X" relationship engine.
 *
 * A player played under manager M if they have a club-season (player_stats, excluding
 * national teams) at one of M's tenure clubs within the tenure's season range. Club
 * names are matched by a strict normalization plus a small alias map (our stored names
 * vary: "Bayern München", "Inter", "Paris Saint Germain", "Porto"/"FC Porto", …).
 */
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

/** Strict club key: strip accents, lowercase, drop non-alphanumerics, collapse spaces. */
export function normClub(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Extra normalized aliases per canonical club key, so a curated tenure club matches
 * every way our data stores it (and common nicknames). Keyed by normClub(canonical).
 */
const CLUB_ALIASES: Record<string, string[]> = {
  'bayern munchen': ['bayern munich', 'bayern', 'fc bayern munchen', 'fc bayern munich'],
  inter: ['inter milan', 'internazionale', 'fc internazionale'],
  'ac milan': ['milan'],
  'paris saint germain': ['psg', 'paris sg', 'paris saint germain fc'],
  porto: ['fc porto'],
  barcelona: ['fc barcelona', 'barca'],
  'manchester united': ['man united', 'man utd'],
  'manchester city': ['man city'],
  tottenham: ['tottenham hotspur', 'spurs'],
  'atletico madrid': ['atletico de madrid', 'atletico'],
  'borussia dortmund': ['dortmund', 'bvb'],
  juventus: ['juventus fc'],
  'real madrid': ['real madrid cf'],
  'bayer leverkusen': ['bayer 04 leverkusen', 'leverkusen'],
  'rb leipzig': ['rasenballsport leipzig', 'leipzig'],
  roma: ['as roma'],
  hoffenheim: ['1899 hoffenheim', 'tsg hoffenheim', 'tsg 1899 hoffenheim'],
  'wigan athletic': ['wigan'],
};

function aliasKeys(club: string): Set<string> {
  const base = normClub(club);
  const keys = new Set<string>([base]);
  for (const a of CLUB_ALIASES[base] ?? []) keys.add(normClub(a));
  // Reverse: if the curated name is itself an alias of a canonical, include canonical.
  for (const [canon, aliases] of Object.entries(CLUB_ALIASES)) {
    if (aliases.map(normClub).includes(base)) {
      keys.add(canon);
      for (const a of aliases) keys.add(normClub(a));
    }
  }
  return keys;
}

interface Tenure {
  club: string;
  seasonFrom: number;
  seasonTo: number | null;
}

/** distinct club team_name (normalized -> exact strings present in player_stats). */
let teamNameCache: Map<string, string[]> | null = null;
async function getTeamNameMap(): Promise<Map<string, string[]>> {
  if (teamNameCache) return teamNameCache;
  const rows = (await db.execute(sql`
    SELECT DISTINCT team_name FROM player_stats
    WHERE league_id NOT IN (1,4) AND team_name IS NOT NULL AND team_name <> ''
  `)) as unknown as Array<{ team_name: string }>;
  const map = new Map<string, string[]>();
  for (const r of rows) {
    const k = normClub(r.team_name);
    (map.get(k) ?? map.set(k, []).get(k)!).push(r.team_name);
  }
  teamNameCache = map;
  return map;
}

async function tenuresFor(managerNorm: string): Promise<Tenure[]> {
  const rows = (await db.execute(sql`
    SELECT club, season_from AS "seasonFrom", season_to AS "seasonTo"
    FROM manager_tenures WHERE manager_norm = ${managerNorm}
  `)) as unknown as Tenure[];
  return rows;
}

/** Player ids who played under a single manager (by normalized manager name). */
export async function playersUnderManager(managerNorm: string): Promise<Set<string>> {
  const tenures = await tenuresFor(managerNorm);
  if (tenures.length === 0) return new Set();
  const teamMap = await getTeamNameMap();

  const result = new Set<string>();
  for (const t of tenures) {
    const exactNames: string[] = [];
    for (const key of aliasKeys(t.club)) {
      for (const exact of teamMap.get(key) ?? []) exactNames.push(exact);
    }
    if (exactNames.length === 0) continue;
    const to = t.seasonTo ?? 9999;
    const rows = (await db.execute(sql`
      SELECT DISTINCT player_id FROM player_stats
      WHERE league_id NOT IN (1,4)
        AND team_name IN (${sql.join(exactNames.map((n) => sql`${n}`), sql`, `)})
        AND season BETWEEN ${t.seasonFrom} AND ${to}
    `)) as unknown as Array<{ player_id: string }>;
    for (const r of rows) result.add(r.player_id);
  }
  return result;
}

/** Player ids who played under ALL of the given managers (intersection). */
export async function playersUnderAll(managerNorms: string[]): Promise<Set<string>> {
  if (managerNorms.length === 0) return new Set();
  const sets = await Promise.all(managerNorms.map((m) => playersUnderManager(m)));
  sets.sort((a, b) => a.size - b.size);
  const [smallest, ...rest] = sets;
  const out = new Set<string>();
  for (const id of smallest!) {
    if (rest.every((s) => s.has(id))) out.add(id);
  }
  return out;
}

export interface ManagerTenureRow {
  manager: string;
  managerNorm: string;
}

/** Marquee managers for prompts — excludes fringe coaches (Rose, Rangnick, …). */
export const TOP_MANAGER_SINGLE_COUNT = 45;
/** Pairs require both managers in this tighter set (~top 20%). */
export const TOP_MANAGER_PAIR_COUNT = 25;

export interface ManagerProminence {
  recallable: number;
  stars: number;
}

/** How many gettable / megastar players played under a manager (same bar as tower prompts). */
export async function managerProminence(ids: string[]): Promise<ManagerProminence> {
  if (ids.length === 0) return { recallable: 0, stars: 0 };
  const idList = sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);
  const rows = (await db.execute(sql`
    WITH agg AS (
      SELECT p.id, p.market_value_tier AS mvt,
        COALESCE(SUM(s.appearances) FILTER (WHERE s.league_id IN (39,140,135,78,61)),0) AS big5,
        COALESCE(SUM(s.appearances) FILTER (WHERE s.league_id = 2),0) AS ucl,
        COALESCE(SUM(s.appearances),0) AS total
      FROM players p LEFT JOIN player_stats s ON s.player_id = p.id
      WHERE p.id IN (${idList}) GROUP BY p.id, p.market_value_tier
    )
    SELECT COUNT(*) FILTER (WHERE mvt >= 4 OR big5 >= 60 OR ucl >= 35 OR total >= 250)::int AS recallable,
           COUNT(*) FILTER (WHERE mvt >= 5)::int AS stars
    FROM agg
  `)) as unknown as Array<{ recallable: number; stars: number }>;
  const r = rows[0];
  return { recallable: r?.recallable ?? 0, stars: r?.stars ?? 0 };
}

/** Rank managers by megastars under them, then recallable pool size. */
export async function rankManagersByProminence(
  rows: ManagerTenureRow[],
  setByNorm: Map<string, Set<string>>
): Promise<Array<{ row: ManagerTenureRow; prominence: ManagerProminence }>> {
  const scored = await Promise.all(
    rows.map(async (row) => ({
      row,
      prominence: await managerProminence([...(setByNorm.get(row.managerNorm) ?? [])]),
    }))
  );
  scored.sort(
    (a, b) =>
      b.prominence.stars - a.prominence.stars ||
      b.prominence.recallable - a.prominence.recallable
  );
  return scored;
}

export function topManagerNorms(
  ranked: Array<{ row: ManagerTenureRow; prominence: ManagerProminence }>,
  limit: number
): Set<string> {
  return new Set(ranked.slice(0, limit).map((r) => r.row.managerNorm));
}

/** Which curated tenure clubs failed to match any stored team_name (QA helper). */
export async function unmatchedTenureClubs(): Promise<string[]> {
  const teamMap = await getTeamNameMap();
  const rows = (await db.execute(sql`
    SELECT DISTINCT club FROM manager_tenures
  `)) as unknown as Array<{ club: string }>;
  const bad: string[] = [];
  for (const r of rows) {
    const matched = [...aliasKeys(r.club)].some((k) => teamMap.has(k));
    if (!matched) bad.push(r.club);
  }
  return bad.sort();
}
