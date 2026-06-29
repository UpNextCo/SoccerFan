/**
 * Battle Mode generator (mode id stays `draft_master`).
 *
 * Mechanic: a daily STAT category, 11 category-relevant CLUBS shown above the pitch, and a
 * fine-position formation. The player drags each club onto a slot and picks a player who played for
 * that club at that position; the pick scores the player's TOTAL career value of the category (the
 * club is only a selection constraint). On submit the total is compared to the mathematically
 * OPTIMAL lineup (best club->slot assignment + best player per cell), computed here via a
 * max-weight assignment.
 */
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { lookupTeamLogo } from './teamService.js';
import { playerHeadshotUrl } from '../constants/footballMedia.js';

interface Category {
  id: string;
  title: string;
  noun: string;
  metric: 'appearances' | 'goals';
  /** League the stat + club membership are scoped to. Null = career (all club football). */
  leagueId: number | null;
}

const CATEGORIES: Category[] = [
  { id: 'career_apps', title: 'Career Appearances', noun: 'apps', metric: 'appearances', leagueId: null },
  { id: 'career_goals', title: 'Career Goals', noun: 'goals', metric: 'goals', leagueId: null },
  { id: 'pl_apps', title: 'Premier League Appearances', noun: 'apps', metric: 'appearances', leagueId: 39 },
  { id: 'pl_goals', title: 'Premier League Goals', noun: 'goals', metric: 'goals', leagueId: 39 },
  { id: 'laliga_apps', title: 'La Liga Appearances', noun: 'apps', metric: 'appearances', leagueId: 140 },
  { id: 'laliga_goals', title: 'La Liga Goals', noun: 'goals', metric: 'goals', leagueId: 140 },
  { id: 'seriea_apps', title: 'Serie A Appearances', noun: 'apps', metric: 'appearances', leagueId: 135 },
  { id: 'seriea_goals', title: 'Serie A Goals', noun: 'goals', metric: 'goals', leagueId: 135 },
  { id: 'bundesliga_goals', title: 'Bundesliga Goals', noun: 'goals', metric: 'goals', leagueId: 78 },
  { id: 'ligue1_goals', title: 'Ligue 1 Goals', noun: 'goals', metric: 'goals', leagueId: 61 },
];

const LEAGUE_NAME: Record<number, string> = {
  39: 'Premier League', 140: 'La Liga', 135: 'Serie A', 78: 'Bundesliga', 61: 'Ligue 1',
};
const BIG5 = [39, 140, 135, 78, 61];

// Fine-position 4-3-3 using only the well-covered positions (every big club fills these).
interface Slot { id: string; position: string }
const FORMATION_ID = '4-3-3';
const SLOTS: Slot[] = [
  { id: 'gk', position: 'Goalkeeper' },
  { id: 'lb', position: 'Left-Back' },
  { id: 'cb1', position: 'Centre-Back' },
  { id: 'cb2', position: 'Centre-Back' },
  { id: 'rb', position: 'Right-Back' },
  { id: 'dm', position: 'Defensive Midfield' },
  { id: 'cm', position: 'Central Midfield' },
  { id: 'am', position: 'Attacking Midfield' },
  { id: 'lw', position: 'Left Winger' },
  { id: 'cf', position: 'Centre-Forward' },
  { id: 'rw', position: 'Right Winger' },
];
const CLUB_COUNT = 11;

export interface BattlePuzzleJson {
  modeId: 'draft_master';
  puzzleId: string;
  date: string;
  category: { id: string; title: string; noun: string };
  formationId: string;
  slots: Array<{ id: string; position: string }>;
  clubs: Array<{ name: string; teamId: number | null; logoUrl: string | null }>;
  optimalScore: number;
}

