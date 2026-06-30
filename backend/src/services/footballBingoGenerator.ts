/**
 * Football Bingo generator. Builds a 16-category grid + a solvable player queue
 * from real data. Categories and player attributes are derived from the SAME
 * tables (player_stats / player_honours / players) so the client matcher always
 * agrees with the server.
 *
 * Dry run: DATABASE_URL=... npm run job:gen-bingo [date]
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { playerHeadshotUrl } from '../constants/footballMedia.js';

const BIG5 = [39, 140, 135, 78, 61];
const GRID = 16;
const POOL_SIZE = 600;
const MIN_POOL_MATCHERS = 6; // a category must have this many matchers in the pool
const MATCHERS_PER_CATEGORY = 5; // how many of each we seed into the queue
const MAX_QUEUE = 55;

/**
 * Canonical trophy categories → the raw competition strings (as stored in
 * player_honours by API-Football) that map onto them. API naming drifts
 * ("FIFA World Cup" vs "World Cup"), so we canonicalize at pool-load time and the
 * client keeps matching on the canonical name with simple string equality.
 */
const TROPHY_CANONICAL: Array<{ name: string; aliases: string[] }> = [
  // Continental club
  { name: 'Champions League', aliases: ['UEFA Champions League'] },
  { name: 'Europa League', aliases: ['UEFA Europa League'] },
  { name: 'UEFA Super Cup', aliases: ['UEFA Super Cup'] },
  { name: 'Club World Cup', aliases: ['FIFA Club World Cup', 'FIFA Intercontinental Cup', 'Intercontinental Cup', 'Inter Continental Cup'] },
  // International
  { name: 'World Cup', aliases: ['FIFA World Cup', 'World Cup'] },
  { name: 'European Championship', aliases: ['UEFA European Championship', 'European Championship'] },
  { name: 'Copa América', aliases: ['CONMEBOL Copa America', 'Copa America', 'Copa América'] },
  { name: 'Nations League', aliases: ['UEFA Nations League'] },
  // Domestic leagues
  { name: 'Premier League', aliases: ['Premier League'] },
  { name: 'La Liga', aliases: ['La Liga'] },
  { name: 'Serie A', aliases: ['Serie A'] },
  { name: 'Bundesliga', aliases: ['Bundesliga'] },
  { name: 'Ligue 1', aliases: ['Ligue 1'] },
  // Domestic cups
  { name: 'FA Cup', aliases: ['FA Cup'] },
  { name: 'League Cup', aliases: ['League Cup', 'EFL Cup', 'Carabao Cup'] },
  { name: 'Community Shield', aliases: ['Community Shield'] },
  { name: 'Copa del Rey', aliases: ['Copa del Rey'] },
  { name: 'Coppa Italia', aliases: ['Coppa Italia'] },
  { name: 'DFB Pokal', aliases: ['DFB Pokal'] },
  { name: 'Coupe de France', aliases: ['Coupe de France'] },
  { name: 'Trophée des Champions', aliases: ['Trophée des Champions', 'Trophee des Champions'] },
];

/** Normalized raw competition string → canonical trophy name. */
const TROPHY_ALIAS_LOOKUP = new Map<string, string>();
const TROPHY_CANONICAL_SET = new Set<string>();
for (const trophy of TROPHY_CANONICAL) {
  TROPHY_CANONICAL_SET.add(trophy.name);
  for (const alias of trophy.aliases) TROPHY_ALIAS_LOOKUP.set(norm(alias), trophy.name);
}

function canonicalTrophy(raw: string): string | null {
  return TROPHY_ALIAS_LOOKUP.get(norm(raw)) ?? null;
}

const LEAGUES = ['Premier League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1', 'UEFA Champions League'];

/** Outfield/keeper buckets as stored in players.position. */
const POSITIONS: Array<{ rule: string; title: string; abbrev: string }> = [
  { rule: 'Goalkeeper', title: 'Goalkeeper', abbrev: 'GK' },
  { rule: 'Defender', title: 'Defender', abbrev: 'DEF' },
  { rule: 'Midfielder', title: 'Midfielder', abbrev: 'MID' },
  { rule: 'Attacker', title: 'Attacker', abbrev: 'ATT' },
];

