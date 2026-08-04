/**
 * Battle Mode generator (mode id stays `draft_master`).
 *
 * Mechanic: a daily STAT category + a pool of draggable CONSTRAINT CHIPS shown above a fine-position
 * pitch. A chip is one of: a specific club, a whole league, a nationality, a nationality×league combo
 * ("a Spaniard who played in the PL"), or a nationality×club combo ("a Brazilian at Barcelona"). The
 * player drags each chip onto a slot and picks a player who SATISFIES that chip AND plays that slot's
 * fine position; the pick scores the player's TOTAL value of the day's category (the chip is only a
 * selection constraint). On submit the total is compared to the mathematically OPTIMAL lineup (best
 * chip→slot assignment + best player per cell), computed here via a max-weight assignment.
 *
 * Categories are expressed as a `(player_id, value)` value subquery (same pattern as Target Man), so
 * any per-player scalar works — league sums, career sums, peak value, transfer fee, trophies, caps…
 */
import { sql, type SQL } from 'drizzle-orm';
import { db } from '../db/index.js';
import { lookupTeamLogo } from './teamService.js';
import { leagueLogoUrl, resolveHeadshot } from '../constants/footballMedia.js';
import { getPhotoOverrides } from './photoOverrides.js';
import {
  DRAFT_POSITION_COMPATIBILITY_VERSION,
  playerMatchesSubPositionSql,
} from './playerPositionService.js';
import {
  careerGoalsSub,
  careerAssistsSub,
  careerAppsSub,
  careerYellowsSub,
  peakValueSub,
  recordFeeSub,
  careerTrophiesSub,
  intlCapsSub,
  mostClubsSub,
} from './statMetrics.js';

// ---------------------------------------------------------------------------
// Categories (13). Each yields a per-player scalar `(player_id, value)`.
// scope 'pl' = league-scoped to the Premier League, so only PL-based chips are coherent that day.
// ---------------------------------------------------------------------------

type CategoryScope = 'global' | 'pl';

interface Category {
  id: string;
  title: string;
  noun: string;
  unit: 'eur_m' | null;
  scope: CategoryScope;
  sub: SQL; // (player_id, value)
}

const sumMetric = (col: 'goals' | 'assists' | 'appearances' | 'yellow_cards', leagueIds: number[]): SQL =>
  sql`(SELECT player_id, SUM(${sql.raw(col)})::int AS value FROM player_stats
       WHERE league_id IN (${sql.join(leagueIds.map((l) => sql`${l}`), sql`, `)}) GROUP BY player_id)`;

const LEAGUE_TITLE_COMPETITIONS = ['Premier League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1'];
const leagueTitlesSub: SQL = sql`(SELECT player_id, COUNT(*)::int AS value FROM player_honours
  WHERE lower(placement) = 'winner' AND competition IN (${sql.join(LEAGUE_TITLE_COMPETITIONS.map((c) => sql`${c}`), sql`, `)})
  GROUP BY player_id)`;

const CATEGORIES: Category[] = [
  { id: 'career_goals', title: 'Career Goals', noun: 'goals', unit: null, scope: 'global', sub: careerGoalsSub },
  { id: 'career_assists', title: 'Career Assists', noun: 'assists', unit: null, scope: 'global', sub: careerAssistsSub },
  { id: 'career_apps', title: 'Career Appearances', noun: 'apps', unit: null, scope: 'global', sub: careerAppsSub },
  { id: 'career_yellows', title: 'Career Yellow Cards', noun: 'yellows', unit: null, scope: 'global', sub: careerYellowsSub },
  { id: 'pl_goals', title: 'Premier League Goals', noun: 'goals', unit: null, scope: 'pl', sub: sumMetric('goals', [39]) },
  { id: 'pl_assists', title: 'Premier League Assists', noun: 'assists', unit: null, scope: 'pl', sub: sumMetric('assists', [39]) },
  { id: 'cl_apps', title: 'Champions League Appearances', noun: 'apps', unit: null, scope: 'global', sub: sumMetric('appearances', [2]) },
  { id: 'peak_value', title: 'Peak Market Value', noun: '€m', unit: 'eur_m', scope: 'global', sub: peakValueSub },
  { id: 'record_fee', title: 'Highest Transfer Fee', noun: '€m', unit: 'eur_m', scope: 'global', sub: recordFeeSub },
  { id: 'career_trophies', title: 'Total Career Trophies', noun: 'trophies', unit: null, scope: 'global', sub: careerTrophiesSub },
  { id: 'league_titles', title: 'League Titles', noun: 'titles', unit: null, scope: 'global', sub: leagueTitlesSub },
  { id: 'intl_caps', title: 'International Caps', noun: 'caps', unit: null, scope: 'global', sub: intlCapsSub },
  { id: 'most_clubs', title: 'Most Clubs Played For', noun: 'clubs', unit: null, scope: 'global', sub: mostClubsSub },
];