function hashString(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) { h = (h << 5) - h + input.charCodeAt(i); h |= 0; }
  return Math.abs(h);
}
function dayNumber(date: string): number {
  const ms = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.floor(ms / 86_400_000) : 0;
}
function seededShuffle<T>(arr: T[], seed: number): T[] {
  const r = [...arr];
  let s = BigInt(seed === 0 ? 1 : seed);
  for (let i = r.length - 1; i > 0; i -= 1) {
    s = (s * 6364136223846793005n + 1n) & ((1n << 64n) - 1n);
    const j = Number(s % BigInt(i + 1));
    [r[i], r[j]] = [r[j]!, r[i]!];
  }
  return r;
}

/** SQL fragments scoping the stat + club membership to the category's league (or all club football). */
function leagueScope(cat: Category) {
  return cat.leagueId != null ? sql`s.league_id = ${cat.leagueId}` : sql`s.league_id <> 1`;
}
function membershipScope(cat: Category) {
  return cat.leagueId != null ? sql`m.league_id = ${cat.leagueId}` : sql`m.league_id <> 1`;
}

/** Pick the candidate clubs for a category (league clubs, or big-5 clubs for career). */
async function candidateClubs(cat: Category): Promise<string[]> {
  const leagueFilter = cat.leagueId != null
    ? sql`s.league_id = ${cat.leagueId}`
    : sql`s.league_id IN (${sql.join(BIG5.map((l) => sql`${l}`), sql`, `)})`;
  const rows = (await db.execute(sql`
    SELECT s.team_name AS club, COUNT(DISTINCT p.id)::int AS n
    FROM player_stats s JOIN players p ON p.id = s.player_id
    WHERE ${leagueFilter} AND p.sub_position IS NOT NULL AND s.appearances > 0 AND s.team_name IS NOT NULL
    GROUP BY s.team_name
    HAVING COUNT(DISTINCT p.id) >= 20
    ORDER BY n DESC
    LIMIT 36
  `)) as unknown as Array<{ club: string; n: number }>;
  return rows.map((r) => r.club);
}

/** Max category total per (club, fine-position) for the chosen clubs — the optimal cell values. */
async function bestCells(cat: Category, clubs: string[]): Promise<Map<string, number>> {
  const positions = [...new Set(SLOTS.map((s) => s.position))];
  const clubList = sql.join(clubs.map((c) => sql`${c}`), sql`, `);
  const posList = sql.join(positions.map((p) => sql`${p}`), sql`, `);
  const metric = sql.raw(cat.metric);
  const rows = (await db.execute(sql`
    WITH pstat AS (
      SELECT p.id, p.sub_position AS pos,
        COALESCE(SUM(s.${metric}) FILTER (WHERE ${leagueScope(cat)}), 0)::int AS stat
      FROM players p JOIN player_stats s ON s.player_id = p.id
      WHERE p.sub_position IN (${posList})
      GROUP BY p.id, p.sub_position
    ),
    mem AS (
      SELECT DISTINCT m.player_id, m.team_name
      FROM player_stats m
      WHERE m.team_name IN (${clubList}) AND m.appearances > 0 AND ${membershipScope(cat)}
    )
    SELECT mem.team_name AS club, pstat.pos AS pos, MAX(pstat.stat)::int AS best
    FROM mem JOIN pstat ON pstat.id = mem.player_id
    WHERE pstat.stat > 0
    GROUP BY mem.team_name, pstat.pos
  `)) as unknown as Array<{ club: string; pos: string; best: number }>;
  const m = new Map<string, number>();
  for (const r of rows) m.set(`${r.club}|${r.pos}`, r.best);
  return m;
}

