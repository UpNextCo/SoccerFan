/**
 * Football Bingo generator. Builds a 16-tile grid + a solvable player queue from real data.
 *
 * Tile types (all matched identically on the client via FootballBingoMatcher):
 *  - nationality      (Brazil player…)
 *  - playedForClub    (big clubs only)
 *  - nationClub       (Brazilian who played for Barcelona — the marquee combo)
 *  - clubCombo        (played for both A and B)
 *  - wonCompetition   (curated trophy whitelist)
 *  - award            (Ballon d'Or, European Golden Shoe, WC Golden Boot/Ball)
 *  - statThreshold    (milestones via a generalised stats map: caps, CL apps, transfer fee…)
 *
 * Categories + player attributes derive from the SAME tables so the client matcher always agrees.
 *
 * Dry run: DATABASE_URL=... npm run job:gen-bingo [date]
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { resolveHeadshot } from '../constants/footballMedia.js';
import { lookupTeamLogo } from './teamService.js';
import { getPhotoOverrides } from './photoOverrides.js';
import { recentBingoTileIds } from './puzzleHistory.js';
import { buildClubDisplayMap, canonicalClubListWith, canonicalClubName, clubKey } from '../utils/clubCanonical.js';

const BIG5 = [39, 140, 135, 78, 61];
const GRID = 16;
const POOL_SIZE = 600;
const MIN_POOL_MATCHERS = 6; // a category needs this many matchers in the pool
const MIN_COMBO_MATCHERS = 5; // combos are rarer, allow a slightly lower floor
const MATCHERS_PER_CATEGORY = 5;
const MAX_QUEUE = 55;
/** Prefer tiles that haven't shipped within this many days. */
const BINGO_TILE_REPEAT_WINDOW_DAYS = 10;
/** Every tile should keep at least this many matchers in the shipped queue (timer fairness). */
const MIN_QUEUE_MATCHERS = 3;
const TOP_CLUB_COUNT = 22; // marquee clubs = the most-represented clubs in the famous pool

