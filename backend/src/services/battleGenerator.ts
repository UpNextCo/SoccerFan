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
import { resolveHeadshot } from '../constants/footballMedia.js';
import { getPhotoOverrides } from './photoOverrides.js';

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

/** Club competitions counted as "career": big-5 leagues + Champions League + Europa League. */
const CAREER_LEAGUES = [39, 140, 135, 78, 61, 2, 3];

const sumMetric = (col: 'goals' | 'assists' | 'appearances' | 'yellow_cards', leagueIds: number[]): SQL =>
  sql`(SELECT player_id, SUM(${sql.raw(col)})::int AS value FROM player_stats
       WHERE league_id IN (${sql.join(leagueIds.map((l) => sql`${l}`), sql`, `)}) GROUP BY player_id)`;

const peakValueSub: SQL = sql`(SELECT id AS player_id, ROUND(COALESCE(peak_market_value_eur, 0) / 1000000.0)::int AS value
  FROM players WHERE peak_market_value_eur IS NOT NULL)`;

// Record fee comes from the transfers table (10k+ players) not players.record_fee_eur (~4.7k).
const recordFeeSub: SQL = sql`(SELECT player_id, ROUND(MAX(fee_eur_m))::int AS value FROM player_transfers
  WHERE fee_eur_m IS NOT NULL GROUP BY player_id)`;

// Real, fan-countable club trophies only — excludes Super Cups / Community Shield / friendlies.
const TROPHY_COMPETITIONS = [
  'Premier League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1',
  'UEFA Champions League', 'UEFA Europa League',
  'FA Cup', 'League Cup', 'Copa del Rey', 'DFB Pokal', 'Coppa Italia', 'Coupe de France',
];
const trophiesSub: SQL = sql`(SELECT player_id, COUNT(*)::int AS value FROM player_honours
  WHERE lower(placement) = 'winner' AND competition IN (${sql.join(TROPHY_COMPETITIONS.map((c) => sql`${c}`), sql`, `)})
  GROUP BY player_id)`;

const LEAGUE_TITLE_COMPETITIONS = ['Premier League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1'];
const leagueTitlesSub: SQL = sql`(SELECT player_id, COUNT(*)::int AS value FROM player_honours
  WHERE lower(placement) = 'winner' AND competition IN (${sql.join(LEAGUE_TITLE_COMPETITIONS.map((c) => sql`${c}`), sql`, `)})
  GROUP BY player_id)`;

const intlCapsSub: SQL = sql`(SELECT player_id, intl_caps::int AS value FROM player_extra_stats)`;

const mostClubsSub: SQL = sql`(SELECT player_id, COUNT(DISTINCT team_id)::int AS value FROM player_career GROUP BY player_id)`;