function categoryById(id: string): Category | undefined {
  return CATEGORIES.find((c) => c.id === id);
}

// ---------------------------------------------------------------------------
// Constraint chips
// ---------------------------------------------------------------------------

type ConstraintType = 'club' | 'league' | 'nationality' | 'nat_league' | 'nat_club';

interface Constraint {
  id: string;
  type: ConstraintType;
  label: string;
  club?: string;
  teamId?: number | null;
  logoUrl?: string | null;
  leagueId?: number | null;
  leagueName?: string | null;
  nationality?: string | null;
}

const BIG5: Array<{ id: number; name: string }> = [
  { id: 39, name: 'Premier League' },
  { id: 140, name: 'La Liga' },
  { id: 135, name: 'Serie A' },
  { id: 78, name: 'Bundesliga' },
  { id: 61, name: 'Ligue 1' },
];
const LEAGUE_NAME: Record<number, string> = Object.fromEntries(BIG5.map((l) => [l.id, l.name]));

/** Nationalities recognisable enough to stand alone as a chip (≈ famous ≥ 20). */
const STANDALONE_NATIONS = [
  'France', 'Spain', 'England', 'Germany', 'Brazil', 'Italy', 'Netherlands', 'Argentina', 'Portugal', 'Belgium',
];

/**
 * Club membership for Draft chips. player_stats.team_name is the primary signal, but secondary
 * leagues (Championship etc.) often arrive with blank club names — John Terry's 32 Villa apps in
 * 2017/18 were invisible that way. Fall back to player_career so a known spell still counts.
 */
function playedForClubSql(club: string, playerRef: SQL = sql`p.id`): SQL {
  return sql`(
    EXISTS (
      SELECT 1 FROM player_stats m
      WHERE m.player_id = ${playerRef} AND m.team_name = ${club} AND m.appearances > 0
    )
    OR EXISTS (
      SELECT 1 FROM player_career c
      WHERE c.player_id = ${playerRef} AND c.team_name = ${club} AND c.team_id > 0
    )
  )`;
}

/** SQL yielding the set of player_ids that SATISFY a constraint (career-wide membership). */
function eligibilityIds(c: Constraint): SQL {
  switch (c.type) {
    case 'club':
      return sql`
        SELECT DISTINCT player_id FROM player_stats WHERE team_name = ${c.club} AND appearances > 0
        UNION
        SELECT DISTINCT player_id FROM player_career WHERE team_name = ${c.club} AND team_id > 0`;
    case 'league':
      return sql`SELECT DISTINCT player_id FROM player_stats WHERE league_id = ${c.leagueId} AND appearances > 0`;
    case 'nationality':
      return sql`SELECT id AS player_id FROM players WHERE nationality = ${c.nationality}`;
    case 'nat_league':
      return sql`SELECT DISTINCT ps.player_id FROM player_stats ps JOIN players pl ON pl.id = ps.player_id
                 WHERE ps.league_id = ${c.leagueId} AND ps.appearances > 0 AND pl.nationality = ${c.nationality}`;
    case 'nat_club':
      return sql`
        SELECT DISTINCT ps.player_id FROM player_stats ps JOIN players pl ON pl.id = ps.player_id
        WHERE ps.team_name = ${c.club} AND ps.appearances > 0 AND pl.nationality = ${c.nationality}
        UNION
        SELECT DISTINCT c.player_id FROM player_career c JOIN players pl ON pl.id = c.player_id
        WHERE c.team_name = ${c.club} AND c.team_id > 0 AND pl.nationality = ${c.nationality}`;
  }
}

// ---------------------------------------------------------------------------
// Formations — rotated daily among popular shapes (4-3-3, 4-4-2, 4-2-3-1, 3-5-2).
// ---------------------------------------------------------------------------

interface Slot { id: string; position: string }
const GK: Slot = { id: 'gk', position: 'Goalkeeper' };

