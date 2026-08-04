/**
 * Back Yourself — pledge how many players you can name for a category, then search/select
 * under a 3-life limit. XP scales with the pledge (max 1500).
 *
 * Eligibility: Draft-style stats ∪ career for club chips; Bingo-style awards / tight stats
 * for the new types. Countable pool = market_value_tier ≥ 3. Categories are chosen so the
 * NATURAL pool lands in 10…30 — no artificial clipping.
 *
 * Auto-generated types (see scripts/analyze-back-yourself-pools.ts):
 *   - nat_club / nat_league / mid-tier nationality
 *   - award (Ballon d'Or, Golden Shoe, Golden Boy, PFA, …)
 *   - stat (100+ PL goals, 30+ CL goals, 10+ hat-tricks, …)
 * Club-only is Ops-manual only (pools are almost always >30 at tier ≥ 3).
 */
import { sql, type SQL } from 'drizzle-orm';
import { db } from '../db/index.js';
import { leagueLogoUrl, resolveHeadshot } from '../constants/footballMedia.js';
import { trustedIntlCapsSql } from './statMetrics.js';
import { getPhotoOverrides } from './photoOverrides.js';
import { lookupTeamLogo } from './teamService.js';

export const BACK_YOURSELF_MAX_XP = 1500;
export const BACK_YOURSELF_MISTAKES_ALLOWED = 3;
export const BACK_YOURSELF_MIN_POOL = 10;
export const BACK_YOURSELF_MAX_POOL = 30;
const MIN_POOL = BACK_YOURSELF_MIN_POOL;
const MAX_POOL = BACK_YOURSELF_MAX_POOL;
/** Align with Bingo's famous pool so club legends still count after value drops. */
const FAMOUS_TIER = 3;

/** Big football nations — used for nat_club / nat_league pairing. */
const BIG_NATIONS = [
  'France', 'Spain', 'England', 'Germany', 'Brazil', 'Italy',
  'Netherlands', 'Argentina', 'Portugal', 'Belgium',
] as const;

/**
 * Mid-tier nations whose standalone famous pool often lands in 10–30.
 * (Spain/England/etc. are far too large for nationality-only.)
 */
const MID_NATIONS = [
  'Poland', 'Senegal', 'Wales', 'Norway', 'Colombia', 'Sweden',
  'Morocco', 'Ghana', 'Austria', 'USA', 'Cameroon', 'Japan',
  'Denmark', 'Croatia', 'Uruguay', 'Nigeria', 'Serbia', 'Scotland',
  'Switzerland', 'Turkey', 'Mexico', 'Ivory Coast',
] as const;

const BIG5: Array<{ id: number; name: string }> = [
  { id: 39, name: 'Premier League' },
  { id: 140, name: 'La Liga' },
  { id: 135, name: 'Serie A' },
  { id: 78, name: 'Bundesliga' },
  { id: 61, name: 'Ligue 1' },
];

const DEMONYM: Record<string, string> = {
  Brazil: 'Brazilian', Argentina: 'Argentine', France: 'French', Spain: 'Spanish', Germany: 'German',
  England: 'English', Portugal: 'Portuguese', Netherlands: 'Dutch', Italy: 'Italian', Belgium: 'Belgian',
  Croatia: 'Croatian', Uruguay: 'Uruguayan', Colombia: 'Colombian', Senegal: 'Senegalese',
  Morocco: 'Moroccan', Nigeria: 'Nigerian', Poland: 'Polish', Denmark: 'Danish', Wales: 'Welsh',
  Scotland: 'Scottish', Mexico: 'Mexican', Japan: 'Japanese', 'South Korea': 'South Korean',
  Ghana: 'Ghanaian', Serbia: 'Serbian', Switzerland: 'Swiss', Turkey: 'Turkish', Chile: 'Chilean',
  Austria: 'Austrian', Sweden: 'Swedish', Norway: 'Norwegian', USA: 'American',
  Cameroon: 'Cameroonian', 'Ivory Coast': 'Ivorian',
};