const CATEGORIES: Category[] = [
  { id: 'career_goals', title: 'Career Goals', noun: 'goals', unit: null, scope: 'global', sub: sumMetric('goals', CAREER_LEAGUES) },
  { id: 'career_assists', title: 'Career Assists', noun: 'assists', unit: null, scope: 'global', sub: sumMetric('assists', CAREER_LEAGUES) },
  { id: 'career_apps', title: 'Career Appearances', noun: 'apps', unit: null, scope: 'global', sub: sumMetric('appearances', CAREER_LEAGUES) },
  { id: 'career_yellows', title: 'Career Yellow Cards', noun: 'yellows', unit: null, scope: 'global', sub: sumMetric('yellow_cards', CAREER_LEAGUES) },
  { id: 'pl_goals', title: 'Premier League Goals', noun: 'goals', unit: null, scope: 'pl', sub: sumMetric('goals', [39]) },
  { id: 'pl_assists', title: 'Premier League Assists', noun: 'assists', unit: null, scope: 'pl', sub: sumMetric('assists', [39]) },
  { id: 'cl_apps', title: 'Champions League Appearances', noun: 'apps', unit: null, scope: 'global', sub: sumMetric('appearances', [2]) },
  { id: 'peak_value', title: 'Peak Market Value', noun: '€m', unit: 'eur_m', scope: 'global', sub: peakValueSub },
  { id: 'record_fee', title: 'Highest Transfer Fee', noun: '€m', unit: 'eur_m', scope: 'global', sub: recordFeeSub },
  { id: 'career_trophies', title: 'Total Career Trophies', noun: 'trophies', unit: null, scope: 'global', sub: trophiesSub },
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

/** SQL yielding the set of player_ids that SATISFY a constraint (career-wide membership). */
function eligibilityIds(c: Constraint): SQL {
  switch (c.type) {
    case 'club':
      return sql`SELECT DISTINCT player_id FROM player_stats WHERE team_name = ${c.club} AND appearances > 0`;
    case 'league':
      return sql`SELECT DISTINCT player_id FROM player_stats WHERE league_id = ${c.leagueId} AND appearances > 0`;
    case 'nationality':
      return sql`SELECT id AS player_id FROM players WHERE nationality = ${c.nationality}`;
    case 'nat_league':
      return sql`SELECT DISTINCT ps.player_id FROM player_stats ps JOIN players pl ON pl.id = ps.player_id
                 WHERE ps.league_id = ${c.leagueId} AND ps.appearances > 0 AND pl.nationality = ${c.nationality}`;
    case 'nat_club':
      return sql`SELECT DISTINCT ps.player_id FROM player_stats ps JOIN players pl ON pl.id = ps.player_id
                 WHERE ps.team_name = ${c.club} AND ps.appearances > 0 AND pl.nationality = ${c.nationality}`;
  }
}

// ---------------------------------------------------------------------------
// Formation (unchanged from the club-only version).
// ---------------------------------------------------------------------------

interface Slot { id: string; position: string }
const GK_SLOT: Slot = { id: 'gk', position: 'Goalkeeper' };
const OUTFIELD_SLOTS: Slot[] = [
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

// Goalkeepers score ~0 for goals/assists, so those categories play an all-outfield XI.
function includeGk(cat: Category): boolean {
  return cat.id === 'career_apps' || cat.id === 'cl_apps' || cat.id === 'career_yellows' ||
    cat.id === 'peak_value' || cat.id === 'record_fee' || cat.id === 'career_trophies' ||
    cat.id === 'league_titles' || cat.id === 'intl_caps' || cat.id === 'most_clubs';
}

function formationFor(cat: Category): { id: string; slots: Slot[] } {
  return includeGk(cat)
    ? { id: '4-3-3', slots: [GK_SLOT, ...OUTFIELD_SLOTS] }
    : { id: '4-3-3-of', slots: [...OUTFIELD_SLOTS] };
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

interface Cell { stat: number; name: string }

/** For one constraint, the best (highest category value) eligible player at each needed position. */
async function bestCellsForConstraint(cat: Category, c: Constraint, positions: string[]): Promise<Map<string, Cell>> {
  const posList = sql.join(positions.map((p) => sql`${p}`), sql`, `);
  const rows = (await db.execute(sql`
    WITH val AS ${cat.sub},
    elig AS (${eligibilityIds(c)})
    SELECT DISTINCT ON (p.sub_position) p.sub_position AS pos, p.name, COALESCE(val.value, 0)::int AS stat
    FROM players p
    JOIN elig ON elig.player_id = p.id
    LEFT JOIN val ON val.player_id = p.id
    WHERE p.sub_position IN (${posList})
    ORDER BY p.sub_position, COALESCE(val.value, 0) DESC, p.name
  `)) as unknown as Array<{ pos: string; name: string; stat: number }>;
  const m = new Map<string, Cell>();
  for (const r of rows) m.set(r.pos, { stat: r.stat, name: r.name });
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
): Promise<Constraint[]> {
  const n = formationFor(cat).slots.length;
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

export async function generateBattlePuzzle(date: string): Promise<BattlePuzzleJson | null> {
  const baseSeed = hashString(`${date}:battle`);
  const category = CATEGORIES[dayNumber(date) % CATEGORIES.length]!;
  const formation = formationFor(category);
  const slots = formation.slots;
  const positions = [...new Set(slots.map((s) => s.position))];

  const clubs = await eliteClubs();
  if (clubs.length < slots.length) return null;

  // Generate-and-validate: build a chip board, verify a solvable optimal XI (every assigned cell has a
  // real eligible player with a positive value). Reshuffle with a new seed on failure.
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const seed = baseSeed + attempt * 101;
    const constraints = await buildConstraintPool(category, clubs, seed);
    if (constraints.length !== slots.length) continue;

    // cellStat[constraintIdx][slotIdx] + names, from per-position best eligible player.
    const perConstraint = await Promise.all(constraints.map((c) => bestCellsForConstraint(category, c, positions)));
    const weight = constraints.map((_, ci) => slots.map((slot) => perConstraint[ci]!.get(slot.position)?.stat ?? 0));

    const { total: optimalScore, assign } = maxWeightAssignment(weight);
    if (optimalScore <= 0) continue;

    // Every chip must land on a slot where it actually has an eligible, positive-value player.
    const valid = assign.every((slotIdx, ci) => slotIdx >= 0 && (perConstraint[ci]!.get(slots[slotIdx]!.position)?.stat ?? 0) > 0);
    if (!valid) continue;

    // constraintForSlot[slotIdx] = constraintIdx
    const constraintForSlot = new Array<number>(slots.length).fill(-1);
    assign.forEach((slotIdx, ci) => { if (slotIdx >= 0) constraintForSlot[slotIdx] = ci; });

    const optimalLineup: BattleOptimalPick[] = slots.map((slot, si) => {
      const ci = constraintForSlot[si]!;
      const c = constraints[ci]!;
      const cell = perConstraint[ci]!.get(slot.position);
      return {
        slotId: slot.id, position: slot.position,
        constraintId: c.id, constraintLabel: c.label,
        playerName: cell?.name ?? '—', statValue: cell?.stat ?? 0,
      };
    });

    // Decorate club/nat_club chips with crest logos.
    const constraintsOut: BattleConstraintJson[] = await Promise.all(constraints.map(async (c) => {
      let teamId: number | null = null;
      let logoUrl: string | null = null;
      if ((c.type === 'club' || c.type === 'nat_club') && c.club) {
        const leagueName = clubs.find((k) => k.club === c.club)?.leagueId;
        const logo = await lookupTeamLogo(c.club, leagueName != null ? (LEAGUE_NAME[leagueName] ?? '') : '');
        teamId = logo?.teamId ?? null;
        logoUrl = logo?.logoUrl ?? null;
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
      puzzleId: `${date}-draft_master`,
      date,
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
      return sql`EXISTS (SELECT 1 FROM player_stats m WHERE m.player_id = p.id AND m.team_name = ${c.club ?? ''} AND m.appearances > 0)`;
    case 'league':
      return sql`EXISTS (SELECT 1 FROM player_stats m WHERE m.player_id = p.id AND m.league_id = ${c.leagueId ?? -1} AND m.appearances > 0)`;
    case 'nationality':
      return sql`(p.nationality = ${c.nationality ?? ''})`;
    case 'nat_league':
      return sql`(p.nationality = ${c.nationality ?? ''} AND EXISTS (SELECT 1 FROM player_stats m WHERE m.player_id = p.id AND m.league_id = ${c.leagueId ?? -1} AND m.appearances > 0))`;
    case 'nat_club':
      return sql`(p.nationality = ${c.nationality ?? ''} AND EXISTS (SELECT 1 FROM player_stats m WHERE m.player_id = p.id AND m.team_name = ${c.club ?? ''} AND m.appearances > 0))`;
  }
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
    WHERE p.sub_position = ${position}
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