const FORMATION_TEMPLATES: Record<string, Slot[]> = {
  '4-3-3': [
    GK,
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
  ],
  '4-4-2': [
    GK,
    { id: 'lb', position: 'Left-Back' },
    { id: 'cb1', position: 'Centre-Back' },
    { id: 'cb2', position: 'Centre-Back' },
    { id: 'rb', position: 'Right-Back' },
    { id: 'lm', position: 'Left Midfield' },
    { id: 'cm1', position: 'Central Midfield' },
    { id: 'cm2', position: 'Central Midfield' },
    { id: 'rm', position: 'Right Midfield' },
    { id: 'st1', position: 'Centre-Forward' },
    { id: 'st2', position: 'Centre-Forward' },
  ],
  '4-2-3-1': [
    GK,
    { id: 'lb', position: 'Left-Back' },
    { id: 'cb1', position: 'Centre-Back' },
    { id: 'cb2', position: 'Centre-Back' },
    { id: 'rb', position: 'Right-Back' },
    { id: 'dm1', position: 'Defensive Midfield' },
    { id: 'dm2', position: 'Defensive Midfield' },
    { id: 'lw', position: 'Left Winger' },
    { id: 'am', position: 'Attacking Midfield' },
    { id: 'rw', position: 'Right Winger' },
    { id: 'cf', position: 'Centre-Forward' },
  ],
  '3-5-2': [
    GK,
    { id: 'cb1', position: 'Centre-Back' },
    { id: 'cb2', position: 'Centre-Back' },
    { id: 'cb3', position: 'Centre-Back' },
    { id: 'lb', position: 'Left-Back' },
    { id: 'rb', position: 'Right-Back' },
    { id: 'dm', position: 'Defensive Midfield' },
    { id: 'cm1', position: 'Central Midfield' },
    { id: 'cm2', position: 'Central Midfield' },
    { id: 'st1', position: 'Centre-Forward' },
    { id: 'st2', position: 'Centre-Forward' },
  ],
};

const ROTATING_FORMATIONS = ['4-3-3', '4-4-2', '4-2-3-1', '3-5-2'] as const;

// Goalkeepers score ~0 for goals/assists, so those categories play an all-outfield XI.
function includeGk(cat: Category): boolean {
  return cat.id === 'career_apps' || cat.id === 'cl_apps' || cat.id === 'career_yellows' ||
    cat.id === 'peak_value' || cat.id === 'record_fee' || cat.id === 'career_trophies' ||
    cat.id === 'league_titles' || cat.id === 'intl_caps' || cat.id === 'most_clubs';
}

function formationFor(cat: Category, rotationSeed: number): { id: string; slots: Slot[] } {
  const base = ROTATING_FORMATIONS[Math.abs(rotationSeed) % ROTATING_FORMATIONS.length]!;
  const template = FORMATION_TEMPLATES[base]!;
  const withGk = includeGk(cat);
  const slots = withGk ? template : template.filter((s) => s.id !== 'gk');
  return { id: withGk ? base : `${base}-of`, slots };
}

// ---------------------------------------------------------------------------
// Deterministic per-day randomness.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Candidate chip pools (fame-gated, coverage-validated).
// ---------------------------------------------------------------------------

const ELITE_PL_MIN_FAMOUS = 8;   // all PL clubs qualify
const ELITE_OTHER_MIN_FAMOUS = 40; // only the giants elsewhere
const NAT_LEAGUE_MIN_FAMOUS = 3;
const NAT_CLUB_MIN_FAMOUS = 2;

/** Elite clubs: every PL club with ≥8 famous alumni, plus non-PL clubs with ≥40. */
async function eliteClubs(): Promise<Array<{ club: string; leagueId: number }>> {
  const rows = (await db.execute(sql`
    SELECT club, league_id FROM (
      SELECT s.team_name AS club, s.league_id,
             COUNT(DISTINCT p.id) FILTER (WHERE p.market_value_tier >= 4) AS famous
      FROM player_stats s JOIN players p ON p.id = s.player_id
      WHERE s.league_id IN (39, 140, 135, 78, 61) AND s.appearances > 0 AND s.team_name IS NOT NULL
      GROUP BY s.team_name, s.league_id
    ) t
    WHERE (league_id = 39 AND famous >= ${ELITE_PL_MIN_FAMOUS})
       OR (league_id <> 39 AND famous >= ${ELITE_OTHER_MIN_FAMOUS})
  `)) as unknown as Array<{ club: string; league_id: number }>;
  return rows.map((r) => ({ club: r.club, leagueId: r.league_id }));
}

/** Viable nationality×league combos (≥3 famous eligible). */
async function viableNatLeague(leagueIds: number[]): Promise<Array<{ nationality: string; leagueId: number }>> {
  const rows = (await db.execute(sql`
    SELECT p.nationality, s.league_id
    FROM players p JOIN player_stats s ON s.player_id = p.id
    WHERE s.league_id IN (${sql.join(leagueIds.map((l) => sql`${l}`), sql`, `)}) AND s.appearances > 0
    GROUP BY p.nationality, s.league_id
    HAVING COUNT(DISTINCT p.id) FILTER (WHERE p.market_value_tier >= 4) >= ${NAT_LEAGUE_MIN_FAMOUS}
  `)) as unknown as Array<{ nationality: string; league_id: number }>;
  return rows.map((r) => ({ nationality: r.nationality, leagueId: r.league_id }));
}