/** Stat-threshold categories. Rule grammar: `<stat>>=<n>` where stat is one of
 *  pl_apps (PL appearances), goals (big-5 career goals), apps (big-5 career apps). */
const STAT_DEFS: Array<{ rule: string; title: string; icon: string }> = [
  { rule: 'pl_apps>=100', title: '100+ PL Apps', icon: '100+' },
  { rule: 'pl_apps>=200', title: '200+ PL Apps', icon: '200+' },
  { rule: 'pl_apps>=300', title: '300+ PL Apps', icon: '300+' },
  { rule: 'goals>=50', title: '50+ Top-5 Goals', icon: '50+' },
  { rule: 'goals>=100', title: '100+ Top-5 Goals', icon: '100+' },
  { rule: 'apps>=400', title: '400+ Top-5 Apps', icon: '400+' },
];

/** Marquee clubs (normalized) preferred for "played for" categories. */
const BIG_CLUBS = new Set([
  'real madrid', 'barcelona', 'atletico madrid', 'manchester city', 'manchester united',
  'liverpool', 'arsenal', 'chelsea', 'tottenham', 'bayern munich', 'borussia dortmund',
  'juventus', 'inter', 'ac milan', 'napoli', 'as roma', 'paris saint germain', 'paris saint-germain',
  'ajax', 'porto', 'benfica', 'sevilla', 'valencia', 'lazio',
]);

type CatType = 'nationality' | 'playedForClub' | 'playedInLeague' | 'wonCompetition' | 'statThreshold' | 'position';

interface BingoCategory {
  id: string;
  title: string;
  type: CatType;
  iconType: 'flag' | 'clubBadge' | 'trophy' | 'league' | 'custom';
  iconValue: string;
  matchingRule: string;
}

interface BingoPlayer {
  id: string;
  name: string;
  nationality: string;
  position: string;
  clubs: string[];
  leagues: string[];
  trophies: string[];
  teammates: string[];
  managers: string[];
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

function norm(v: string): string {
  return v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function matches(p: BingoPlayer, c: BingoCategory): boolean {
  switch (c.type) {
    case 'nationality':
      return norm(p.nationality) === norm(c.matchingRule);
    case 'playedForClub':
      return p.clubs.some((x) => norm(x) === norm(c.matchingRule));
    case 'playedInLeague':
      return p.leagues.some((x) => norm(x) === norm(c.matchingRule));
    case 'wonCompetition':
      return p.trophies.some((x) => norm(x) === norm(c.matchingRule));
    case 'position':
      return norm(p.position) === norm(c.matchingRule);
    case 'statThreshold': {
      const [statKey, thrStr] = c.matchingRule.split('>=');
      const thr = Number(thrStr) || 0;
      const value =
        statKey === 'goals'
          ? p.topLeagueGoals ?? 0
          : statKey === 'apps'
            ? p.topLeagueApps ?? 0
            : p.premierLeagueApps ?? 0; // default: pl_apps
      return value >= thr;
    }
  }
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h << 5) - h + s.charCodeAt(i);
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

async function rows<T extends Record<string, unknown>>(query: ReturnType<typeof sql>): Promise<T[]> {
  return (await db.execute(query)) as unknown as T[];
}

/** Most common BIG5 league per club name, for crest lookup on the client. */
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
  return new Map(rows2.map((r) => [r.team_name, r.league_name]));
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
    id: string;
    name: string;
    nationality: string;
    position: string;
    api_football_id: number | null;
    pl_apps: number;
    top_goals: number;
    top_apps: number;
  }>(sql`
    SELECT p.id, p.name, p.nationality, COALESCE(p.position, '') AS position, p.api_football_id,
           COALESCE((SELECT SUM(appearances) FROM player_stats s WHERE s.player_id = p.id AND s.league_id = 39), 0)::int AS pl_apps,
           COALESCE((SELECT SUM(goals) FROM player_stats s WHERE s.player_id = p.id AND s.league_id IN (39, 140, 135, 78, 61)), 0)::int AS top_goals,
           COALESCE((SELECT SUM(appearances) FROM player_stats s WHERE s.player_id = p.id AND s.league_id IN (39, 140, 135, 78, 61)), 0)::int AS top_apps
    FROM players p WHERE p.id IN (${idList})
  `);

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

