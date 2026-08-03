/**
 * Back Yourself — pledge how many players you can name for a category (e.g. Spanish Liverpool),
 * then search/select under a 3-life limit. XP scales with the pledge (max 1500).
 *
 * Eligibility matches Draft XI (stats ∪ career, exact nationality). Countable pool = mvt ≥ 4.
 */
import { sql, type SQL } from 'drizzle-orm';
import { db } from '../db/index.js';
import { leagueLogoUrl, resolveHeadshot } from '../constants/footballMedia.js';
import { getPhotoOverrides } from './photoOverrides.js';
import { lookupTeamLogo } from './teamService.js';

export const BACK_YOURSELF_MAX_XP = 1500;
export const BACK_YOURSELF_MISTAKES_ALLOWED = 3;
const MIN_POOL = 8;
const MAX_POOL = 25;
const FAMOUS_TIER = 4;

const STANDALONE_NATIONS = [
  'France', 'Spain', 'England', 'Germany', 'Brazil', 'Italy',
  'Netherlands', 'Argentina', 'Portugal', 'Belgium',
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
};

function demonym(nation: string): string {
  return DEMONYM[nation] ?? nation;
}

export type BackYourselfCategoryType = 'nat_club' | 'club' | 'nationality' | 'nat_league';

export interface BackYourselfCategory {
  type: BackYourselfCategoryType;
  label: string;
  club?: string | null;
  leagueId?: number | null;
  leagueName?: string | null;
  nationality?: string | null;
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

/** Predicate: player row `p` satisfies the category (same SQL for count + validation). */
export function categorySatisfiesSql(category: BackYourselfCategory): SQL {
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
  }
}

export async function listMatchingPlayerIds(category: BackYourselfCategory): Promise<string[]> {
  const rows = (await db.execute(sql`
    SELECT p.id
    FROM players p
    WHERE p.market_value_tier >= ${FAMOUS_TIER}
      AND ${categorySatisfiesSql(category)}
    ORDER BY p.name
  `)) as unknown as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

export async function countMatchingPlayers(category: BackYourselfCategory): Promise<number> {
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
  category: BackYourselfCategory
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
  // Deduplicate client list length vs validated count — use validated.
  return { score: backYourselfXp(pledge, input.maxPool), won: true };
}

function categoryLabel(cat: Omit<BackYourselfCategory, 'label' | 'logoUrl'>): string {
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
      WHERE s.league_id IN (39, 140, 135, 78, 61) AND s.appearances > 0 AND s.team_name IS NOT NULL
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

  // Club-only
  for (const { club } of clubs) {
    const base = { type: 'club' as const, club, nationality: null, leagueId: null, leagueName: null };
    const ids = await listMatchingPlayerIds(base);
    if (ids.length >= MIN_POOL && ids.length <= MAX_POOL) {
      out.push({
        ...base,
        label: categoryLabel(base),
        maxPool: ids.length,
        validPlayerIds: ids,
      });
    }
  }

  // Nationality-only (standalone nations)
  for (const nationality of STANDALONE_NATIONS) {
    const base = { type: 'nationality' as const, nationality, club: null, leagueId: null, leagueName: null };
    const ids = await listMatchingPlayerIds(base);
    if (ids.length >= MIN_POOL && ids.length <= MAX_POOL) {
      out.push({
        ...base,
        label: categoryLabel(base),
        maxPool: ids.length,
        validPlayerIds: ids,
      });
    }
  }

  // Nat × league
  for (const league of BIG5) {
    for (const nationality of STANDALONE_NATIONS) {
      const base = {
        type: 'nat_league' as const,
        nationality,
        leagueId: league.id,
        leagueName: league.name,
        club: null,
      };
      const ids = await listMatchingPlayerIds(base);
      if (ids.length >= MIN_POOL && ids.length <= MAX_POOL) {
        out.push({
          ...base,
          label: categoryLabel(base),
          maxPool: ids.length,
          validPlayerIds: ids,
        });
      }
    }
  }

  // Nat × club (primary fun density) — sample from elite clubs × nations via discovery query
  if (clubs.length > 0) {
    const clubNames = clubs.map((c) => c.club);
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
        AND p.nationality IS NOT NULL AND p.nationality <> 'Unknown'
      GROUP BY p.nationality, club
      HAVING COUNT(DISTINCT p.id) BETWEEN ${MIN_POOL} AND ${MAX_POOL}
    `)) as unknown as Array<{ nationality: string; club: string; n: number }>;

    for (const r of rows) {
      const base = {
        type: 'nat_club' as const,
        nationality: r.nationality,
        club: r.club,
        leagueId: null,
        leagueName: null,
      };
      const ids = await listMatchingPlayerIds(base);
      if (ids.length >= MIN_POOL && ids.length <= MAX_POOL) {
        out.push({
          ...base,
          label: categoryLabel(base),
          maxPool: ids.length,
          validPlayerIds: ids,
        });
      }
    }
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

  // Prefer nat_club (~60%), then club / nat_league / nationality.
  const natClub = candidates.filter((c) => c.type === 'nat_club');
  const rest = candidates.filter((c) => c.type !== 'nat_club');
  const seed = hashString(`${date}:back_yourself`);
  const preferNat = seed % 10 < 6 && natClub.length > 0;
  const pool = preferNat ? natClub : rest.length > 0 ? rest : candidates;
  const chosen = seededShuffle(pool, seed)[0]!;

  const category = await decorateCategory({
    type: chosen.type,
    label: chosen.label,
    club: chosen.club ?? null,
    leagueId: chosen.leagueId ?? null,
    leagueName: chosen.leagueName ?? null,
    nationality: chosen.nationality ?? null,
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

/** Recalculate maxPool + valid ids for Ops after category edits. */
export async function refreshBackYourselfAnswer(
  category: BackYourselfCategory
): Promise<{ maxPool: number; validPlayerIds: string[]; category: BackYourselfCategory }> {
  const decorated = await decorateCategory(category);
  const validPlayerIds = await listMatchingPlayerIds(decorated);
  return {
    maxPool: validPlayerIds.length,
    validPlayerIds,
    category: { ...decorated, label: decorated.label || categoryLabel(decorated) },
  };
}
