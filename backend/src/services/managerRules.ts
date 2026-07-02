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