/** Viable nationality×club combos (≥2 famous eligible), restricted to the elite club set. */
async function viableNatClub(clubs: string[]): Promise<Array<{ nationality: string; club: string }>> {
  if (clubs.length === 0) return [];
  const rows = (await db.execute(sql`
    SELECT p.nationality, s.team_name AS club
    FROM players p JOIN player_stats s ON s.player_id = p.id
    WHERE s.team_name IN (${sql.join(clubs.map((c) => sql`${c}`), sql`, `)}) AND s.appearances > 0
    GROUP BY p.nationality, s.team_name
    HAVING COUNT(DISTINCT p.id) FILTER (WHERE p.market_value_tier >= 4) >= ${NAT_CLUB_MIN_FAMOUS}
  `)) as unknown as Array<{ nationality: string; club: string }>;
  return rows.map((r) => ({ nationality: r.nationality, club: r.club }));
}

// ---------------------------------------------------------------------------
// Best eligible player per (constraint, position) — the optimal cell values.
// ---------------------------------------------------------------------------

interface Cell { id: string; stat: number; name: string }

// Keep enough depth for distinct-player materialisation now that adjacent slots can share candidates.
const CELL_DEPTH = 6;

/**
 * For one constraint, the top-N eligible players (ranked by category value) at each needed
 * position. Returning a ranked list — not just the single best — lets the optimal lineup use 11
 * DISTINCT players (two Centre-Back slots can no longer be filled by the same person, and one
 * star can't be double-counted across two constraints), so the "optimal" score is achievable.
 */
async function bestCellsForConstraint(cat: Category, c: Constraint, positions: string[]): Promise<Map<string, Cell[]>> {
  const requestedPositions = sql.join(positions.map((position) => sql`(${position})`), sql`, `);
  const rows = (await db.execute(sql`
    WITH requested(pos) AS (VALUES ${requestedPositions}),
    val AS ${cat.sub},
    elig AS (${eligibilityIds(c)}),
    ranked AS (
      SELECT requested.pos, p.id, p.name, COALESCE(val.value, 0)::int AS stat,
             ROW_NUMBER() OVER (PARTITION BY requested.pos ORDER BY COALESCE(val.value, 0) DESC, p.name) AS rn
      FROM players p
      JOIN elig ON elig.player_id = p.id
      LEFT JOIN val ON val.player_id = p.id
      CROSS JOIN requested
      WHERE ${playerMatchesSubPositionSql(sql`requested.pos`)}
    )
    SELECT pos, id, name, stat FROM ranked WHERE rn <= ${CELL_DEPTH} ORDER BY pos, rn
  `)) as unknown as Array<{ pos: string; id: string; name: string; stat: number }>;
  const m = new Map<string, Cell[]>();
  for (const r of rows) {
    const list = m.get(r.pos) ?? [];
    list.push({ id: r.id, name: r.name, stat: r.stat });
    m.set(r.pos, list);
  }
  return m;
}

// ---------------------------------------------------------------------------
// Max-weight assignment (Hungarian on negated weights). Square n x n. assign[chip] = slot.
// ---------------------------------------------------------------------------

function maxWeightAssignment(weight: number[][]): { total: number; assign: number[] } {
  const n = weight.length;
  if (n === 0) return { total: 0, assign: [] };
  let maxW = 0;
  for (const row of weight) for (const w of row) maxW = Math.max(maxW, w);
  const cost = weight.map((row) => row.map((w) => maxW - w));
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
  return { total, assign };
}

// ---------------------------------------------------------------------------
// Puzzle assembly
// ---------------------------------------------------------------------------

export interface BattleOptimalPick {
  slotId: string;
  position: string;
  constraintId: string;
  constraintLabel: string;
  playerId?: string;
  playerName: string;
  statValue: number;
}

export interface BattleConstraintJson {
  id: string;
  type: ConstraintType;
  label: string;
  club: string | null;
  teamId: number | null;
  logoUrl: string | null;
  leagueId: number | null;
  leagueName: string | null;
  nationality: string | null;
}

export interface BattlePuzzleJson {
  modeId: 'draft_master';
  puzzleId: string;
  date: string;
  positionCompatibilityVersion: number;
  category: { id: string; title: string; noun: string; unit: 'eur_m' | null };
  formationId: string;
  slots: Array<{ id: string; position: string }>;
  constraints: BattleConstraintJson[];
  optimalScore: number;
  optimalLineup: BattleOptimalPick[];
}