  const clubsById = new Map(clubRows.map((r) => [r.player_id, r.clubs]));
  const leaguesById = new Map(leagueRows.map((r) => [r.player_id, r.leagues]));
  const trophiesById = new Map(trophyRows.map((r) => [r.player_id, r.trophies]));

  return base.map((b) => {
    // Canonicalize + dedupe trophies so fragmented API names collapse to one tile.
    const trophies = [
      ...new Set(
        (trophiesById.get(b.id) ?? [])
          .map((t) => canonicalTrophy(t))
          .filter((t): t is string => t !== null)
      ),
    ];
    return {
      id: b.id,
      name: b.name,
      nationality: b.nationality,
      position: b.position,
      clubs: clubsById.get(b.id) ?? [],
      leagues: leaguesById.get(b.id) ?? [],
      trophies,
      teammates: [],
      managers: [],
      premierLeagueApps: b.pl_apps,
      topLeagueGoals: b.top_goals,
      topLeagueApps: b.top_apps,
      headshotUrl: playerHeadshotUrl(b.api_football_id) ?? null,
    };
  });
}

function countMatchers(pool: BingoPlayer[], cat: BingoCategory): number {
  return pool.filter((p) => matches(p, cat)).length;
}

function buildCandidates(pool: BingoPlayer[], clubLeagues: Map<string, string>): Record<CatType, BingoCategory[]> {
  const tally = (extract: (p: BingoPlayer) => string[]) => {
    const counts = new Map<string, number>();
    for (const p of pool) for (const v of new Set(extract(p))) counts.set(v, (counts.get(v) ?? 0) + 1);
    return counts;
  };

  const nats = [...tally((p) => [p.nationality]).entries()]
    .filter(([n, c]) => n && n !== 'Unknown' && c >= MIN_POOL_MATCHERS)
    .map(([n]): BingoCategory => ({ id: `nat_${norm(n)}`, title: n, type: 'nationality', iconType: 'flag', iconValue: n, matchingRule: n }));

  const clubs = [...tally((p) => p.clubs).entries()]
    .filter(([n, c]) => n && c >= MIN_POOL_MATCHERS)
    .map(([n]): BingoCategory => ({ id: `club_${norm(n)}`, title: `Played for ${n}`, type: 'playedForClub', iconType: 'clubBadge', iconValue: `${n}|${clubLeagues.get(n) ?? 'Premier League'}`, matchingRule: n }));

  const leagues = LEAGUES.map((l): BingoCategory => ({ id: `lge_${norm(l)}`, title: l, type: 'playedInLeague', iconType: 'league', iconValue: l, matchingRule: l }))
    .filter((c) => countMatchers(pool, c) >= MIN_POOL_MATCHERS);

  const trophies = [...TROPHY_CANONICAL_SET]
    .map((t): BingoCategory => ({ id: `trophy_${norm(t)}`, title: `${t} Winner`, type: 'wonCompetition', iconType: 'trophy', iconValue: t, matchingRule: t }))
    .filter((c) => countMatchers(pool, c) >= MIN_POOL_MATCHERS);

  const stats = STAT_DEFS
    .map((s): BingoCategory => ({ id: `stat_${norm(s.rule)}`, title: s.title, type: 'statThreshold', iconType: 'custom', iconValue: s.icon, matchingRule: s.rule }))
    .filter((c) => countMatchers(pool, c) >= MIN_POOL_MATCHERS);

  const positions = POSITIONS
    .map((p): BingoCategory => ({ id: `pos_${norm(p.rule)}`, title: p.title, type: 'position', iconType: 'custom', iconValue: p.abbrev, matchingRule: p.rule }))
    .filter((c) => countMatchers(pool, c) >= MIN_POOL_MATCHERS);

  return {
    nationality: nats,
    playedForClub: clubs,
    playedInLeague: leagues,
    wonCompetition: trophies,
    statThreshold: stats,
    position: positions,
  };
}