function demonym(nation: string): string {
  return DEMONYM[nation] ?? nation;
}

/** Awards whose famous-pool winners usually land in 10–30. */
export const BACK_YOURSELF_AWARD_DEFS: Array<{
  award: string;
  label: string;
  placements: string[];
}> = [
  { award: "Ballon d'Or", label: "Ballon d'Or winners", placements: ['1st'] },
  { award: 'European Golden Shoe', label: 'European Golden Shoe winners', placements: ['winner'] },
  { award: 'Golden Boy', label: 'Golden Boy winners', placements: ['winner'] },
  { award: "PFA Players' Player of the Year", label: "PFA Players' Player winners", placements: ['winner'] },
  { award: 'Premier League Player of the Season', label: 'PL Player of the Season winners', placements: ['winner'] },
  { award: 'Serie A Footballer of the Year', label: 'Serie A Footballer of the Year winners', placements: ['winner'] },
  { award: 'African Footballer of the Year', label: 'African Footballer of the Year winners', placements: ['winner'] },
  { award: "UEFA Men's Player of the Year", label: "UEFA Men's Player of the Year winners", placements: ['winner'] },
];

/** Tight stat thresholds that usually land in 10–30 at tier ≥ 3. */
export const BACK_YOURSELF_STAT_DEFS: Array<{
  key: BackYourselfStatKey;
  min: number;
  label: string;
}> = [
  { key: 'pl_goals', min: 100, label: '100+ Premier League goals' },
  { key: 'cl_goals', min: 30, label: '30+ Champions League goals' },
  { key: 'cl_goals', min: 40, label: '40+ Champions League goals' },
  { key: 'transfer_eur_m', min: 100, label: '€100M+ transfer fee' },
  { key: 'career_hattricks', min: 10, label: '10+ career hat-tricks' },
  { key: 'ucl_red_cards', min: 2, label: '2+ Champions League red cards' },
  { key: 'season_reds', min: 3, label: '3+ reds in a single season' },
  { key: 'intl_caps', min: 150, label: '150+ international caps' },
];

export type BackYourselfStatKey =
  | 'pl_goals'
  | 'cl_goals'
  | 'transfer_eur_m'
  | 'career_hattricks'
  | 'ucl_red_cards'
  | 'season_reds'
  | 'intl_caps';

export type BackYourselfCategoryType =
  | 'nat_club'
  | 'club'
  | 'nationality'
  | 'nat_league'
  | 'award'
  | 'stat';

/** Fields needed for SQL matching — label/logo are display-only. */
export type BackYourselfCategorySpec = {
  type: BackYourselfCategoryType;
  club?: string | null;
  leagueId?: number | null;
  leagueName?: string | null;
  nationality?: string | null;
  /** player_awards.award name when type === 'award' */
  award?: string | null;
  /** Stat key when type === 'stat' */
  statKey?: BackYourselfStatKey | string | null;
  /** Minimum threshold when type === 'stat' */
  statMin?: number | null;
};

export interface BackYourselfCategory extends BackYourselfCategorySpec {
  label: string;
  logoUrl?: string | null;
}

export interface BackYourselfPuzzlePublic {
  modeId: 'back_yourself';
  puzzleId: string;
  date: string;
  category: BackYourselfCategory;
  maxPool: number;
  mistakesAllowed: number;
}

export interface BackYourselfPuzzleAnswer {
  modeId: 'back_yourself';
  validPlayerIds: string[];
}

export interface BackYourselfPlayerCard {
  id: string;
  name: string;
  club: string;
  nationality: string;
  position: string;
  headshotUrl?: string;
}