/** Board composition (chip-type counts) for an n-slot board, scaled and clamped to n. */
function boardMix(n: number, scope: CategoryScope): { club: number; league: number; nationality: number; natLeague: number; natClub: number } {
  if (scope === 'pl') {
    // PL-coherent: mostly PL clubs + a couple "Nationality in the PL" combos.
    const natLeague = Math.min(3, Math.max(2, n - 8));
    return { club: n - natLeague, league: 0, nationality: 0, natLeague, natClub: 0 };
  }
  // Global default ≈ 4 clubs, 2 leagues, 2 nationalities, 3 combos (2 nat×league + 1 nat×club), scaled to n.
  const league = 2;
  const nationality = 2;
  const natLeague = 2;
  const natClub = Math.max(1, n - 4 - league - nationality - natLeague); // remainder → clubs baseline 4
  const club = n - league - nationality - natLeague - natClub;
  return { club, league, nationality, natLeague, natClub };
}

async function buildConstraintPool(
  cat: Category,
  clubs: Array<{ club: string; leagueId: number }>,
  seed: number,
  slotCount: number,
): Promise<Constraint[]> {
  const n = slotCount;
  const mix = boardMix(n, cat.scope);
  const isPl = cat.scope === 'pl';
  const clubNames = clubs.map((c) => c.club);
  const plClubNames = clubs.filter((c) => c.leagueId === 39).map((c) => c.club);

  const chosen: Constraint[] = [];
  let uid = 0;
  const nextId = () => `c${uid++}`;

  // Clubs
  const clubPool = isPl ? plClubNames : clubNames;
  for (const club of seededShuffle(clubPool, seed + 1).slice(0, mix.club)) {
    chosen.push({ id: nextId(), type: 'club', label: club, club });
  }

  // Leagues
  for (const lg of seededShuffle(BIG5, seed + 2).slice(0, mix.league)) {
    chosen.push({ id: nextId(), type: 'league', label: lg.name, leagueId: lg.id, leagueName: lg.name });
  }

  // Nationalities (standalone)
  for (const nat of seededShuffle(STANDALONE_NATIONS, seed + 3).slice(0, mix.nationality)) {
    chosen.push({ id: nextId(), type: 'nationality', label: nat, nationality: nat });
  }

  // Nationality × League
  if (mix.natLeague > 0) {
    const leagueIds = isPl ? [39] : BIG5.map((l) => l.id);
    const combos = await viableNatLeague(leagueIds);
    for (const cmb of seededShuffle(combos, seed + 4).slice(0, mix.natLeague)) {
      const name = LEAGUE_NAME[cmb.leagueId] ?? '';
      chosen.push({ id: nextId(), type: 'nat_league', label: `${cmb.nationality} · ${name}`, nationality: cmb.nationality, leagueId: cmb.leagueId, leagueName: name });
    }
  }

  // Nationality × Club
  if (mix.natClub > 0) {
    const combos = await viableNatClub(isPl ? plClubNames : clubNames);
    for (const cmb of seededShuffle(combos, seed + 5).slice(0, mix.natClub)) {
      chosen.push({ id: nextId(), type: 'nat_club', label: `${cmb.nationality} · ${cmb.club}`, nationality: cmb.nationality, club: cmb.club });
    }
  }

  return chosen;
}

/** Daily Draft XI — category/formation keyed off calendar date (stable for the day). */
export async function generateBattlePuzzle(date: string): Promise<BattlePuzzleJson | null> {
  const day = dayNumber(date);
  return assembleBattlePuzzle({
    dateLabel: date,
    puzzleId: `${date}-draft_master`,
    categoryIndex: day,
    formationSeed: day,
    chipSeedKey: `${date}:battle`,
  });
}

/** Ad-hoc Draft XI (VS challenges) — category, formation and chips all derived from seedKey. */
export async function generateBattlePuzzleFromSeed(seedKey: string): Promise<BattlePuzzleJson | null> {
  const baseSeed = hashString(seedKey);
  const today = new Date().toISOString().slice(0, 10);
  return assembleBattlePuzzle({
    dateLabel: today,
    puzzleId: `vs-${seedKey.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || baseSeed}`,
    categoryIndex: baseSeed,
    formationSeed: baseSeed >>> 8,
    chipSeedKey: seedKey,
  });
}