/** Max-weight assignment (Hungarian on negated weights). Square n x n. Returns the optimal total. */
function maxWeightAssignment(weight: number[][]): number {
  const n = weight.length;
  if (n === 0) return 0;
  let maxW = 0;
  for (const row of weight) for (const w of row) maxW = Math.max(maxW, w);
  const cost = weight.map((row) => row.map((w) => maxW - w)); // minimise -> maximises weight
  const INF = Number.POSITIVE_INFINITY;
  const u = new Array(n + 1).fill(0);
  const v = new Array(n + 1).fill(0);
  const p = new Array(n + 1).fill(0);
  const way = new Array(n + 1).fill(0);
  for (let i = 1; i <= n; i += 1) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(n + 1).fill(INF);
    const used = new Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = INF;
      let j1 = -1;
      for (let j = 1; j <= n; j += 1) {
        if (used[j]) continue;
        const cur = cost[i0 - 1]![j - 1]! - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= n; j += 1) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; }
        else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const assign = new Array(n).fill(-1);
  for (let j = 1; j <= n; j += 1) assign[p[j] - 1] = j - 1;
  let total = 0;
  for (let i = 0; i < n; i += 1) total += weight[i]![assign[i]!]!;
  return total;
}

export async function generateBattlePuzzle(date: string): Promise<BattlePuzzleJson | null> {
  const seed = hashString(`${date}:battle`);
  const category = CATEGORIES[dayNumber(date) % CATEGORIES.length]!;

  const candidates = await candidateClubs(category);
  if (candidates.length < CLUB_COUNT) return null;
  // Take a good pool then a seeded sample of 11, so it varies day to day but stays recognisable.
  const clubs = seededShuffle(candidates, seed).slice(0, CLUB_COUNT);

  const cells = await bestCells(category, clubs);
  // weight[club][slot] = best player total for that club at that slot's fine position (0 if none).
  const weight = clubs.map((club) => SLOTS.map((slot) => cells.get(`${club}|${slot.position}`) ?? 0));
  const optimalScore = maxWeightAssignment(weight);
  if (optimalScore <= 0) return null;

  const clubsOut = await Promise.all(clubs.map(async (name) => {
    const logo = await lookupTeamLogo(name, category.leagueId != null ? LEAGUE_NAME[category.leagueId]! : '');
    return { name, teamId: logo?.teamId ?? null, logoUrl: logo?.logoUrl ?? null };
  }));

  return {
    modeId: 'draft_master',
    puzzleId: `${date}-draft_master`,
    date,
    category: { id: category.id, title: category.title, noun: category.noun },
    formationId: FORMATION_ID,
    slots: SLOTS.map((s) => ({ id: s.id, position: s.position })),
    clubs: clubsOut,
    optimalScore,
  };
}

export interface BattlePlayerResult {
  id: string;
  name: string;
  statValue: number;
  headshotUrl?: string;
}

/**
 * Players who played for `club` at the given fine `position`, name-matched, with their category
 * total. Powers the in-slot search; the top result is what the optimal lineup uses for that cell.
 */
export async function battlePlayers(
  categoryId: string,
  club: string,
  position: string,
  query: string
): Promise<BattlePlayerResult[]> {
  const cat = CATEGORIES.find((c) => c.id === categoryId);
  if (!cat) return [];
  const metric = sql.raw(cat.metric);
  const q = query.trim().toLowerCase();
  const like = `%${q}%`;
  const nameFilter = q.length >= 2
    ? sql`AND (lower(p.name) LIKE ${like} OR lower(p.search_text) LIKE ${like})`
    : sql``;
  const rows = (await db.execute(sql`
    SELECT p.id, p.name, p.api_football_id,
      COALESCE(SUM(s.${metric}) FILTER (WHERE ${leagueScope(cat)}), 0)::int AS stat
    FROM players p JOIN player_stats s ON s.player_id = p.id
    WHERE p.sub_position = ${position}
      AND EXISTS (
        SELECT 1 FROM player_stats m
        WHERE m.player_id = p.id AND m.team_name = ${club} AND m.appearances > 0 AND ${membershipScope(cat)}
      )
      ${nameFilter}
    GROUP BY p.id, p.name, p.api_football_id
    ORDER BY stat DESC
    LIMIT 20
  `)) as unknown as Array<{ id: string; name: string; api_football_id: number | null; stat: number }>;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    statValue: r.stat,
    headshotUrl: playerHeadshotUrl(r.api_football_id) ?? undefined,
  }));
}