function hashString(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (h << 5) - h + input.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function seededShuffle<T>(arr: T[], seed: number): T[] {
  const out = [...arr];
  let state = BigInt(seed === 0 ? 1 : seed);
  for (let i = out.length - 1; i > 0; i -= 1) {
    state = (state * 6364136223846793005n + 1n) & ((1n << 64n) - 1n);
    const j = Number(state % BigInt(i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

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

function awardPlacements(award: string): string[] {
  return BACK_YOURSELF_AWARD_DEFS.find((d) => d.award === award)?.placements ?? ['winner', '1st'];
}

function awardSatisfiesSql(award: string): SQL {
  const placements = awardPlacements(award);
  return sql`EXISTS (
    SELECT 1 FROM player_awards a
    WHERE a.player_id = p.id
      AND a.award = ${award}
      AND a.placement IN (${sql.join(placements.map((p) => sql`${p}`), sql`, `)})
  )`;
}

function statSatisfiesSql(statKey: string, statMin: number): SQL {
  switch (statKey) {
    case 'pl_goals':
      return sql`COALESCE((
        SELECT SUM(m.goals)::int FROM player_stats m
        WHERE m.player_id = p.id AND m.league_id = 39
      ), 0) >= ${statMin}`;
    case 'cl_goals':
      return sql`COALESCE((
        SELECT SUM(m.goals)::int FROM player_stats m
        WHERE m.player_id = p.id AND m.league_id = 2
      ), 0) >= ${statMin}`;
    case 'transfer_eur_m':
      return sql`EXISTS (
        SELECT 1 FROM player_transfers t
        WHERE t.player_id = p.id AND t.fee_eur_m >= ${statMin}
      )`;
    case 'career_hattricks':
      return sql`EXISTS (
        SELECT 1 FROM player_extra_stats e
        WHERE e.player_id = p.id AND e.career_hattricks >= ${statMin}
      )`;
    case 'ucl_red_cards':
      return sql`EXISTS (
        SELECT 1 FROM player_extra_stats e
        WHERE e.player_id = p.id AND e.ucl_red_cards >= ${statMin}
      )`;
    case 'season_reds':
      return sql`EXISTS (
        SELECT 1 FROM player_stats m
        WHERE m.player_id = p.id AND m.red_cards >= ${statMin}
      )`;
    case 'intl_caps':
      return sql`EXISTS (
        SELECT 1 FROM player_extra_stats e
        WHERE e.player_id = p.id AND ${trustedIntlCapsSql('e')} >= ${statMin}
      )`;
    default:
      return sql`FALSE`;
  }
}

/** Predicate: player row `p` satisfies the category (same SQL for count + validation). */
export function categorySatisfiesSql(category: BackYourselfCategorySpec): SQL {
  switch (category.type) {
    case 'club':
      return playedForClubSql(category.club ?? '');
    case 'nationality':
      return sql`(p.nationality = ${category.nationality ?? ''})`;
    case 'nat_league':
      return sql`(
        p.nationality = ${category.nationality ?? ''}
        AND EXISTS (
          SELECT 1 FROM player_stats m
          WHERE m.player_id = p.id
            AND m.league_id = ${category.leagueId ?? -1}
            AND m.appearances > 0
        )
      )`;
    case 'nat_club':
      return sql`(
        p.nationality = ${category.nationality ?? ''}
        AND ${playedForClubSql(category.club ?? '')}
      )`;
    case 'award':
      return awardSatisfiesSql(category.award ?? '');
    case 'stat':
      return statSatisfiesSql(category.statKey ?? '', Math.max(0, category.statMin ?? 0));
  }
}

/** Famous players matching the category (past ∪ present). Full list — never clipped. */
export async function listMatchingPlayerIds(category: BackYourselfCategorySpec): Promise<string[]> {
  const rows = (await db.execute(sql`
    SELECT p.id
    FROM players p
    WHERE p.market_value_tier >= ${FAMOUS_TIER}
      AND ${categorySatisfiesSql(category)}
    ORDER BY p.name
  `)) as unknown as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

function inPoolBand(n: number): boolean {
  return n >= MIN_POOL && n <= MAX_POOL;
}

export async function countMatchingPlayers(category: BackYourselfCategorySpec): Promise<number> {
  const rows = (await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM players p
    WHERE p.market_value_tier >= ${FAMOUS_TIER}
      AND ${categorySatisfiesSql(category)}
  `)) as unknown as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

export async function playerMatchesBackYourselfCategory(
  playerId: string,
  category: BackYourselfCategorySpec
): Promise<boolean> {
  const rows = (await db.execute(sql`
    SELECT 1 AS ok
    FROM players p
    WHERE p.id = ${playerId}::uuid
      AND p.market_value_tier >= ${FAMOUS_TIER}
      AND ${categorySatisfiesSql(category)}
    LIMIT 1
  `)) as unknown as Array<{ ok: number }>;
  return rows.length > 0;
}

/** XP for a successful pledge. Loss / shortfall → 0 (caller). */
export function backYourselfXp(pledge: number, maxPool: number): number {
  if (maxPool <= 0 || pledge <= 0) return 0;
  const ratio = Math.min(1, Math.max(0, pledge / maxPool));
  return Math.max(0, Math.min(BACK_YOURSELF_MAX_XP, Math.round(BACK_YOURSELF_MAX_XP * ratio ** 1.41)));
}

export function scoreBackYourself(input: {
  pledge: number;
  namedPlayerIds: string[];
  mistakes: number;
  maxPool: number;
  mistakesAllowed?: number;
  validNamedCount: number;
}): { score: number; won: boolean } {
  const mistakesAllowed = input.mistakesAllowed ?? BACK_YOURSELF_MISTAKES_ALLOWED;
  const pledge = Math.max(0, Math.floor(input.pledge));
  const mistakes = Math.max(0, Math.floor(input.mistakes));
  if (mistakes >= mistakesAllowed) return { score: 0, won: false };
  if (pledge < 1 || pledge > input.maxPool) return { score: 0, won: false };
  if (input.validNamedCount < pledge) return { score: 0, won: false };
  return { score: backYourselfXp(pledge, input.maxPool), won: true };
}

export function categoryLabel(cat: BackYourselfCategorySpec & { label?: string | null }): string {
  if (cat.type === 'award') {
    return BACK_YOURSELF_AWARD_DEFS.find((d) => d.award === cat.award)?.label
      ?? (cat.award ? `${cat.award} winners` : 'Award winners');
  }
  if (cat.type === 'stat') {
    const hit = BACK_YOURSELF_STAT_DEFS.find(
      (d) => d.key === cat.statKey && d.min === cat.statMin
    );
    if (hit) return hit.label;
    if (cat.statKey && cat.statMin != null) return `${cat.statMin}+ ${cat.statKey.replace(/_/g, ' ')}`;
    return 'Stat milestone';
  }
  switch (cat.type) {
    case 'club':
      return `${cat.club ?? '?'} players`;
    case 'nationality':
      return `${cat.nationality ?? '?'} internationals`;
    case 'nat_league':
      return `${demonym(cat.nationality ?? '?')} ${cat.leagueName ?? 'league'} players`;
    case 'nat_club':
      return `${demonym(cat.nationality ?? '?')} ${cat.club ?? '?'} players`;
  }
}

async function eliteClubs(): Promise<Array<{ club: string; leagueId: number }>> {
  const rows = (await db.execute(sql`
    SELECT club, league_id FROM (
      SELECT s.team_name AS club, s.league_id,
             COUNT(DISTINCT p.id) FILTER (WHERE p.market_value_tier >= ${FAMOUS_TIER}) AS famous
      FROM player_stats s JOIN players p ON p.id = s.player_id
      WHERE s.league_id IN (39, 140, 135, 78, 61)
        AND s.appearances > 0 AND s.team_name IS NOT NULL
        AND s.team_name NOT ILIKE '%U18%' AND s.team_name NOT ILIKE '%U19%'
        AND s.team_name NOT ILIKE '%U21%' AND s.team_name NOT ILIKE '%U23%'
        AND s.team_name NOT ILIKE '%Youth%'
      GROUP BY s.team_name, s.league_id
    ) t
    WHERE (league_id = 39 AND famous >= 8)
       OR (league_id <> 39 AND famous >= 40)
  `)) as unknown as Array<{ club: string; league_id: number }>;
  return rows.map((r) => ({ club: r.club, leagueId: r.league_id }));
}

type Candidate = BackYourselfCategory & { maxPool: number; validPlayerIds: string[] };

async function buildCandidates(): Promise<Candidate[]> {
  const clubs = await eliteClubs();
  const out: Candidate[] = [];

  const pushCandidate = async (base: BackYourselfCategorySpec, labelOverride?: string) => {
    const ids = await listMatchingPlayerIds(base);
    if (!inPoolBand(ids.length)) return;
    out.push({
      ...base,
      label: labelOverride ?? categoryLabel(base),
      maxPool: ids.length,
      validPlayerIds: ids,
    });
  };

  // Club-only is almost never 10–30 at tier ≥ 3. Skip auto-gen (Ops can set manually).

  for (const nationality of MID_NATIONS) {
    await pushCandidate({
      type: 'nationality',
      nationality,
      club: null,
      leagueId: null,
      leagueName: null,
    });
  }

  const leagueNations = [...new Set([...BIG_NATIONS, ...MID_NATIONS])];
  for (const league of BIG5) {
    for (const nationality of leagueNations) {
      await pushCandidate({
        type: 'nat_league',
        nationality,
        leagueId: league.id,
        leagueName: league.name,
        club: null,
      });
    }
  }

  if (clubs.length > 0) {
    const clubNames = clubs.map((c) => c.club);
    const natClubNations = [...new Set([...BIG_NATIONS, ...MID_NATIONS])];
    const rows = (await db.execute(sql`
      SELECT p.nationality, club, COUNT(DISTINCT p.id)::int AS n
      FROM players p
      JOIN (
        SELECT player_id, team_name AS club FROM player_stats
        WHERE appearances > 0 AND team_name IS NOT NULL
          AND team_name IN (${sql.join(clubNames.map((c) => sql`${c}`), sql`, `)})
        UNION
        SELECT player_id, team_name FROM player_career
        WHERE team_id > 0 AND team_name IS NOT NULL
          AND team_name IN (${sql.join(clubNames.map((c) => sql`${c}`), sql`, `)})
      ) clubs ON clubs.player_id = p.id
      WHERE p.market_value_tier >= ${FAMOUS_TIER}
        AND p.nationality IN (${sql.join(natClubNations.map((n) => sql`${n}`), sql`, `)})
      GROUP BY p.nationality, club
      HAVING COUNT(DISTINCT p.id) BETWEEN ${MIN_POOL} AND ${MAX_POOL}
    `)) as unknown as Array<{ nationality: string; club: string; n: number }>;

    for (const r of rows) {
      await pushCandidate({
        type: 'nat_club',
        nationality: r.nationality,
        club: r.club,
        leagueId: null,
        leagueName: null,
      });
    }
  }

  for (const def of BACK_YOURSELF_AWARD_DEFS) {
    await pushCandidate(
      {
        type: 'award',
        award: def.award,
        club: null,
        leagueId: null,
        leagueName: null,
        nationality: null,
      },
      def.label
    );
  }

  for (const def of BACK_YOURSELF_STAT_DEFS) {
    await pushCandidate(
      {
        type: 'stat',
        statKey: def.key,
        statMin: def.min,
        club: null,
        leagueId: null,
        leagueName: null,
        nationality: null,
      },
      def.label
    );
  }

  return out;
}

let candidateCache: { at: number; items: Candidate[] } | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000;

async function getCandidates(): Promise<Candidate[]> {
  if (candidateCache && Date.now() - candidateCache.at < CACHE_TTL_MS) {
    return candidateCache.items;
  }
  const items = await buildCandidates();
  candidateCache = { at: Date.now(), items };
  return items;
}

async function decorateCategory(cat: BackYourselfCategory): Promise<BackYourselfCategory> {
  if ((cat.type === 'club' || cat.type === 'nat_club') && cat.club) {
    const logo = await lookupTeamLogo(cat.club, cat.leagueName ?? '');
    return { ...cat, logoUrl: logo?.logoUrl ?? null };
  }
  if (cat.type === 'nat_league' && cat.leagueId != null) {
    return { ...cat, logoUrl: leagueLogoUrl(cat.leagueId) };
  }
  return { ...cat, logoUrl: cat.logoUrl ?? null };
}

export async function generateBackYourselfPuzzle(
  date: string
): Promise<{ puzzle: BackYourselfPuzzlePublic; answer: BackYourselfPuzzleAnswer } | null> {
  const candidates = await getCandidates();
  if (candidates.length === 0) return null;

  // Weight: nat_club 40%, nat_league 20%, award 20%, stat 15%, nationality 5%.
  const byType = {
    nat_club: candidates.filter((c) => c.type === 'nat_club'),
    nat_league: candidates.filter((c) => c.type === 'nat_league'),
    award: candidates.filter((c) => c.type === 'award'),
    stat: candidates.filter((c) => c.type === 'stat'),
    nationality: candidates.filter((c) => c.type === 'nationality'),
  };
  const seed = hashString(`${date}:back_yourself`);
  const roll = seed % 100;
  let pool: Candidate[];
  if (roll < 40 && byType.nat_club.length > 0) pool = byType.nat_club;
  else if (roll < 60 && byType.nat_league.length > 0) pool = byType.nat_league;
  else if (roll < 80 && byType.award.length > 0) pool = byType.award;
  else if (roll < 95 && byType.stat.length > 0) pool = byType.stat;
  else if (byType.nationality.length > 0) pool = byType.nationality;
  else pool = candidates;
  if (pool.length === 0) pool = candidates;
  const chosen = seededShuffle(pool, seed)[0]!;

  const category = await decorateCategory({
    type: chosen.type,
    label: chosen.label,
    club: chosen.club ?? null,
    leagueId: chosen.leagueId ?? null,
    leagueName: chosen.leagueName ?? null,
    nationality: chosen.nationality ?? null,
    award: chosen.award ?? null,
    statKey: chosen.statKey ?? null,
    statMin: chosen.statMin ?? null,
  });

  const puzzle: BackYourselfPuzzlePublic = {
    modeId: 'back_yourself',
    puzzleId: `${date}-back_yourself`,
    date,
    category,
    maxPool: chosen.maxPool,
    mistakesAllowed: BACK_YOURSELF_MISTAKES_ALLOWED,
  };
  const answer: BackYourselfPuzzleAnswer = {
    modeId: 'back_yourself',
    validPlayerIds: chosen.validPlayerIds,
  };
  return { puzzle, answer };
}

export async function resolveBackYourselfPlayerCard(
  playerId: string
): Promise<BackYourselfPlayerCard | null> {
  const rows = (await db.execute(sql`
    SELECT id, name, current_club, nationality, position, api_football_id
    FROM players WHERE id = ${playerId}::uuid LIMIT 1
  `)) as unknown as Array<{
    id: string;
    name: string;
    current_club: string;
    nationality: string;
    position: string;
    api_football_id: number | null;
  }>;
  const row = rows[0];
  if (!row) return null;
  const overrides = await getPhotoOverrides();
  return {
    id: row.id,
    name: row.name,
    club: row.current_club ?? '',
    nationality: row.nationality ?? '',
    position: row.position ?? '',
    headshotUrl: resolveHeadshot(overrides.get(row.id), row.api_football_id) ?? undefined,
  };
}

/** Recalculate maxPool + valid ids for Ops after category edits (full pool, no clip). */
export async function refreshBackYourselfAnswer(
  category: BackYourselfCategory
): Promise<{ maxPool: number; validPlayerIds: string[]; category: BackYourselfCategory }> {
  const decorated = await decorateCategory({
    ...category,
    label: category.label || categoryLabel(category),
  });
  const validPlayerIds = await listMatchingPlayerIds(decorated);
  return {
    maxPool: validPlayerIds.length,
    validPlayerIds,
    category: { ...decorated, label: decorated.label || categoryLabel(decorated) },
  };
}