async function assembleBattlePuzzle(opts: {
  dateLabel: string;
  puzzleId: string;
  categoryIndex: number;
  formationSeed: number;
  chipSeedKey: string;
}): Promise<BattlePuzzleJson | null> {
  const { dateLabel, puzzleId, categoryIndex, formationSeed, chipSeedKey } = opts;
  const baseSeed = hashString(chipSeedKey);
  const category = CATEGORIES[Math.abs(categoryIndex) % CATEGORIES.length]!;
  const formation = formationFor(category, formationSeed);
  const slots = formation.slots;
  const positions = [...new Set(slots.map((s) => s.position))];

  const clubs = await eliteClubs();
  if (clubs.length < slots.length) return null;

  // Generate-and-validate: build a chip board, verify a solvable optimal XI (every assigned cell has a
  // real eligible player with a positive value). Reshuffle with a new seed on failure.
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const seed = baseSeed + attempt * 101;
    const constraints = await buildConstraintPool(category, clubs, seed, slots.length);
    if (constraints.length !== slots.length) continue;

    // Ranked eligible players per (constraint, position). The Hungarian assignment below uses the
    // TOP cell value as an upper bound to pick the best constraint→slot pairing; the lineup is then
    // materialised with DISTINCT players (see below).
    const perConstraint = await Promise.all(constraints.map((c) => bestCellsForConstraint(category, c, positions)));
    const topStat = (ci: number, position: string) => perConstraint[ci]!.get(position)?.[0]?.stat ?? 0;
    const weight = constraints.map((_, ci) => slots.map((slot) => topStat(ci, slot.position)));

    const { total: upperBound, assign } = maxWeightAssignment(weight);
    if (upperBound <= 0) continue;

    // Every chip must land on a slot where it actually has an eligible, positive-value player.
    const valid = assign.every((slotIdx, ci) => slotIdx >= 0 && topStat(ci, slots[slotIdx]!.position) > 0);
    if (!valid) continue;

    // constraintForSlot[slotIdx] = constraintIdx
    const constraintForSlot = new Array<number>(slots.length).fill(-1);
    assign.forEach((slotIdx, ci) => { if (slotIdx >= 0) constraintForSlot[slotIdx] = ci; });

    // Materialise the optimal XI with 11 DISTINCT players. Fill the most-constrained slots first
    // (fewest eligible options) so a shared star / the two Centre-Back slots resolve to different
    // players. optimalScore is the sum of the actually-chosen distinct players — guaranteed
    // achievable, so an honest perfect XI really does reach 100%.
    const usedPlayerIds = new Set<string>();
    const pickBySlot = new Array<BattleOptimalPick | null>(slots.length).fill(null);
    const order = slots
      .map((slot, si) => ({ si, options: (perConstraint[constraintForSlot[si]!]!.get(slot.position) ?? []).filter((c) => c.stat > 0).length }))
      .sort((a, b) => a.options - b.options)
      .map((o) => o.si);

    let feasible = true;
    let optimalScore = 0;
    for (const si of order) {
      const slot = slots[si]!;
      const ci = constraintForSlot[si]!;
      const c = constraints[ci]!;
      const pick = (perConstraint[ci]!.get(slot.position) ?? []).find((cell) => cell.stat > 0 && !usedPlayerIds.has(cell.id));
      if (!pick) { feasible = false; break; }
      usedPlayerIds.add(pick.id);
      optimalScore += pick.stat;
      pickBySlot[si] = {
        slotId: slot.id, position: slot.position,
        constraintId: c.id, constraintLabel: c.label,
        playerId: pick.id, playerName: pick.name, statValue: pick.stat,
      };
    }
    if (!feasible) continue;
    const optimalLineup: BattleOptimalPick[] = pickBySlot.map((p) => p!);

    // Decorate chips: club/nat_club → crest; league/nat_league → league badge CDN URL.
    const constraintsOut: BattleConstraintJson[] = await Promise.all(constraints.map(async (c) => {
      let teamId: number | null = null;
      let logoUrl: string | null = null;
      if ((c.type === 'club' || c.type === 'nat_club') && c.club) {
        const leagueName = clubs.find((k) => k.club === c.club)?.leagueId;
        const logo = await lookupTeamLogo(c.club, leagueName != null ? (LEAGUE_NAME[leagueName] ?? '') : '');
        teamId = logo?.teamId ?? null;
        logoUrl = logo?.logoUrl ?? null;
      } else if ((c.type === 'league' || c.type === 'nat_league') && c.leagueId != null) {
        logoUrl = leagueLogoUrl(c.leagueId);
      }
      return {
        id: c.id, type: c.type, label: c.label,
        club: c.club ?? null, teamId, logoUrl,
        leagueId: c.leagueId ?? null, leagueName: c.leagueName ?? null,
        nationality: c.nationality ?? null,
      };
    }));

    return {
      modeId: 'draft_master',
      puzzleId,
      date: dateLabel,
      positionCompatibilityVersion: DRAFT_POSITION_COMPATIBILITY_VERSION,
      category: { id: category.id, title: category.title, noun: category.noun, unit: category.unit },
      formationId: formation.id,
      slots: slots.map((s) => ({ id: s.id, position: s.position })),
      constraints: constraintsOut,
      optimalScore,
      optimalLineup,
    };
  }

  return null;
}

function normalizeConstraintType(type: string): ConstraintType | null {
  if (type === 'natLeague') return 'nat_league';
  if (type === 'natClub') return 'nat_club';
  if (
    type === 'club' ||
    type === 'league' ||
    type === 'nationality' ||
    type === 'nat_league' ||
    type === 'nat_club'
  ) {
    return type;
  }
  return null;
}