function norm(v: string): string {
  return v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Curated trophy whitelist (the only competitions fans care to see as a tile).
const TROPHY_CANONICAL: Array<{ name: string; aliases: string[] }> = [
  { name: 'Champions League', aliases: ['UEFA Champions League'] },
  { name: 'Europa League', aliases: ['UEFA Europa League'] },
  { name: 'Club World Cup', aliases: ['FIFA Club World Cup', 'FIFA Intercontinental Cup', 'Intercontinental Cup', 'Inter Continental Cup'] },
  { name: 'World Cup', aliases: ['FIFA World Cup', 'World Cup'] },
  { name: 'European Championship', aliases: ['UEFA European Championship', 'European Championship'] },
  { name: 'Copa América', aliases: ['CONMEBOL Copa America', 'Copa America', 'Copa América'] },
  { name: 'Premier League', aliases: ['Premier League'] },
  { name: 'La Liga', aliases: ['La Liga'] },
  { name: 'Serie A', aliases: ['Serie A'] },
  { name: 'Bundesliga', aliases: ['Bundesliga'] },
  { name: 'Ligue 1', aliases: ['Ligue 1'] },
  { name: 'League Cup', aliases: ['League Cup', 'EFL Cup', 'Carabao Cup'] },
];

const TROPHY_ALIAS_LOOKUP = new Map<string, string>();
const TROPHY_CANONICAL_SET = new Set<string>();
for (const trophy of TROPHY_CANONICAL) {
  TROPHY_CANONICAL_SET.add(trophy.name);
  for (const alias of trophy.aliases) TROPHY_ALIAS_LOOKUP.set(norm(alias), trophy.name);
}
function canonicalTrophy(raw: string): string | null {
  return TROPHY_ALIAS_LOOKUP.get(norm(raw)) ?? null;
}

// Individual honours we hold in player_awards (only shown if enough matchers).
// Ballon d'Or is a podium award (1st/2nd/3rd) — only 1st counts as a win for the tile.
const AWARD_DEFS: Array<{ award: string; title: string; placements: string[] }> = [
  { award: "Ballon d'Or", title: "Ballon d'Or Winner", placements: ['1st'] },
  { award: 'European Golden Shoe', title: 'European Golden Boot', placements: ['winner'] },
  { award: 'World Cup Golden Boot', title: 'World Cup Golden Boot', placements: ['winner'] },
  { award: 'World Cup Golden Ball', title: 'World Cup Golden Ball', placements: ['winner'] },
];

const AWARD_WIN_PLACEMENTS = new Map(AWARD_DEFS.map((a) => [a.award, new Set(a.placements)]));

// Milestone tiles, matched against the generalised stats map. icon = the headline number.
const STAT_DEFS: Array<{ rule: string; title: string; icon: string }> = [
  { rule: 'intl_caps>=100', title: 'International Caps', icon: '100+' },
  { rule: 'intl_goals>=40', title: 'International Goals', icon: '40+' },
  { rule: 'pl_goals>=100', title: 'Premier League Goals', icon: '100+' },
  { rule: 'pl_apps>=250', title: 'Premier League Apps', icon: '250+' },
  { rule: 'cl_apps>=80', title: 'Champions League Apps', icon: '80+' },
  { rule: 'cl_goals>=30', title: 'Champions League Goals', icon: '30+' },
  { rule: 'club_apps>=500', title: 'Career Club Apps', icon: '500+' },
  { rule: 'laliga_apps>=150', title: 'La Liga Apps', icon: '150+' },
  { rule: 'seriea_apps>=150', title: 'Serie A Apps', icon: '150+' },
  { rule: 'top5_leagues>=3', title: 'Top-5 Leagues Played', icon: '3+' },
  { rule: 'top5_clubs>=4', title: 'Top-5 Clubs Played For', icon: '4+' },
  { rule: 'transfer_eur_m>=80', title: 'Transfer Fee', icon: '€80M' },
  { rule: 'transfer_eur_m>=100', title: 'Transfer Fee', icon: '€100M' },
];

// Nation → demonym, for nice nation+club titles.
const DEMONYM: Record<string, string> = {
  Brazil: 'Brazilian', Argentina: 'Argentine', France: 'French', Spain: 'Spanish', Germany: 'German',
  England: 'English', Portugal: 'Portuguese', Netherlands: 'Dutch', Italy: 'Italian', Belgium: 'Belgian',
  Croatia: 'Croatian', Uruguay: 'Uruguayan', Colombia: 'Colombian', "Ivory Coast": 'Ivorian',
  Senegal: 'Senegalese', Morocco: 'Moroccan', Nigeria: 'Nigerian', Poland: 'Polish', Denmark: 'Danish',
  Sweden: 'Swedish', Norway: 'Norwegian', Wales: 'Welsh', Scotland: 'Scottish', Ireland: 'Irish',
  Mexico: 'Mexican', 'United States': 'American', Japan: 'Japanese', 'South Korea': 'South Korean',
  Ghana: 'Ghanaian', Cameroon: 'Cameroonian', Egypt: 'Egyptian', Algeria: 'Algerian', Serbia: 'Serbian',
  Switzerland: 'Swiss', Austria: 'Austrian', Turkey: 'Turkish', Greece: 'Greek', Chile: 'Chilean',
};
function demonym(nation: string): string {
  return DEMONYM[nation] ?? `${nation}`;
}

type CatType =
  | 'nationality' | 'playedForClub' | 'nationClub' | 'clubCombo'
  | 'wonCompetition' | 'award' | 'statThreshold';
type IconType = 'flag' | 'clubBadge' | 'trophy' | 'nationClub' | 'clubCombo' | 'award' | 'custom';

export interface BingoCategory {
  id: string;
  title: string;
  type: CatType;
  iconType: IconType;
  iconValue: string;
  matchingRule: string;
  logoUrl?: string | null;
  teamId?: number | null;
  logo2Url?: string | null;
  team2Id?: number | null;
  flag?: string | null; // nationality for nationClub tiles
}

export interface BingoPlayer {
  id: string;
  name: string;
  nationality: string;
  position: string;
  clubs: string[];
  leagues: string[];
  trophies: string[];
  teammates: string[];
  managers: string[];
  awards: string[];
  stats: Record<string, number>;
  premierLeagueApps: number | null;
  topLeagueGoals: number | null;
  topLeagueApps: number | null;
  headshotUrl: string | null;
}

export interface FootballBingoPuzzle {
  modeId: 'football_bingo';
  puzzleId: string;
  date: string;
  title: string;
  categories: BingoCategory[];
  players: BingoPlayer[];
}

export function matches(p: BingoPlayer, c: BingoCategory): boolean {
  switch (c.type) {
    case 'nationality':
      return norm(p.nationality) === norm(c.matchingRule);
    case 'playedForClub':
      return p.clubs.some((x) => clubKey(x) === clubKey(c.matchingRule));
    case 'nationClub': {
      const [nation, club] = c.matchingRule.split('|');
      return norm(p.nationality) === norm(nation ?? '') && p.clubs.some((x) => clubKey(x) === clubKey(club ?? ''));
    }
    case 'clubCombo': {
      const [a, b] = c.matchingRule.split('|');
      return p.clubs.some((x) => clubKey(x) === clubKey(a ?? '')) && p.clubs.some((x) => clubKey(x) === clubKey(b ?? ''));
    }
    case 'wonCompetition':
      return p.trophies.some((x) => norm(x) === norm(c.matchingRule));
    case 'award':
      return p.awards.some((x) => norm(x) === norm(c.matchingRule));
    case 'statThreshold': {
      const [key, thrStr] = c.matchingRule.split('>=');
      const thr = Number(thrStr) || 0;
      return (p.stats[key ?? ''] ?? 0) >= thr;
    }
  }
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
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

async function rows<T extends Record<string, unknown>>(query: ReturnType<typeof sql>): Promise<T[]> {
  return (await db.execute(query)) as unknown as T[];
}

/** Most common BIG5 league per club name, for crest lookup. Keys both raw DB names and the
 * canonical display label ("AS Roma" → "Roma") so tile iconValue league isn't wrong. */
async function loadClubLeagues(): Promise<Map<string, string>> {
  const rows2 = await rows<{ team_name: string; league_name: string }>(sql`
    SELECT team_name, league_name FROM (
      SELECT team_name, league_name,
             ROW_NUMBER() OVER (PARTITION BY team_name ORDER BY COUNT(*) DESC) AS rn
      FROM player_stats
      WHERE league_id IN (39, 140, 135, 78, 61) AND team_name IS NOT NULL
      GROUP BY team_name, league_name
    ) t WHERE rn = 1
  `);
  const map = new Map<string, string>();
  for (const r of rows2) {
    map.set(r.team_name, r.league_name);
    map.set(canonicalClubName(r.team_name), r.league_name);
  }
  return map;
}

async function loadPool(): Promise<BingoPlayer[]> {
  const idRows = await rows<{ player_id: string }>(sql`
    SELECT player_id FROM player_stats
    WHERE league_id IN (39, 140, 135, 78, 61)
    GROUP BY player_id
    ORDER BY SUM(appearances) DESC
    LIMIT ${POOL_SIZE}
  `);
  const ids = idRows.map((r) => r.player_id);
  if (ids.length === 0) return [];
  const idList = sql.join(ids.map((id) => sql`${id}`), sql`, `);

  const base = await rows<{
    id: string; name: string; nationality: string; position: string; api_football_id: number | null;
  }>(sql`
    SELECT p.id, p.name, p.nationality, COALESCE(p.position, '') AS position, p.api_football_id
    FROM players p WHERE p.id IN (${idList})
  `);

  // One pass over player_stats for every milestone stat.
  const statRows = await rows<{
    player_id: string; pl_apps: number; pl_goals: number; laliga_apps: number; seriea_apps: number;
    bundes_apps: number; ligue1_apps: number; top_apps: number; top_goals: number; club_apps: number;
    cl_apps: number; cl_goals: number; intl_caps: number; intl_goals: number; top5_leagues: number;
  }>(sql`
    SELECT player_id,
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
    FROM player_stats WHERE player_id IN (${idList})
    GROUP BY player_id
  `);
  const statsById = new Map(statRows.map((r) => [r.player_id, r]));

  // player_stats has almost no national-team rows — the real international caps/goals live in
  // player_extra_stats (Wikipedia list ingest). Take the max of both sources.
  const extraRows = await rows<{ player_id: string; intl_caps: number; intl_goals: number }>(sql`
    SELECT player_id, intl_caps, intl_goals FROM player_extra_stats WHERE player_id IN (${idList})
  `);
  for (const e of extraRows) {
    const s = statsById.get(e.player_id);
    if (!s) continue;
    s.intl_caps = Math.max(s.intl_caps, e.intl_caps);
    s.intl_goals = Math.max(s.intl_goals, e.intl_goals);
  }

  const clubRows = await rows<{ player_id: string; clubs: string[] }>(sql`
    SELECT player_id, array_agg(DISTINCT team_name) AS clubs
    FROM player_stats
    WHERE player_id IN (${idList}) AND league_id IN (39, 140, 135, 78, 61) AND team_name IS NOT NULL
    GROUP BY player_id
  `);
  const leagueRows = await rows<{ player_id: string; leagues: string[] }>(sql`
    SELECT player_id, array_agg(DISTINCT league_name) AS leagues
    FROM player_stats WHERE player_id IN (${idList})
    GROUP BY player_id
  `);
  const trophyRows = await rows<{ player_id: string; trophies: string[] }>(sql`
    SELECT player_id, array_agg(DISTINCT competition) AS trophies
    FROM player_honours WHERE player_id IN (${idList}) AND placement ILIKE '%winner%'
    GROUP BY player_id
  `);
  const awardRows = await rows<{ player_id: string; award: string; placement: string }>(sql`
    SELECT player_id, award, placement
    FROM player_awards WHERE player_id IN (${idList})
  `);
  const feeRows = await rows<{ player_id: string; max_fee: number }>(sql`
    SELECT player_id, COALESCE(MAX(fee_eur_m), 0)::int AS max_fee
    FROM player_transfers WHERE player_id IN (${idList}) AND fee_eur_m IS NOT NULL
    GROUP BY player_id
  `);

  // One display string per clubKey across the whole pool, so player.clubs and the tile
  // matchingRules always use identical spellings (the iOS matcher compares literal strings).
  const clubDisplay = buildClubDisplayMap(clubRows.flatMap((r) => r.clubs ?? []));
  const clubsById = new Map(clubRows.map((r) => [r.player_id, r.clubs]));
  const leaguesById = new Map(leagueRows.map((r) => [r.player_id, r.leagues]));
  const trophiesById = new Map(trophyRows.map((r) => [r.player_id, r.trophies]));
  const awardsById = new Map<string, string[]>();
  for (const r of awardRows) {
    const winPlacements = AWARD_WIN_PLACEMENTS.get(r.award);
    if (!winPlacements?.has(r.placement)) continue;
    const list = awardsById.get(r.player_id) ?? [];
    if (!list.includes(r.award)) list.push(r.award);
    awardsById.set(r.player_id, list);
  }
  const feeById = new Map(feeRows.map((r) => [r.player_id, r.max_fee]));
  const overrides = await getPhotoOverrides();

  return base.map((b) => {
    const s = statsById.get(b.id);
    const clubs = canonicalClubListWith(clubsById.get(b.id) ?? [], clubDisplay);
    const trophies = [
      ...new Set((trophiesById.get(b.id) ?? []).map((t) => canonicalTrophy(t)).filter((t): t is string => t !== null)),
    ];
    const stats: Record<string, number> = {
      pl_apps: s?.pl_apps ?? 0, pl_goals: s?.pl_goals ?? 0,
      laliga_apps: s?.laliga_apps ?? 0, seriea_apps: s?.seriea_apps ?? 0,
      bundesliga_apps: s?.bundes_apps ?? 0, ligue1_apps: s?.ligue1_apps ?? 0,
      top_apps: s?.top_apps ?? 0, top_goals: s?.top_goals ?? 0, club_apps: s?.club_apps ?? 0,
      cl_apps: s?.cl_apps ?? 0, cl_goals: s?.cl_goals ?? 0,
      intl_caps: s?.intl_caps ?? 0, intl_goals: s?.intl_goals ?? 0,
      top5_leagues: s?.top5_leagues ?? 0, top5_clubs: clubs.length,
      transfer_eur_m: feeById.get(b.id) ?? 0,
    };
    return {
      id: b.id,
      name: b.name,
      nationality: b.nationality,
      position: b.position,
      clubs,
      leagues: leaguesById.get(b.id) ?? [],
      trophies,
      teammates: [],
      managers: [],
      awards: awardsById.get(b.id) ?? [],
      stats,
      premierLeagueApps: stats.pl_apps,
      topLeagueGoals: stats.top_goals,
      topLeagueApps: stats.top_apps,
      headshotUrl: resolveHeadshot(overrides.get(b.id), b.api_football_id) ?? null,
    };
  });
}

function countMatchers(pool: BingoPlayer[], cat: BingoCategory): number {
  return pool.filter((p) => matches(p, cat)).length;
}

/** The marquee clubs = the clubs with the most famous-pool players (naturally the big ones). */
function topClubs(pool: BingoPlayer[]): Array<{ display: string; key: string }> {
  const counts = new Map<string, { display: string; n: number }>();
  for (const p of pool) {
    for (const c of p.clubs) {
      const k = clubKey(c);
      if (!k) continue;
      const e = counts.get(k);
      if (e) e.n += 1;
      else counts.set(k, { display: c, n: 1 });
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, TOP_CLUB_COUNT)
    .map(([key, v]) => ({ display: v.display, key }));
}

function buildCandidates(pool: BingoPlayer[], clubLeagues: Map<string, string>, seed: number): Record<CatType, BingoCategory[]> {
  const marquee = topClubs(pool);
  const marqueeKeys = new Set(marquee.map((c) => c.key));

  const tally = (extract: (p: BingoPlayer) => string[]) => {
    const counts = new Map<string, number>();
    for (const p of pool) for (const v of new Set(extract(p))) counts.set(v, (counts.get(v) ?? 0) + 1);
    return counts;
  };

  const nats = [...tally((p) => [p.nationality]).entries()]
    .filter(([n, c]) => n && n !== 'Unknown' && c >= MIN_POOL_MATCHERS)
    .map(([n]): BingoCategory => ({ id: `nat_${norm(n)}`, title: n, type: 'nationality', iconType: 'flag', iconValue: n, matchingRule: n }));

  const clubs = marquee
    .map(({ display: n }): BingoCategory => ({
      id: `club_${norm(n)}`, title: `Played for ${n}`, type: 'playedForClub', iconType: 'clubBadge',
      iconValue: `${n}|${clubLeagues.get(n) ?? 'Premier League'}`, matchingRule: n,
    }))
    .filter((c) => countMatchers(pool, c) >= MIN_POOL_MATCHERS);

  // Nation × marquee-club combos (the best tile type).
  const nationClubCounts = new Map<string, number>();
  for (const p of pool) {
    if (!p.nationality || p.nationality === 'Unknown') continue;
    for (const club of p.clubs) {
      if (!marqueeKeys.has(clubKey(club))) continue;
      const rule = `${p.nationality}|${club}`;
      nationClubCounts.set(rule, (nationClubCounts.get(rule) ?? 0) + 1);
    }
  }
  const nationClub = [...nationClubCounts.entries()]
    .filter(([, c]) => c >= MIN_COMBO_MATCHERS)
    .map(([rule]): BingoCategory => {
      const [nation, club] = rule.split('|');
      return {
        id: `natclub_${norm(rule)}`, title: `${demonym(nation ?? '')} • ${club}`, type: 'nationClub',
        iconType: 'nationClub', iconValue: `${club}|${clubLeagues.get(club ?? '') ?? 'Premier League'}`,
        matchingRule: rule, flag: nation ?? '',
      };
    });

  // Club × club combos (played for both).
  const comboCounts = new Map<string, number>();
  for (const p of pool) {
    const cs = p.clubs.filter((c) => marqueeKeys.has(clubKey(c))).sort((a, b) => clubKey(a).localeCompare(clubKey(b)));
    for (let i = 0; i < cs.length; i += 1) {
      for (let j = i + 1; j < cs.length; j += 1) {
        const rule = `${cs[i]}|${cs[j]}`;
        comboCounts.set(rule, (comboCounts.get(rule) ?? 0) + 1);
      }
    }
  }
  const clubCombo = [...comboCounts.entries()]
    .filter(([, c]) => c >= MIN_COMBO_MATCHERS)
    .map(([rule]): BingoCategory => {
      const [a, b] = rule.split('|');
      return {
        id: `combo_${norm(rule)}`, title: `${a} & ${b}`, type: 'clubCombo', iconType: 'clubCombo',
        iconValue: rule, matchingRule: rule,
      };
    });

  const trophies = [...TROPHY_CANONICAL_SET]
    .map((t): BingoCategory => ({ id: `trophy_${norm(t)}`, title: `${t} Winner`, type: 'wonCompetition', iconType: 'trophy', iconValue: t, matchingRule: t }))
    .filter((c) => countMatchers(pool, c) >= MIN_POOL_MATCHERS);

  const awards = AWARD_DEFS
    .map((a): BingoCategory => ({ id: `award_${norm(a.award)}`, title: a.title, type: 'award', iconType: 'award', iconValue: a.award, matchingRule: a.award }))
    .filter((c) => countMatchers(pool, c) >= MIN_POOL_MATCHERS);

  const stats = STAT_DEFS
    .map((s): BingoCategory => ({ id: `stat_${norm(s.rule)}`, title: s.title, type: 'statThreshold', iconType: 'custom', iconValue: s.icon, matchingRule: s.rule }))
    .filter((c) => countMatchers(pool, c) >= MIN_POOL_MATCHERS);

  return {
    nationality: seededShuffle(nats, seed),
    playedForClub: seededShuffle(clubs, seed ^ 1),
    nationClub: seededShuffle(nationClub, seed ^ 2),
    clubCombo: seededShuffle(clubCombo, seed ^ 3),
    wonCompetition: seededShuffle(trophies, seed ^ 4),
    award: seededShuffle(awards, seed ^ 5),
    statThreshold: seededShuffle(stats, seed ^ 6),
  };
}

export async function generateFootballBingoPuzzle(
  date: string,
  opts?: { recentTileIds?: Set<string> }
): Promise<FootballBingoPuzzle> {
  const [pool, clubLeagues] = await Promise.all([loadPool(), loadClubLeagues()]);
  if (pool.length < 50) throw new Error('Not enough players in pool for Football Bingo');

  const seed = hashStr(`${date}:football_bingo`);
  const candidates = buildCandidates(pool, clubLeagues, seed);

  // Repeat suppression: prefer tiles that haven't shipped in the last few days, so the same
  // "France" / "Played for Liverpool" square doesn't anchor half the week's grids. Thin types
  // (awards, stat milestones) fall back to recent tiles rather than dropping below the mix.
  const recentTiles = opts?.recentTileIds ?? (await recentBingoTileIds(date, BINGO_TILE_REPEAT_WINDOW_DAYS));

  // Target mix; tops up from leftovers if a type is short.
  const target: Array<[CatType, number]> = [
    ['nationality', 3],
    ['playedForClub', 3],
    ['nationClub', 4],
    ['clubCombo', 2],
    ['wonCompetition', 2],
    ['award', 1],
    ['statThreshold', 1],
  ];

  const chosen: BingoCategory[] = [];
  const usedRules = new Set<string>();
  const takeForType = (type: CatType, n: number, allowRecent: boolean) => {
    for (const c of candidates[type]) {
      if (chosen.filter((x) => x.type === type).length >= n) break;
      if (usedRules.has(c.id)) continue;
      if (!allowRecent && recentTiles.has(c.id)) continue;
      usedRules.add(c.id);
      chosen.push(c);
    }
  };
  for (const [type, n] of target) {
    takeForType(type, n, false);
    takeForType(type, n, true); // fill any shortfall with recent tiles
  }
  if (chosen.length < GRID) {
    const rest = seededShuffle(Object.values(candidates).flat().filter((c) => !usedRules.has(c.id)), seed);
    for (const c of [...rest.filter((c) => !recentTiles.has(c.id)), ...rest.filter((c) => recentTiles.has(c.id))]) {
      if (chosen.length >= GRID) break;
      usedRules.add(c.id);
      chosen.push(c);
    }
  }
  const categories = seededShuffle(chosen.slice(0, GRID), seed ^ 0x5eed);

  // Resolve crest URLs server-side for club / combo / nation+club tiles (reliable badges).
  await Promise.all(
    categories.map(async (c) => {
      if (c.iconType === 'clubBadge' || c.iconType === 'nationClub') {
        const [club, league] = c.iconValue.split('|');
        const logo = await lookupTeamLogo(club ?? c.matchingRule, league ?? '');
        c.logoUrl = logo?.logoUrl ?? null;
        c.teamId = logo?.teamId ?? null;
      } else if (c.iconType === 'clubCombo') {
        const [a, b] = c.matchingRule.split('|');
        const [la, lb] = await Promise.all([
          lookupTeamLogo(a ?? '', clubLeagues.get(a ?? '') ?? ''),
          lookupTeamLogo(b ?? '', clubLeagues.get(b ?? '') ?? ''),
        ]);
        c.logoUrl = la?.logoUrl ?? null;
        c.teamId = la?.teamId ?? null;
        c.logo2Url = lb?.logoUrl ?? null;
        c.team2Id = lb?.teamId ?? null;
      }
    })
  );

  // Solvable queue: top matchers per category by club apps (fame proxy).
  const queueIds = new Set<string>();
  const queue: BingoPlayer[] = [];
  for (const cat of categories) {
    const matchers = pool
      .filter((p) => matches(p, cat))
      .sort((a, b) => (b.premierLeagueApps ?? 0) - (a.premierLeagueApps ?? 0))
      .slice(0, MATCHERS_PER_CATEGORY);
    for (const p of matchers) {
      if (!queueIds.has(p.id)) { queueIds.add(p.id); queue.push(p); }
    }
  }
  let players = seededShuffle(queue, seed ^ 0x9f00).slice(0, MAX_QUEUE);

  // The shuffle+slice can cut a tile down to 1–2 surviving matchers — technically solvable but
  // brutal under the turn timer. Top tiles back up to ≥3 matchers (or all it has), swapping out
  // the least-useful player whose removal doesn't starve another tile.
  const inQueue = new Set(players.map((p) => p.id));
  const countIn = (cat: BingoCategory) => players.filter((p) => matches(p, cat)).length;
  for (const cat of categories) {
    const available = queue.filter((p) => matches(p, cat));
    const desired = Math.min(MIN_QUEUE_MATCHERS, available.length);
    for (const cand of available) {
      if (countIn(cat) >= desired) break;
      if (inQueue.has(cand.id)) continue;
      if (players.length >= MAX_QUEUE) {
        const removable = players
          .filter((p) => !categories.some((c2) => matches(p, c2) && countIn(c2) <= MIN_QUEUE_MATCHERS))
          .sort((a, b) => categories.filter((c2) => matches(a, c2)).length - categories.filter((c2) => matches(b, c2)).length)[0];
        if (!removable) break;
        players = players.filter((p) => p.id !== removable.id);
        inQueue.delete(removable.id);
      }
      players.push(cand);
      inQueue.add(cand.id);
    }
  }
  players = seededShuffle(players, seed ^ 0x77aa);

  return { modeId: 'football_bingo', puzzleId: `${date}-football_bingo`, date, title: 'Daily Football Bingo', categories, players };
}

/**
 * Solvable = a full 16-tile grid where every tile has at least one matcher in the shipped queue.
 * Matching uses the server clubKey() logic, which — now that player.clubs and the club
 * matchingRules ship one unified label per key — matches the iOS literal-string matcher, so this
 * gate accurately reflects on-device solvability. `fair` additionally flags whether every tile
 * clears the MIN_QUEUE_MATCHERS bar (or has exhausted the pool), for logging/QA.
 */
export function isBingoSolvable(puzzle: FootballBingoPuzzle): {
  ok: boolean;
  fair: boolean;
  perCategory: Array<{ title: string; matchers: number }>;
} {
  const perCategory = puzzle.categories.map((c) => ({
    title: c.title,
    matchers: puzzle.players.filter((p) => matches(p, c)).length,
  }));
  const ok = puzzle.categories.length === GRID && perCategory.every((c) => c.matchers >= 1);
  const fair = perCategory.every((c) => c.matchers >= MIN_QUEUE_MATCHERS);
  return { ok, fair, perCategory };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);
  generateFootballBingoPuzzle(date)
    .then((puzzle) => {
      console.log(`\n=== FOOTBALL BINGO ${date} — ${puzzle.categories.length} categories, ${puzzle.players.length} players ===\n`);
      const check = isBingoSolvable(puzzle);
      for (const c of check.perCategory) {
        const flag = c.matchers === 0 ? 'X' : c.matchers < 3 ? '!' : 'OK';
        console.log(`  [${flag}] ${c.title.padEnd(30)} ${c.matchers} matchers`);
      }
      console.log(`\nSolvable: ${check.ok ? 'YES' : 'NO'}`);
      process.exit(check.ok ? 0 : 1);
    })
    .catch((err) => { console.error(err); process.exit(1); });
}
