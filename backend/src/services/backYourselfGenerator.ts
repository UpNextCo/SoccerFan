/**
 * Back Yourself — pledge how many players you can name for a category, then search/select
 * under a 3-life limit. XP scales with the pledge up to an XP-cap threshold (default 40),
 * while the slider still runs to the full famous pool (maxPool, up to ~100).
 *
 * Eligibility: Draft-style stats ∪ career for club chips; Bingo-style awards / stats /
 * managers / WC squads / finals / teammate intersections. Any matching player counts
 * when named, up to maxPool. That number is the suggested perfect (famous tier ≥ 3
 * size): slider max and naming cap. Ops can override it.
 */
import { sql, type SQL } from 'drizzle-orm';
import { db } from '../db/index.js';
import { INTERNATIONAL_COMPETITION_LEAGUE_IDS, leagueLogoUrl, resolveHeadshot } from '../constants/footballMedia.js';
import { trustedIntlCapsSql } from './statMetrics.js';
import { getPhotoOverrides } from './photoOverrides.js';
import { lookupTeamLogo } from './teamService.js';
import { playersUnderManager } from './managerRules.js';
import { wonTournamentExistsSql } from './tournamentWinners.js';

export const BACK_YOURSELF_MAX_XP = 1000;
export const BACK_YOURSELF_MISTAKES_ALLOWED = 3;
export const BACK_YOURSELF_MIN_POOL = 10;
export const BACK_YOURSELF_MAX_POOL = 120;
/** Pledge at which XP reaches the mode ceiling (even if maxPool is larger). */
export const BACK_YOURSELF_XP_CAP_PLEDGE = 40;
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
 * Mid-tier nations whose standalone famous pool often lands in band.
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

/** Managers whose famous-under-them pool usually lands in 10–100. */
const CURATED_MANAGERS: Array<{ manager: string; managerNorm: string }> = [
  { manager: 'Jürgen Klopp', managerNorm: 'jurgen klopp' },
  { manager: 'Zinedine Zidane', managerNorm: 'zinedine zidane' },
  { manager: 'Diego Simeone', managerNorm: 'diego simeone' },
  { manager: 'Sir Alex Ferguson', managerNorm: 'sir alex ferguson' },
  { manager: 'Arsène Wenger', managerNorm: 'arsene wenger' },
  { manager: 'Luis Enrique', managerNorm: 'luis enrique' },
  { manager: 'Louis van Gaal', managerNorm: 'louis van gaal' },
  { manager: 'Fabio Capello', managerNorm: 'fabio capello' },
  { manager: 'Marcello Lippi', managerNorm: 'marcello lippi' },
  { manager: 'Frank Rijkaard', managerNorm: 'frank rijkaard' },
  { manager: 'Hansi Flick', managerNorm: 'hansi flick' },
  { manager: 'Mikel Arteta', managerNorm: 'mikel arteta' },
  { manager: 'Maurizio Sarri', managerNorm: 'maurizio sarri' },
  { manager: 'Julian Nagelsmann', managerNorm: 'julian nagelsmann' },
  { manager: 'Erik ten Hag', managerNorm: 'erik ten hag' },
  { manager: 'Arne Slot', managerNorm: 'arne slot' },
  { manager: 'Xabi Alonso', managerNorm: 'xabi alonso' },
  { manager: 'Didier Deschamps', managerNorm: 'didier deschamps' },
  { manager: 'Vicente del Bosque', managerNorm: 'vicente del bosque' },
  { manager: 'Claudio Ranieri', managerNorm: 'claudio ranieri' },
  { manager: 'Guus Hiddink', managerNorm: 'guus hiddink' },
  { manager: 'Luiz Felipe Scolari', managerNorm: 'luiz felipe scolari' },
];

/** Curated “played with A and B” pairs (exact player names in DB). */
const CURATED_TEAMMATE_PAIRS: Array<{ a: string; b: string }> = [
  { a: 'Lionel Messi', b: 'Luis Suárez' },
  { a: 'Steven Gerrard', b: 'Fernando Torres' },
  { a: 'Cristiano Ronaldo', b: 'Karim Benzema' },
  { a: 'Cristiano Ronaldo', b: 'Sergio Ramos' },
  { a: 'Andrés Iniesta', b: 'Xavi' },
  { a: 'Gerard Piqué', b: 'Lionel Messi' },
  { a: 'Antoine Griezmann', b: 'Luis Suárez' },
];