/**
 * Re-solve the optimal XI for an existing Draft puzzle after Ops edits the constraint chips.
 * Uses the same Hungarian + distinct-player materialisation as generation.
 */
export async function recomputeBattleOptimalLineup(
  puzzle: BattlePuzzleJson
): Promise<{ optimalScore: number; optimalLineup: BattleOptimalPick[] } | null> {
  const cat = categoryById(puzzle.category.id);
  if (!cat) return null;

  const slots = puzzle.slots;
  const constraints: Constraint[] = [];
  for (const raw of puzzle.constraints) {
    const type = normalizeConstraintType(String(raw.type ?? ''));
    if (!type) return null;
    constraints.push({
      id: raw.id,
      type,
      label: raw.label,
      club: raw.club ?? undefined,
      teamId: raw.teamId,
      logoUrl: raw.logoUrl,
      leagueId: raw.leagueId,
      leagueName: raw.leagueName,
      nationality: raw.nationality,
    });
  }
  if (constraints.length === 0 || constraints.length !== slots.length) return null;

  const positions = [...new Set(slots.map((s) => s.position))];
  const perConstraint = await Promise.all(
    constraints.map((c) => bestCellsForConstraint(cat, c, positions))
  );
  const topStat = (ci: number, position: string) =>
    perConstraint[ci]!.get(position)?.[0]?.stat ?? 0;
  const weight = constraints.map((_, ci) => slots.map((slot) => topStat(ci, slot.position)));
  const { total: upperBound, assign } = maxWeightAssignment(weight);
  if (upperBound <= 0) return null;

  const valid = assign.every(
    (slotIdx, ci) => slotIdx >= 0 && topStat(ci, slots[slotIdx]!.position) > 0
  );
  if (!valid) return null;

  const constraintForSlot = new Array<number>(slots.length).fill(-1);
  assign.forEach((slotIdx, ci) => {
    if (slotIdx >= 0) constraintForSlot[slotIdx] = ci;
  });

  const usedPlayerIds = new Set<string>();
  const pickBySlot = new Array<BattleOptimalPick | null>(slots.length).fill(null);
  const order = slots
    .map((slot, si) => ({
      si,
      options: (perConstraint[constraintForSlot[si]!]!.get(slot.position) ?? []).filter(
        (c) => c.stat > 0
      ).length,
    }))
    .sort((a, b) => a.options - b.options)
    .map((o) => o.si);

  let optimalScore = 0;
  for (const si of order) {
    const slot = slots[si]!;
    const ci = constraintForSlot[si]!;
    const c = constraints[ci]!;
    const pick = (perConstraint[ci]!.get(slot.position) ?? []).find(
      (cell) => cell.stat > 0 && !usedPlayerIds.has(cell.id)
    );
    if (!pick) return null;
    usedPlayerIds.add(pick.id);
    optimalScore += pick.stat;
    pickBySlot[si] = {
      slotId: slot.id,
      position: slot.position,
      constraintId: c.id,
      constraintLabel: c.label,
      playerId: pick.id,
      playerName: pick.name,
      statValue: pick.stat,
    };
  }

  return {
    optimalScore,
    optimalLineup: pickBySlot.map((p) => p!),
  };
}

// ---------------------------------------------------------------------------
// Player search for a slot: players at `position` with their category value, flagged by whether they
// satisfy the slot's constraint (a non-satisfying pick is allowed but scores 0 and shows red).
// ---------------------------------------------------------------------------

export interface BattleConstraintQuery {
  type: ConstraintType;
  club?: string | null;
  leagueId?: number | null;
  nationality?: string | null;
}

export interface BattlePlayerResult {
  id: string;
  name: string;
  statValue: number;
  nationality: string | null;
  satisfiesConstraint: boolean;
  headshotUrl?: string;
}

/** EXISTS/predicate SQL for whether a player row `p` satisfies the constraint. */
function satisfiesSql(c: BattleConstraintQuery): SQL {
  switch (c.type) {
    case 'club':
      return playedForClubSql(c.club ?? '');
    case 'league':
      return sql`EXISTS (SELECT 1 FROM player_stats m WHERE m.player_id = p.id AND m.league_id = ${c.leagueId ?? -1} AND m.appearances > 0)`;
    case 'nationality':
      return sql`(p.nationality = ${c.nationality ?? ''})`;
    case 'nat_league':
      return sql`(p.nationality = ${c.nationality ?? ''} AND EXISTS (SELECT 1 FROM player_stats m WHERE m.player_id = p.id AND m.league_id = ${c.leagueId ?? -1} AND m.appearances > 0))`;
    case 'nat_club':
      return sql`(p.nationality = ${c.nationality ?? ''} AND ${playedForClubSql(c.club ?? '')})`;
  }
}