export async function generateFootballBingoPuzzle(date: string): Promise<FootballBingoPuzzle> {
  const [pool, clubLeagues] = await Promise.all([loadPool(), loadClubLeagues()]);
  if (pool.length < 50) throw new Error('Not enough players in pool for Football Bingo');

  const seed = hashStr(`${date}:football_bingo`);
  const candidates = buildCandidates(pool, clubLeagues);

  // Target mix (falls back to whatever's available to reach GRID).
  const target: Array<[CatType, number]> = [
    ['nationality', 3],
    ['playedForClub', 4],
    ['playedInLeague', 2],
    ['wonCompetition', 3],
    ['statThreshold', 2],
    ['position', 2],
  ];

  const chosen: BingoCategory[] = [];
  for (const [type, n] of target) {
    if (type === 'playedForClub') {
      const big = candidates[type].filter((c) => BIG_CLUBS.has(norm(c.matchingRule)));
      const rest = candidates[type].filter((c) => !BIG_CLUBS.has(norm(c.matchingRule)));
      const ordered = [...seededShuffle(big, seed), ...seededShuffle(rest, seed ^ 1)];
      chosen.push(...ordered.slice(0, n));
    } else {
      chosen.push(...seededShuffle(candidates[type], seed ^ hashStr(type)).slice(0, n));
    }
  }
  // Top up to GRID from any leftover candidates if a type was short.
  if (chosen.length < GRID) {
    const chosenIds = new Set(chosen.map((c) => c.id));
    const rest = seededShuffle(
      Object.values(candidates).flat().filter((c) => !chosenIds.has(c.id)),
      seed
    );
    chosen.push(...rest.slice(0, GRID - chosen.length));
  }
  const categories = seededShuffle(chosen.slice(0, GRID), seed ^ 0x5eed);

  // Build a solvable queue: top matchers per category by PL apps (proxy for fame).
  const queueIds = new Set<string>();
  const queue: BingoPlayer[] = [];
  for (const cat of categories) {
    const matchers = pool
      .filter((p) => matches(p, cat))
      .sort((a, b) => (b.premierLeagueApps ?? 0) - (a.premierLeagueApps ?? 0))
      .slice(0, MATCHERS_PER_CATEGORY);
    for (const p of matchers) {
      if (!queueIds.has(p.id)) {
        queueIds.add(p.id);
        queue.push(p);
      }
    }
  }
  const players = seededShuffle(queue, seed ^ 0x9f00).slice(0, MAX_QUEUE);

  return {
    modeId: 'football_bingo',
    puzzleId: `${date}-football_bingo`,
    date,
    title: 'Daily Football Bingo',
    categories,
    players,
  };
}

/** True only if every category has at least one matcher in the queue. */
export function isBingoSolvable(puzzle: FootballBingoPuzzle): { ok: boolean; perCategory: Array<{ title: string; matchers: number }> } {
  const perCategory = puzzle.categories.map((c) => ({
    title: c.title,
    matchers: puzzle.players.filter((p) => matches(p, c)).length,
  }));
  return { ok: perCategory.every((c) => c.matchers >= 1), perCategory };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);
  generateFootballBingoPuzzle(date)
    .then((puzzle) => {
      console.log(`\n=== FOOTBALL BINGO ${date} — ${puzzle.categories.length} categories, ${puzzle.players.length} players ===\n`);
      const check = isBingoSolvable(puzzle);
      for (const c of check.perCategory) {
        const flag = c.matchers === 0 ? '❌' : c.matchers < 3 ? '⚠️ ' : '✅';
        console.log(`  ${flag} ${c.title.padEnd(28)} ${c.matchers} matchers`);
      }
      console.log(`\nSolvable: ${check.ok ? 'YES ✅' : 'NO ❌'}`);
      console.log('Sample players:', puzzle.players.slice(0, 8).map((p) => p.name).join(', '));
      process.exit(check.ok ? 0 : 1);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