/** Finals chips that usually land in 10–100 famous. */
const FINAL_DEFS: Array<{
  competition: string;
  mode: BackYourselfFinalMode;
  label: string;
}> = [
  { competition: 'Champions League', mode: 'scored', label: 'Scored in a Champions League final' },
  { competition: 'Europa League', mode: 'scored', label: 'Scored in a Europa League final' },
  { competition: 'Euro', mode: 'won', label: 'Won a European Championship' },
  { competition: 'World Cup', mode: 'won', label: 'World Cup winners since 1994' },
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

/** Awards whose famous-pool winners usually land in band (or under XP-cap model). */
export const BACK_YOURSELF_AWARD_DEFS: Array<{
  award: string;
  label: string;
  placements: string[];
}> = [
  { award: "Ballon d'Or", label: "Ballon d'Or winners", placements: ['1st'] },
  { award: "Ballon d'Or", label: "Ballon d'Or podium", placements: ['1st', '2nd', '3rd'] },
  { award: 'European Golden Shoe', label: 'European Golden Shoe winners', placements: ['winner'] },
  { award: 'Golden Boy', label: 'Golden Boy winners', placements: ['winner'] },
  { award: "PFA Players' Player of the Year", label: "PFA Players' Player winners", placements: ['winner'] },
  { award: 'Premier League Player of the Season', label: 'PL Player of the Season winners', placements: ['winner'] },
  { award: 'Serie A Footballer of the Year', label: 'Serie A Footballer of the Year winners', placements: ['winner'] },
  { award: 'African Footballer of the Year', label: 'African Footballer of the Year winners', placements: ['winner'] },
  { award: "UEFA Men's Player of the Year", label: "UEFA Men's Player of the Year winners", placements: ['winner'] },
];

/** Tight stat thresholds that usually land in band at tier ≥ 3. */
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

export type BackYourselfFinalMode = 'scored' | 'won' | 'played';

export type BackYourselfCategoryType =
  | 'nat_club'
  | 'club'
  | 'nationality'
  | 'nat_league'
  | 'award'
  | 'stat'
  | 'managed_by'
  | 'wc_squad'
  | 'club_combo'
  | 'played_with_both'
  | 'final';

/** Fields needed for SQL / set matching — label/logo are display-only. */
export type BackYourselfCategorySpec = {
  type: BackYourselfCategoryType;
  club?: string | null;
  leagueId?: number | null;
  leagueName?: string | null;
  nationality?: string | null;
  /** player_awards.award name when type === 'award' */
  award?: string | null;
  /** Override placements for award matching (e.g. Ballon podium). */
  awardPlacements?: string[] | null;
  /** Stat key when type === 'stat' */
  statKey?: BackYourselfStatKey | string | null;
  /** Minimum threshold when type === 'stat' */
  statMin?: number | null;
  manager?: string | null;
  managerNorm?: string | null;
  wcYear?: number | null;
  wcCountry?: string | null;
  clubA?: string | null;
  clubB?: string | null;
  anchorAId?: string | null;
  anchorBId?: string | null;
  anchorAName?: string | null;
  anchorBName?: string | null;
  finalCompetition?: string | null;
  finalMode?: BackYourselfFinalMode | string | null;
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
  /** Suggested perfect: pledge slider max and hard naming cap. Ops can override. */
  maxPool: number;
  /** Pledge at which XP hits 1000. Always ≤ maxPool. */
  xpCap: number;
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

export function backYourselfXpCap(maxPool: number): number {
  return Math.max(1, Math.min(BACK_YOURSELF_XP_CAP_PLEDGE, Math.floor(maxPool)));
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

function teammatesWithSql(anchorId: string): SQL {
  const intlLeagues = sql.join(
    [...INTERNATIONAL_COMPETITION_LEAGUE_IDS].sort((a, b) => a - b).map((id) => sql`${id}`),
    sql`, `
  );
  return sql`EXISTS (
    SELECT 1 FROM player_stats sp JOIN player_stats sa
      ON sp.team_name = sa.team_name AND sp.season = sa.season
    WHERE sp.player_id = p.id AND sa.player_id = ${anchorId}::uuid
      AND sp.appearances > 0 AND sa.appearances > 0
      AND sp.league_id NOT IN (${intlLeagues}) AND sa.league_id NOT IN (${intlLeagues})
      AND NOT EXISTS (
        SELECT 1 FROM players n WHERE n.nationality <> '' AND n.nationality = sp.team_name
      )
  )`;
}

function finalSatisfiesSql(competition: string, mode: string): SQL {
  if (
    mode === 'won' &&
    (competition === 'World Cup' || competition === 'Euro' || competition === 'Champions League')
  ) {
    // Squad / campaign winners — not only players who appeared in the final.
    return wonTournamentExistsSql(competition, 'p.id');
  }
  const modeCond =
    mode === 'scored' ? sql`AND f.goals > 0`
      : mode === 'won' ? sql`AND f.won`
        : sql``;
  return sql`EXISTS (
    SELECT 1 FROM final_appearances f
    WHERE f.player_id = p.id
      AND f.competition = ${competition}
      ${modeCond}
  )`;
}

function awardPlacementsFor(award: string, override?: string[] | null): string[] {
  if (override && override.length > 0) return override;
  return BACK_YOURSELF_AWARD_DEFS.find((d) => d.award === award)?.placements ?? ['winner', '1st'];
}

function awardSatisfiesSql(award: string, placementsOverride?: string[] | null): SQL {
  const placements = awardPlacementsFor(award, placementsOverride);
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

/** Predicate: player row `p` satisfies the category (SQL types only — managed_by is set-based). */
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
      return awardSatisfiesSql(category.award ?? '', category.awardPlacements);
    case 'stat':
      return statSatisfiesSql(category.statKey ?? '', Math.max(0, category.statMin ?? 0));
    case 'wc_squad':
      return sql`EXISTS (
        SELECT 1 FROM wc_squads s
        WHERE s.player_id = p.id
          AND s.year = ${category.wcYear ?? -1}
          AND s.country = ${category.wcCountry ?? ''}
      )`;
    case 'club_combo':
      return sql`(
        ${playedForClubSql(category.clubA ?? '')}
        AND ${playedForClubSql(category.clubB ?? '')}
      )`;
    case 'played_with_both':
      return sql`(
        p.id <> ${category.anchorAId ?? '00000000-0000-0000-0000-000000000000'}::uuid
        AND p.id <> ${category.anchorBId ?? '00000000-0000-0000-0000-000000000000'}::uuid
        AND ${teammatesWithSql(category.anchorAId ?? '00000000-0000-0000-0000-000000000000')}
        AND ${teammatesWithSql(category.anchorBId ?? '00000000-0000-0000-0000-000000000000')}
      )`;
    case 'final':
      return finalSatisfiesSql(category.finalCompetition ?? '', category.finalMode ?? 'played');
    case 'managed_by':
      // Resolved via playersUnderManager — SQL predicate unused.
      return sql`FALSE`;
  }
}

async function filterFamousSorted(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  // Chunk large IN lists.
  const out: string[] = [];
  const chunkSize = 400;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const rows = (await db.execute(sql`
      SELECT p.id
      FROM players p
      WHERE p.market_value_tier >= ${FAMOUS_TIER}
        AND p.id IN (${sql.join(chunk.map((id) => sql`${id}::uuid`), sql`, `)})
      ORDER BY p.name
    `)) as unknown as Array<{ id: string }>;
    for (const r of rows) out.push(r.id);
  }
  out.sort();
  return out;
}

/** Famous players matching the category — used for the suggested perfect / pledge max. */
export async function listMatchingPlayerIds(category: BackYourselfCategorySpec): Promise<string[]> {
  if (category.type === 'managed_by') {
    const set = await playersUnderManager(category.managerNorm ?? '');
    return filterFamousSorted([...set]);
  }
  const rows = (await db.execute(sql`
    SELECT p.id
    FROM players p
    WHERE p.market_value_tier >= ${FAMOUS_TIER}
      AND ${categorySatisfiesSql(category)}
    ORDER BY p.name
  `)) as unknown as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

/** Every stored player who satisfies the category, including low-fame names. */
export async function countAllMatchingPlayers(category: BackYourselfCategorySpec): Promise<number> {
  if (category.type === 'managed_by') {
    return (await playersUnderManager(category.managerNorm ?? '')).size;
  }
  const rows = (await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM players p
    WHERE ${categorySatisfiesSql(category)}
  `)) as unknown as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

function inPoolBand(n: number): boolean {
  return n >= MIN_POOL && n <= MAX_POOL;
}

export async function countMatchingPlayers(category: BackYourselfCategorySpec): Promise<number> {
  if (category.type === 'managed_by') {
    return (await listMatchingPlayerIds(category)).length;
  }
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
  if (category.type === 'managed_by') {
    const set = await playersUnderManager(category.managerNorm ?? '');
    return set.has(playerId);
  }
  const rows = (await db.execute(sql`
    SELECT 1 AS ok
    FROM players p
    WHERE p.id = ${playerId}::uuid
      AND ${categorySatisfiesSql(category)}
    LIMIT 1
  `)) as unknown as Array<{ ok: number }>;
  return rows.length > 0;
}

export async function countNamedMatchingCategory(
  playerIds: string[],
  category: BackYourselfCategorySpec
): Promise<number> {
  const unique = [...new Set(playerIds.filter(Boolean))];
  if (unique.length === 0) return 0;
  if (category.type === 'managed_by') {
    const set = await playersUnderManager(category.managerNorm ?? '');
    return unique.filter((id) => set.has(id)).length;
  }
  const rows = (await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM players p
    WHERE p.id IN (${sql.join(unique.map((id) => sql`${id}::uuid`), sql`, `)})
      AND ${categorySatisfiesSql(category)}
  `)) as unknown as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

/** XP for a successful pledge. Uses xpCap (not full maxPool) as the 1000 denominator. */
export function backYourselfXp(pledge: number, xpCap: number): number {
  if (xpCap <= 0 || pledge <= 0) return 0;
  const effective = Math.min(pledge, xpCap);
  const ratio = Math.min(1, Math.max(0, effective / xpCap));
  return Math.max(0, Math.min(BACK_YOURSELF_MAX_XP, Math.round(BACK_YOURSELF_MAX_XP * ratio ** 1.41)));
}

export function scoreBackYourself(input: {
  pledge: number;
  namedPlayerIds: string[];
  mistakes: number;
  maxPool: number;
  xpCap?: number;
  mistakesAllowed?: number;
  validNamedCount: number;
}): { score: number; won: boolean } {
  const mistakesAllowed = input.mistakesAllowed ?? BACK_YOURSELF_MISTAKES_ALLOWED;
  const pledge = Math.max(0, Math.floor(input.pledge));
  const mistakes = Math.max(0, Math.floor(input.mistakes));
  const xpCap = input.xpCap ?? backYourselfXpCap(input.maxPool);
  if (mistakes >= mistakesAllowed) return { score: 0, won: false };
  if (pledge < 1 || pledge > input.maxPool) return { score: 0, won: false };
  if (input.validNamedCount < pledge) return { score: 0, won: false };
  return { score: backYourselfXp(pledge, xpCap), won: true };
}

export function categoryLabel(cat: BackYourselfCategorySpec & { label?: string | null }): string {
  if (cat.type === 'award') {
    if (cat.awardPlacements && cat.awardPlacements.length > 1) {
      const hit = BACK_YOURSELF_AWARD_DEFS.find(
        (d) =>
          d.award === cat.award
          && d.placements.length === cat.awardPlacements!.length
          && d.placements.every((p, i) => p === cat.awardPlacements![i])
      );
      if (hit) return hit.label;
    }
    return BACK_YOURSELF_AWARD_DEFS.find(
      (d) => d.award === cat.award && d.placements.length === 1
    )?.label ?? (cat.award ? `${cat.award} winners` : 'Award winners');
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
    case 'managed_by':
      return `Managed by ${cat.manager ?? '?'}`;
    case 'wc_squad':
      return `${cat.wcCountry ?? '?'} World Cup ${cat.wcYear ?? '?'}`;
    case 'club_combo':
      return `Played for ${cat.clubA ?? '?'} and ${cat.clubB ?? '?'}`;
    case 'played_with_both':
      return `Played with ${cat.anchorAName ?? '?'} and ${cat.anchorBName ?? '?'}`;
    case 'final': {
      const hit = FINAL_DEFS.find(
        (d) => d.competition === cat.finalCompetition && d.mode === cat.finalMode
      );
      return hit?.label ?? `${cat.finalCompetition ?? 'Final'} (${cat.finalMode ?? 'played'})`;
    }
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

async function resolvePlayerIdByName(name: string): Promise<{ id: string; name: string } | null> {
  const rows = (await db.execute(sql`
    SELECT id, name FROM players
    WHERE name = ${name} AND market_value_tier >= ${FAMOUS_TIER}
    ORDER BY market_value_tier DESC
    LIMIT 1
  `)) as unknown as Array<{ id: string; name: string }>;
  return rows[0] ?? null;
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

    // Club combos — sample pairs among elite clubs with in-band famous intersection.
    const comboRows = (await db.execute(sql`
      WITH club_players AS (
        SELECT DISTINCT player_id, team_name AS club FROM (
          SELECT player_id, team_name FROM player_stats
          WHERE appearances > 0 AND team_name IS NOT NULL
            AND team_name IN (${sql.join(clubNames.map((c) => sql`${c}`), sql`, `)})
          UNION
          SELECT player_id, team_name FROM player_career
          WHERE team_id > 0 AND team_name IS NOT NULL
            AND team_name IN (${sql.join(clubNames.map((c) => sql`${c}`), sql`, `)})
        ) u
      )
      SELECT a.club AS club_a, b.club AS club_b, COUNT(DISTINCT p.id)::int AS n
      FROM club_players a
      JOIN club_players b ON a.player_id = b.player_id AND a.club < b.club
      JOIN players p ON p.id = a.player_id AND p.market_value_tier >= ${FAMOUS_TIER}
      GROUP BY a.club, b.club
      HAVING COUNT(DISTINCT p.id) BETWEEN ${MIN_POOL} AND ${MAX_POOL}
    `)) as unknown as Array<{ club_a: string; club_b: string; n: number }>;

    for (const r of comboRows) {
      await pushCandidate({
        type: 'club_combo',
        clubA: r.club_a,
        clubB: r.club_b,
        club: null,
        leagueId: null,
        leagueName: null,
        nationality: null,
      });
    }
  }

  for (const def of BACK_YOURSELF_AWARD_DEFS) {
    await pushCandidate(
      {
        type: 'award',
        award: def.award,
        awardPlacements: def.placements,
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

  for (const m of CURATED_MANAGERS) {
    await pushCandidate({
      type: 'managed_by',
      manager: m.manager,
      managerNorm: m.managerNorm,
      club: null,
      leagueId: null,
      leagueName: null,
      nationality: null,
    });
  }

  const squadRows = (await db.execute(sql`
    SELECT s.year, s.country, COUNT(DISTINCT p.id)::int AS n
    FROM wc_squads s
    JOIN players p ON p.id = s.player_id
    WHERE p.market_value_tier >= ${FAMOUS_TIER}
      AND s.year BETWEEN 2006 AND 2022
      AND s.country IN (${sql.join(
        [...BIG_NATIONS, 'Croatia', 'Uruguay', 'Mexico', 'Japan', 'USA', 'Senegal', 'Morocco', 'Denmark', 'Switzerland', 'Sweden', 'Poland', 'Serbia', 'Nigeria', 'Cameroon', 'Ghana', 'South Korea', 'Chile', 'Colombia'].map(
          (c) => sql`${c}`
        ),
        sql`, `
      )})
    GROUP BY s.year, s.country
    HAVING COUNT(DISTINCT p.id) BETWEEN ${MIN_POOL} AND ${MAX_POOL}
  `)) as unknown as Array<{ year: number; country: string; n: number }>;

  for (const r of squadRows) {
    await pushCandidate({
      type: 'wc_squad',
      wcYear: r.year,
      wcCountry: r.country,
      club: null,
      leagueId: null,
      leagueName: null,
      nationality: r.country,
    });
  }

  for (const pair of CURATED_TEAMMATE_PAIRS) {
    const a = await resolvePlayerIdByName(pair.a);
    const b = await resolvePlayerIdByName(pair.b);
    if (!a || !b) continue;
    await pushCandidate({
      type: 'played_with_both',
      anchorAId: a.id,
      anchorBId: b.id,
      anchorAName: a.name,
      anchorBName: b.name,
      club: null,
      leagueId: null,
      leagueName: null,
      nationality: null,
    });
  }

  for (const def of FINAL_DEFS) {
    await pushCandidate(
      {
        type: 'final',
        finalCompetition: def.competition,
        finalMode: def.mode,
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

/** Clear generator cache (tests / regen jobs). */
export function clearBackYourselfCandidateCache(): void {
  candidateCache = null;
}

async function decorateCategory(cat: BackYourselfCategory): Promise<BackYourselfCategory> {
  if ((cat.type === 'club' || cat.type === 'nat_club') && cat.club) {
    const logo = await lookupTeamLogo(cat.club, cat.leagueName ?? '');
    return { ...cat, logoUrl: logo?.logoUrl ?? null };
  }
  if (cat.type === 'club_combo' && cat.clubA) {
    const logo = await lookupTeamLogo(cat.clubA, '');
    return { ...cat, logoUrl: logo?.logoUrl ?? null };
  }
  if (cat.type === 'nat_league' && cat.leagueId != null) {
    return { ...cat, logoUrl: leagueLogoUrl(cat.leagueId) };
  }
  return { ...cat, logoUrl: cat.logoUrl ?? null };
}

function pickWeightedPool(candidates: Candidate[], seed: number): Candidate[] {
  const byType = {
    nat_club: candidates.filter((c) => c.type === 'nat_club'),
    nat_league: candidates.filter((c) => c.type === 'nat_league'),
    award: candidates.filter((c) => c.type === 'award'),
    stat: candidates.filter((c) => c.type === 'stat'),
    nationality: candidates.filter((c) => c.type === 'nationality'),
    managed_by: candidates.filter((c) => c.type === 'managed_by'),
    wc_squad: candidates.filter((c) => c.type === 'wc_squad'),
    club_combo: candidates.filter((c) => c.type === 'club_combo'),
    played_with_both: candidates.filter((c) => c.type === 'played_with_both'),
    final: candidates.filter((c) => c.type === 'final'),
  };
  // Weights: new families get solid share under the widened XP-cap model.
  const roll = seed % 100;
  const buckets: Array<{ weight: number; pool: Candidate[] }> = [
    { weight: 18, pool: byType.managed_by },
    { weight: 16, pool: byType.wc_squad },
    { weight: 12, pool: byType.club_combo },
    { weight: 10, pool: byType.played_with_both },
    { weight: 8, pool: byType.final },
    { weight: 12, pool: byType.nat_club },
    { weight: 8, pool: byType.nat_league },
    { weight: 8, pool: byType.award },
    { weight: 6, pool: byType.stat },
    { weight: 2, pool: byType.nationality },
  ];
  let cursor = 0;
  for (const b of buckets) {
    if (b.pool.length === 0) continue;
    cursor += b.weight;
    if (roll < cursor) return b.pool;
  }
  for (const b of buckets) {
    if (b.pool.length > 0) return b.pool;
  }
  return candidates;
}

export async function generateBackYourselfPuzzle(
  date: string,
  opts?: { seedKey?: string; minPool?: number }
): Promise<{ puzzle: BackYourselfPuzzlePublic; answer: BackYourselfPuzzleAnswer } | null> {
  let candidates = await getCandidates();
  if (candidates.length === 0) return null;
  if (opts?.minPool != null) {
    const wide = candidates.filter((c) => c.maxPool >= opts.minPool!);
    if (wide.length > 0) candidates = wide;
  }

  const seed = hashString(opts?.seedKey ?? `${date}:back_yourself`);
  let pool = pickWeightedPool(candidates, seed);
  if (pool.length === 0) pool = candidates;
  const chosen = seededShuffle(pool, seed)[0]!;
  return materializeBackYourselfCandidate(chosen, date, opts?.seedKey);
}

/** Every live Back Yourself category — used to prefill the VS bank. */
export async function generateAllBackYourselfPuzzles(
  date: string,
  opts?: { minPool?: number }
): Promise<Array<{ puzzle: BackYourselfPuzzlePublic; answer: BackYourselfPuzzleAnswer }>> {
  let candidates = await getCandidates();
  if (opts?.minPool != null) {
    const wide = candidates.filter((c) => c.maxPool >= opts.minPool!);
    if (wide.length > 0) candidates = wide;
  }
  const out: Array<{ puzzle: BackYourselfPuzzlePublic; answer: BackYourselfPuzzleAnswer }> = [];
  for (const [index, chosen] of candidates.entries()) {
    out.push(await materializeBackYourselfCandidate(chosen, date, `vs-bank-by-${index}`));
  }
  return out;
}

async function materializeBackYourselfCandidate(
  chosen: Candidate,
  date: string,
  seedKey?: string
): Promise<{ puzzle: BackYourselfPuzzlePublic; answer: BackYourselfPuzzleAnswer }> {
  const seed = hashString(seedKey ?? `${date}:back_yourself`);
  const category = await decorateCategory({
    type: chosen.type,
    label: chosen.label,
    club: chosen.club ?? null,
    leagueId: chosen.leagueId ?? null,
    leagueName: chosen.leagueName ?? null,
    nationality: chosen.nationality ?? null,
    award: chosen.award ?? null,
    awardPlacements: chosen.awardPlacements ?? null,
    statKey: chosen.statKey ?? null,
    statMin: chosen.statMin ?? null,
    manager: chosen.manager ?? null,
    managerNorm: chosen.managerNorm ?? null,
    wcYear: chosen.wcYear ?? null,
    wcCountry: chosen.wcCountry ?? null,
    clubA: chosen.clubA ?? null,
    clubB: chosen.clubB ?? null,
    anchorAId: chosen.anchorAId ?? null,
    anchorBId: chosen.anchorBId ?? null,
    anchorAName: chosen.anchorAName ?? null,
    anchorBName: chosen.anchorBName ?? null,
    finalCompetition: chosen.finalCompetition ?? null,
    finalMode: chosen.finalMode ?? null,
  });

  const xpCap = backYourselfXpCap(chosen.maxPool);
  const puzzleId = seedKey
    ? `vs-${seedKey.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || String(seed)}-back_yourself`
    : `${date}-back_yourself`;
  return {
    puzzle: {
      modeId: 'back_yourself',
      puzzleId,
      date,
      category,
      maxPool: chosen.maxPool,
      xpCap,
      mistakesAllowed: BACK_YOURSELF_MISTAKES_ALLOWED,
    },
    answer: {
      modeId: 'back_yourself',
      validPlayerIds: chosen.validPlayerIds,
    },
  };
}

const PLAYER_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toPlayerCard(
  row: {
    id: string;
    name: string;
    current_club: string;
    nationality: string;
    position: string;
    api_football_id: number | null;
  },
  overrides: Map<string, string>
): BackYourselfPlayerCard {
  return {
    id: row.id,
    name: row.name,
    club: row.current_club ?? '',
    nationality: row.nationality ?? '',
    position: row.position ?? '',
    headshotUrl: resolveHeadshot(overrides.get(row.id), row.api_football_id) ?? undefined,
  };
}

/** Batch-resolve pool cards for Quiz Ops (name, club, headshot). */
export async function resolveBackYourselfPlayerCards(
  playerIds: string[]
): Promise<BackYourselfPlayerCard[]> {
  const unique = [...new Set(playerIds.filter((id) => PLAYER_ID_RE.test(id)))];
  if (unique.length === 0) return [];
  const overrides = await getPhotoOverrides();
  const rows = (await db.execute(sql`
    SELECT id, name, current_club, nationality, position, api_football_id
    FROM players
    WHERE id IN (${sql.join(unique.map((id) => sql`${id}::uuid`), sql`, `)})
    ORDER BY name
  `)) as unknown as Array<{
    id: string;
    name: string;
    current_club: string;
    nationality: string;
    position: string;
    api_football_id: number | null;
  }>;
  return rows.map((row) => toPlayerCard(row, overrides));
}

export async function resolveBackYourselfPlayerCard(
  playerId: string
): Promise<BackYourselfPlayerCard | null> {
  const [card] = await resolveBackYourselfPlayerCards([playerId]);
  return card ?? null;
}

/** Recalculate suggested perfect + famous preview ids for Ops after category edits. */
export async function refreshBackYourselfAnswer(
  category: BackYourselfCategory
): Promise<{
  maxPool: number;
  xpCap: number;
  validPlayerIds: string[];
  poolPlayers: BackYourselfPlayerCard[];
  allMatchCount: number;
  category: BackYourselfCategory;
}> {
  const decorated = await decorateCategory({
    ...category,
    label: category.label || categoryLabel(category),
  });
  const validPlayerIds = await listMatchingPlayerIds(decorated);
  const [poolPlayers, allMatchCount] = await Promise.all([
    resolveBackYourselfPlayerCards(validPlayerIds),
    countAllMatchingPlayers(decorated),
  ]);
  return {
    maxPool: validPlayerIds.length,
    xpCap: backYourselfXpCap(validPlayerIds.length),
    validPlayerIds,
    poolPlayers,
    allMatchCount,
    category: { ...decorated, label: decorated.label || categoryLabel(decorated) },
  };
}