/**
 * Server-authoritative Draft XI score from the user's actual picks. Recomputes each pick's category
 * value + whether the player satisfies the placed constraint AND plays the slot's position, then
 * returns the percentage-of-optimal (the value the client shows) and won flag — so XP can't be
 * fabricated by the client.
 */
export async function recomputeBattleScore(
  puzzle: BattlePuzzleJson,
  picks: Array<{ slotId: string; constraintId: string; playerId: string }>
): Promise<{ score: number; won: boolean; total: number }> {
  const cat = categoryById(puzzle.category.id);
  if (!cat || puzzle.optimalScore <= 0) return { score: 0, won: false, total: 0 };
  const slotPosition = new Map(puzzle.slots.map((s) => [s.id, s.position]));
  const constraintById = new Map(puzzle.constraints.map((c) => [c.id, c]));

  const usedPlayers = new Set<string>();
  let total = 0;
  for (const pick of picks) {
    const constraint = constraintById.get(pick.constraintId);
    const position = slotPosition.get(pick.slotId);
    if (!constraint || !position || usedPlayers.has(pick.playerId)) continue;
    usedPlayers.add(pick.playerId);
    const query: BattleConstraintQuery = {
      type: constraint.type, club: constraint.club, leagueId: constraint.leagueId, nationality: constraint.nationality,
    };
    const rows = (await db.execute(sql`
      WITH val AS ${cat.sub}
      SELECT COALESCE(val.value, 0)::int AS stat, ${playerMatchesSubPositionSql(position)} AS pos_ok, ${satisfiesSql(query)} AS satisfies
      FROM players p LEFT JOIN val ON val.player_id = p.id
      WHERE p.id = ${pick.playerId}::uuid
    `)) as unknown as Array<{ stat: number; pos_ok: boolean; satisfies: boolean }>;
    const r = rows[0];
    if (r && r.pos_ok && r.satisfies) total += r.stat;
  }

  // Score IS the XP: share of the optimal XI out of the Draft XI max (1100). won at >= 70%.
  const pct = total / puzzle.optimalScore;
  const score = Math.min(1100, Math.round(1100 * pct));
  return { score, won: pct >= 0.7, total };
}

export async function battlePlayers(
  categoryId: string,
  constraint: BattleConstraintQuery,
  position: string,
  query: string
): Promise<BattlePlayerResult[]> {
  const cat = categoryById(categoryId);
  if (!cat) return [];
  const q = query.trim().toLowerCase();
  const like = `%${q}%`;
  const nameFilter = q.length >= 2
    ? sql`AND (lower(p.name) LIKE ${like} OR lower(p.search_text) LIKE ${like})`
    : sql``;
  const rows = (await db.execute(sql`
    WITH val AS ${cat.sub}
    SELECT p.id, p.name, p.api_football_id, p.nationality,
      COALESCE(val.value, 0)::int AS stat,
      ${satisfiesSql(constraint)} AS satisfies
    FROM players p
    LEFT JOIN val ON val.player_id = p.id
    WHERE ${playerMatchesSubPositionSql(position)}
      ${nameFilter}
    ORDER BY (${satisfiesSql(constraint)}) DESC, COALESCE(val.value, 0) DESC, p.name
    LIMIT 25
  `)) as unknown as Array<{ id: string; name: string; api_football_id: number | null; nationality: string | null; stat: number; satisfies: boolean }>;
  const overrides = await getPhotoOverrides();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    statValue: r.stat,
    nationality: r.nationality,
    satisfiesConstraint: r.satisfies,
    headshotUrl: resolveHeadshot(overrides.get(r.id), r.api_football_id) ?? undefined,
  }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);
  generateBattlePuzzle(date)
    .then((puzzle) => {
      if (!puzzle) { console.log(`No viable draft puzzle for ${date}`); process.exit(1); }
      console.log(`\n=== DRAFT XI ${date} — ${puzzle.category.title} (optimal ${puzzle.optimalScore}) ===\n`);
      for (const pick of puzzle.optimalLineup) {
        console.log(`  ${pick.position.padEnd(20)} ${pick.constraintLabel.padEnd(28)} ${pick.playerName} (${pick.statValue})`);
      }
      const names = puzzle.optimalLineup.map((p) => p.playerName);
      const distinct = new Set(names).size;
      console.log(`\nDistinct players in optimal XI: ${distinct}/${names.length} ${distinct === names.length ? 'OK' : 'DUPLICATE!'}`);
      process.exit(distinct === names.length ? 0 : 1);
    })
    .catch((err) => { console.error(err); process.exit(1); });
}
