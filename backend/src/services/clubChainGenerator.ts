/**
 * Club Chain generator + validator.
 *
 * The game: connect a START player to a TARGET player through a chain of players who were CLUB
 * TEAMMATES — i.e. two adjacent players shared the same club (same team_id) during overlapping
 * seasons. National-team links, same-league links, same-manager links and same-club-in-different-
 * eras links do NOT count — only real club-teammate overlap.
 *
 * Data source: `player_career` (team_id + season_from/season_to, one row per club spell). team_id is
 * an API-Football id, so the same club always shares an id (and a crest via the CDN) regardless of
 * name spelling. National / national-youth teams are filtered out (a shared country side is exactly
 * the "same nationality" link the game forbids).
 *
 * Two things live here:
 *   1. `clubChainLink(aId, bId)` — pairwise areTeammates, used live by the play endpoint to validate
 *      every move against the FULL player database (any player is searchable / linkable).
 *   2. `generateClubChainPuzzle(date)` — builds a teammate graph over a recognisable player pool,
 *      BFS-picks a start/target pair at the day's difficulty, and stores the shortest path as the
 *      scoring "par".
 *
 * Dry run: DATABASE_URL=... npx tsx src/services/clubChainGenerator.ts [date]
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { clubTeamIds, isNationalTeam, nationSet } from '../utils/nationalTeam.js';
import { resolveHeadshot, teamLogoUrl } from '../constants/footballMedia.js';
import { getPhotoOverrides } from './photoOverrides.js';

// A club spell: which club (team_id + name) and the year range the player was there for.
// season_to === null means the player is still at the club → treated as the current year.
export interface ClubSpell {
  clubId: number;
  clubName: string;
  startYear: number;
  endYear: number; // null spells resolved to CURRENT_YEAR
}

// The confirmation returned after a valid move ("✓ Shared Real Madrid, 2013–2015").
export interface TeammateLink {
  clubId: number;
  clubName: string;
  overlapStart: string; // YYYY
  overlapEnd: string; // YYYY
  clubBadgeUrl?: string;
}

export interface ClubChainPlayerCard {
  id: string;
  name: string;
  club: string; // current/most-recent club, for the card subtitle
  nationality: string;
  position: string;
  headshotUrl?: string;
}

export type ClubChainDifficulty = 'easy' | 'medium' | 'hard';

export interface ClubChainPuzzlePublic {
  modeId: 'club_chain';
  puzzleId: string;
  date: string;
  difficulty: ClubChainDifficulty;
  start: ClubChainPlayerCard;
  target: ClubChainPlayerCard;
  /** Shortest teammate path length in EDGES (links). The scoring "par". */
  shortestPathLength: number;
  /** Max players the user may add before failing (= shortestPathLength + 4). */
  maxMoves: number;
  /** Wrong (non-teammate) attempts allowed before failing. */
  mistakesAllowed: number;
}

export interface ClubChainPuzzleAnswer {
  modeId: 'club_chain';
  shortestPathPlayerIds: string[]; // start … target (one valid optimal route)
  shortestPathLength: number;
}

const CURRENT_YEAR = new Date().getUTCFullYear();
const MISTAKES_ALLOWED = 3;
const EXTRA_MOVES = 4; // maxMoves = shortestPathLength + EXTRA_MOVES

// Difficulty, measured in shortest-path EDGES (links = the scoring par).
//
// NOTE on the numbers: the real club-teammate graph among recognisable players is a *tiny-diameter*
// small-world graph — measured on this DB, ~99% of famous-player pairs sit at distance 2–3 and
// almost nothing exists beyond distance 4 (see `--stats`). Football stars genuinely are "3 hops
// from everyone". So the honest, achievable bands are: easy = one connector (par 2), medium = two
// (par 3), hard = three (par 4+, deliberately rarer). This keeps the game about RECALLING the right
// connector rather than an impossible 7-deep chain that no real teammate data supports.
const DIFFICULTY_CYCLE: ClubChainDifficulty[] = ['easy', 'medium', 'hard'];

// Every node in the graph must be at least reasonably recognisable (tier ≥ POOL_TIER) so it works
// as a connector. The two ENDPOINTS are chosen from the most FAMOUS players only (top of a prestige
// ranking that blends market value with major finals + individual awards), so a puzzle always reads
// as "remember these two careers" — never an obscure high-market-value name.
const POOL_TIER = 3;
const ENDPOINT_POOL_SIZE = 700; // # most-prestigious players eligible to be start/target
const MIN_DEGREE = 3; // endpoints need several teammate links, never a near-dead-end

/** Recognisability score: market value tier + major-final appearances + individual awards. Mirrors
 *  the prestige blend the other generators use, so legends (many finals/awards) rank alongside
 *  current stars (high tier) and obscure high-value players fall away. */
function prestigeOf(tier: number, finals: number, awards: number): number {
  return tier * 10 + Math.min(finals, 6) * 5 + Math.min(awards, 5) * 8;
}

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function dayNumber(date: string): number {
  const ms = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.floor(ms / 86_400_000) : 0;
}

/** Seeded Fisher–Yates (LCG) — deterministic per seed, no Math.random. */
function seededShuffle<T>(arr: T[], seed: number): T[] {
  const r = [...arr];
  let state = BigInt(seed === 0 ? 1 : seed);
  for (let i = r.length - 1; i > 0; i -= 1) {
    state = (state * 6364136223846793005n + 1n) & ((1n << 64n) - 1n);
    const j = Number(state % BigInt(i + 1));
    [r[i], r[j]] = [r[j]!, r[i]!];
  }
  return r;
}

// ---- National / national-youth team filtering --------------------------------------------------
// A shared national (or national-youth) team is exactly the "same nationality" link the game
// forbids, so those spells must never form a teammate edge. Club reserve/B/youth sides ARE real
// clubs (playing together there is a genuine link) and are kept.
//
// The filter lives in utils/nationalTeam so one rule serves every caller. It has to cut both ways:
// country names appear in several spellings ("Rep. Of Ireland"), while some real clubs are named after
// a country (AS Monaco) and must NOT be discarded — hence the league_id escape via clubTeamIds().

// ---- Pairwise areTeammates (live validation) ---------------------------------------------------

interface CareerRow {
  player_id: string;
  team_id: number;
  team_name: string;
  season_from: number;
  season_to: number | null;
}

async function loadSpells(playerIds: string[], nations: Set<string>): Promise<Map<string, ClubSpell[]>> {
  const map = new Map<string, ClubSpell[]>();
  if (playerIds.length === 0) return map;
  const clubs = await clubTeamIds();
  const list = sql.join(playerIds.map((id) => sql`${id}::uuid`), sql`, `);
  const rows = (await db.execute(sql`
    SELECT player_id, team_id, team_name, season_from, season_to
    FROM player_career WHERE player_id IN (${list}) AND team_id > 0
  `)) as unknown as CareerRow[];
  for (const r of rows) {
    if (!clubs.has(Number(r.team_id)) && isNationalTeam(r.team_name, nations)) continue;
    const spell: ClubSpell = {
      clubId: r.team_id,
      clubName: r.team_name,
      startYear: r.season_from,
      endYear: r.season_to ?? CURRENT_YEAR,
    };
    (map.get(r.player_id) ?? map.set(r.player_id, []).get(r.player_id)!).push(spell);
  }
  return map;
}

/** Do two spells at the same club overlap by at least one season/year? */
export function spellsOverlap(a: ClubSpell, b: ClubSpell): boolean {
  return a.clubId === b.clubId && a.startYear <= b.endYear && b.startYear <= a.endYear;
}

/** The best shared-club overlap between two spell lists, or null. "Best" = longest overlap, then
 *  most recent — the most memorable era the two actually played together. */
export function bestTeammateLink(aSpells: ClubSpell[], bSpells: ClubSpell[]): TeammateLink | null {
  let best: { link: TeammateLink; span: number; recency: number } | null = null;
  for (const a of aSpells) {
    for (const b of bSpells) {
      if (!spellsOverlap(a, b)) continue;
      const overlapStart = Math.max(a.startYear, b.startYear);
      const overlapEnd = Math.min(a.endYear, b.endYear);
      const span = overlapEnd - overlapStart;
      if (best && (span < best.span || (span === best.span && overlapStart <= best.recency))) continue;
      best = {
        link: {
          clubId: a.clubId,
          clubName: a.clubName,
          overlapStart: String(overlapStart),
          overlapEnd: String(overlapEnd),
          clubBadgeUrl: teamLogoUrl(a.clubId),
        },
        span,
        recency: overlapStart,
      };
    }
  }
  return best?.link ?? null;
}

/**
 * areTeammates(playerAId, playerBId): the core rule. Returns the shared-club overlap link, or null
 * if the two were never club teammates (validates a live move against the full player database).
 */
export async function clubChainLink(aId: string, bId: string): Promise<TeammateLink | null> {
  if (aId === bId) return null;
  const nations = await nationSet();
  const spells = await loadSpells([aId, bId], nations);
  const a = spells.get(aId);
  const b = spells.get(bId);
  if (!a || !b) return null;
  return bestTeammateLink(a, b);
}

// ---- Graph build + BFS (puzzle generation) -----------------------------------------------------

interface PoolPlayer {
  id: string;
  name: string;
  club: string;
  league: string;
  nationality: string;
  position: string;
  tier: number;
  prestige: number;
  birthYear: number | null;
  apiFootballId: number | null;
  photoUrl: string | null;
}

interface Graph {
  adj: Map<string, Set<string>>;
  players: Map<string, PoolPlayer>;
}

async function buildGraph(): Promise<Graph> {
  const nations = await nationSet();

  const playerRows = (await db.execute(sql`
    SELECT p.id, p.name, p.current_club, p.current_league, p.nationality, p.position,
           p.market_value_tier AS tier, p.api_football_id, p.photo_url,
           EXTRACT(YEAR FROM p.birth_date)::int AS birth_year,
           COALESCE(fa.finals, 0)::int AS finals, COALESCE(aw.awards, 0)::int AS awards
    FROM players p
    LEFT JOIN (SELECT player_id, COUNT(*) AS finals FROM final_appearances GROUP BY player_id) fa ON fa.player_id = p.id
    LEFT JOIN (SELECT player_id, COUNT(*) AS awards FROM player_awards GROUP BY player_id) aw ON aw.player_id = p.id
    WHERE p.market_value_tier >= ${POOL_TIER} AND p.external_id IS NOT NULL
  `)) as unknown as Array<{
    id: string; name: string; current_club: string; current_league: string; nationality: string;
    position: string; tier: number; api_football_id: number | null; photo_url: string | null;
    birth_year: number | null; finals: number; awards: number;
  }>;

  const players = new Map<string, PoolPlayer>();
  for (const r of playerRows) {
    players.set(r.id, {
      id: r.id, name: r.name, club: r.current_club, league: r.current_league, nationality: r.nationality,
      position: r.position, tier: r.tier, prestige: prestigeOf(r.tier, r.finals, r.awards),
      birthYear: r.birth_year, apiFootballId: r.api_football_id, photoUrl: r.photo_url,
    });
  }

  const ids = [...players.keys()];
  const list = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
  const careerRows = (await db.execute(sql`
    SELECT player_id, team_id, team_name, season_from, season_to
    FROM player_career WHERE team_id > 0 AND player_id IN (${list})
  `)) as unknown as CareerRow[];

  // Group non-national spells by club so we only compare within-club rosters.
  const clubs = await clubTeamIds();
  const byClub = new Map<number, Array<{ id: string; from: number; to: number }>>();
  for (const r of careerRows) {
    if (!players.has(r.player_id)) continue;
    if (!clubs.has(Number(r.team_id)) && isNationalTeam(r.team_name, nations)) continue;
    const spell = { id: r.player_id, from: r.season_from, to: r.season_to ?? CURRENT_YEAR };
    (byClub.get(r.team_id) ?? byClub.set(r.team_id, []).get(r.team_id)!).push(spell);
  }

  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (a === b) return;
    (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b);
    (adj.get(b) ?? adj.set(b, new Set()).get(b)!).add(a);
  };
  for (const roster of byClub.values()) {
    for (let i = 0; i < roster.length; i += 1) {
      for (let j = i + 1; j < roster.length; j += 1) {
        const p = roster[i]!;
        const q = roster[j]!;
        if (p.from <= q.to && q.from <= p.to) link(p.id, q.id);
      }
    }
  }

  return { adj, players };
}

/** BFS from `start`; returns distance + parent maps, plus a COUNT of distinct shortest paths to each
 *  node (capped) — the "bridge rarity" signal that drives difficulty. */
function bfs(
  graph: Graph,
  start: string
): { dist: Map<string, number>; parent: Map<string, string>; spCount: Map<string, number> } {
  const SP_CAP = 100_000; // avoid unbounded counts through mega-hubs
  const dist = new Map<string, number>([[start, 0]]);
  const parent = new Map<string, string>();
  const spCount = new Map<string, number>([[start, 1]]);
  const queue: string[] = [start];
  let head = 0;
  while (head < queue.length) {
    const node = queue[head++]!;
    const d = dist.get(node)!;
    const nodeCount = spCount.get(node)!;
    for (const next of graph.adj.get(node) ?? []) {
      const nd = dist.get(next);
      if (nd === undefined) {
        dist.set(next, d + 1);
        parent.set(next, node);
        spCount.set(next, nodeCount);
        queue.push(next);
      } else if (nd === d + 1) {
        spCount.set(next, Math.min(SP_CAP, (spCount.get(next) ?? 0) + nodeCount));
      }
    }
  }
  return { dist, parent, spCount };
}

const POSITION_GROUP: Record<string, string> = {
  Goalkeeper: 'GK', Defender: 'DEF', Midfielder: 'MID', Attacker: 'ATT', Forward: 'ATT',
};
function positionGroup(pos: string): string {
  return POSITION_GROUP[pos] ?? pos;
}

/**
 * Difficulty of a candidate puzzle — NOT its length (the graph is too dense for length to matter),
 * but how hard the CONNECTION is to recall. Higher = harder. Blends:
 *   • bridge rarity   — few distinct shortest paths ⇒ you must recall the specific link
 *   • era gap         — a modern star ↔ a retired legend is much harder to bridge
 *   • league/position — endpoints in different leagues/roles feel less "obviously" connected
 *   • connector depth — an obscure required bridge is harder than a superstar hub
 *   • length          — a longer par adds a little difficulty
 * Puzzles are later bucketed by percentile, so the absolute scale doesn't need calibrating.
 */
function difficultyScore(
  graph: Graph,
  start: PoolPlayer,
  target: PoolPlayer,
  par: number,
  spCount: number,
  path: string[]
): number {
  let score = (par - 2) * 14;

  // Bridge rarity — the single biggest lever.
  if (spCount <= 1) score += 42;
  else if (spCount <= 3) score += 30;
  else if (spCount <= 8) score += 20;
  else if (spCount <= 20) score += 10;
  else if (spCount <= 60) score += 4;

  // Era gap between the two endpoints.
  if (start.birthYear && target.birthYear) {
    score += Math.min(Math.abs(start.birthYear - target.birthYear), 16) * 1.8;
  }
  // Different worlds → less obvious.
  if (start.league && target.league && start.league !== target.league) score += 6;
  if (positionGroup(start.position) !== positionGroup(target.position)) score += 4;
  if (start.nationality !== target.nationality) score += 2;

  // Obscurity of the required bridge (least-famous interior node on the optimal path).
  const interior = path.slice(1, -1).map((id) => graph.players.get(id)?.prestige ?? 60);
  if (interior.length > 0) {
    const minPrest = Math.min(...interior);
    score += Math.max(0, Math.min(1, (60 - minPrest) / 60)) * 16;
  }
  return score;
}

function reconstructPath(parent: Map<string, string>, start: string, target: string): string[] {
  const path: string[] = [target];
  let node = target;
  while (node !== start) {
    const p = parent.get(node);
    if (p === undefined) return [];
    path.push(p);
    node = p;
  }
  return path.reverse();
}

export interface ClubChainShortestPath {
  shortestPathPlayerIds: string[];
  shortestPathLength: number;
}

/**
 * Recompute an honest shortest path using the same teammate graph as puzzle generation.
 * Endpoints outside the recognisable connector pool return null rather than a fabricated path.
 */
export async function recomputeClubChainShortestPath(
  startPlayerId: string,
  targetPlayerId: string
): Promise<ClubChainShortestPath | null> {
  if (startPlayerId === targetPlayerId) return null;
  const graph = await buildGraph();
  if (!graph.players.has(startPlayerId) || !graph.players.has(targetPlayerId)) return null;
  const { dist, parent } = bfs(graph, startPlayerId);
  const shortestPathLength = dist.get(targetPlayerId);
  if (shortestPathLength === undefined) return null;
  const shortestPathPlayerIds = reconstructPath(parent, startPlayerId, targetPlayerId);
  if (shortestPathPlayerIds.length !== shortestPathLength + 1) return null;
  return { shortestPathPlayerIds, shortestPathLength };
}

function toCard(p: PoolPlayer, headshot: string | undefined): ClubChainPlayerCard {
  return {
    id: p.id,
    name: p.name,
    club: p.club,
    nationality: p.nationality,
    position: p.position,
    headshotUrl: headshot,
  };
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

export async function generateClubChainPuzzle(
  date: string,
  opts?: { excludePairKeys?: Set<string> }
): Promise<{ puzzle: ClubChainPuzzlePublic; answer: ClubChainPuzzleAnswer } | null> {
  const graph = await buildGraph();
  const seed = hashString(`${date}:club_chain`);

  // Endpoint-eligible: the most FAMOUS players (top of the prestige ranking) that are also
  // well-connected (never a near-dead-end). This keeps start/target genuinely recognisable.
  const eligible = [...graph.players.values()]
    .filter((p) => (graph.adj.get(p.id)?.size ?? 0) >= MIN_DEGREE)
    .sort((a, b) => b.prestige - a.prestige)
    .slice(0, ENDPOINT_POOL_SIZE);
  if (eligible.length < 2) return null;

  const dayDifficulty = DIFFICULTY_CYCLE[dayNumber(date) % DIFFICULTY_CYCLE.length]!;
  const eligibleIds = new Set(eligible.map((p) => p.id));

  // Sample a seeded-jittered, prestige-weighted set of famous starts (most famous lead, varied by
  // day) and enumerate candidate puzzles to famous targets at par 2–4. Difficulty is decided by a
  // recall-hardness score (bridge rarity, era/league gap, connector obscurity) — see difficultyScore.
  const rankedStarts = [...eligible].sort((a, b) => b.prestige - a.prestige);
  const startOrder = rankedStarts
    .map((p, i) => ({ p, k: i + (hashString(`${date}:start:${p.id}`) % 6000) / 100 }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.p);

  interface Candidate {
    start: PoolPlayer; target: PoolPlayer; par: number; path: string[]; score: number;
  }
  const candidates: Candidate[] = [];
  const seenPair = new Set<string>();
  const START_SAMPLE = 160;
  const TARGETS_PER_START = 4;

  for (const start of startOrder.slice(0, START_SAMPLE)) {
    const { dist, parent, spCount } = bfs(graph, start.id);
    for (const par of [2, 3, 4]) {
      const atDist = [...dist.entries()]
        .filter(([id, d]) => d === par && id !== start.id && eligibleIds.has(id))
        .map(([id]) => id);
      if (atDist.length === 0) continue;
      // Prefer recognisable targets, varied by seed, so the far endpoint isn't a fringe name.
      atDist.sort((a, b) => graph.players.get(b)!.prestige - graph.players.get(a)!.prestige);
      const pool = atDist.slice(0, Math.max(20, Math.ceil(atDist.length * 0.3)));
      const picks = seededShuffle(pool, hashString(`${date}:${start.id}:${par}`)).slice(0, TARGETS_PER_START);
      for (const targetId of picks) {
        const key = [start.id, targetId].sort().join('|');
        if (seenPair.has(key)) continue;
        seenPair.add(key);
        const path = reconstructPath(parent, start.id, targetId);
        if (path.length !== par + 1) continue;
        const target = graph.players.get(targetId)!;
        const score = difficultyScore(graph, start, target, par, spCount.get(targetId) ?? 1, path);
        candidates.push({ start, target, par, path, score });
      }
    }
  }
  if (candidates.length === 0) return null;

  // Bucket by difficulty percentile so easy/medium/hard are always well-populated regardless of the
  // absolute score scale, then pick one from the day's bucket (seeded).
  candidates.sort((a, b) => a.score - b.score);
  const n = candidates.length;
  const bucket =
    dayDifficulty === 'easy'
      ? candidates.slice(0, Math.ceil(n / 3))
      : dayDifficulty === 'medium'
        ? candidates.slice(Math.floor(n / 3), Math.ceil((2 * n) / 3))
        : candidates.slice(Math.floor((2 * n) / 3));
  let pool = bucket.length > 0 ? bucket : candidates;
  if (opts?.excludePairKeys?.size) {
    const filtered = pool.filter((c) => !opts.excludePairKeys!.has(pairKey(c.start.id, c.target.id)));
    if (filtered.length > 0) pool = filtered;
  }
  const chosen = seededShuffle(pool, seed)[0]!;

  const overrides = await getPhotoOverrides();
  const startCard = toCard(chosen.start, resolveHeadshot(overrides.get(chosen.start.id), chosen.start.apiFootballId) ?? undefined);
  const targetCard = toCard(chosen.target, resolveHeadshot(overrides.get(chosen.target.id), chosen.target.apiFootballId) ?? undefined);
  const shortestPathLength = chosen.par;

  const puzzle: ClubChainPuzzlePublic = {
    modeId: 'club_chain',
    puzzleId: `${date}-club_chain`,
    date,
    difficulty: dayDifficulty,
    start: startCard,
    target: targetCard,
    shortestPathLength,
    maxMoves: shortestPathLength + EXTRA_MOVES,
    mistakesAllowed: MISTAKES_ALLOWED,
  };
  const answer: ClubChainPuzzleAnswer = {
    modeId: 'club_chain',
    shortestPathPlayerIds: chosen.path,
    shortestPathLength,
  };
  return { puzzle, answer };
}

/** Restrict a graph's adjacency to a given node set (drop edges to everyone else). */
function subgraph(graph: Graph, keep: Set<string>): Graph {
  const adj = new Map<string, Set<string>>();
  for (const id of keep) {
    const nbrs = new Set<string>();
    for (const n of graph.adj.get(id) ?? []) if (keep.has(n)) nbrs.add(n);
    adj.set(id, nbrs);
  }
  return { adj, players: graph.players };
}

/** Diagnostic: distance distribution among famous endpoints for a few connector-pool sizes. */
async function distanceStats(): Promise<void> {
  const graph = await buildGraph();
  const ranked = [...graph.players.values()]
    .filter((p) => (graph.adj.get(p.id)?.size ?? 0) >= MIN_DEGREE)
    .sort((a, b) => b.prestige - a.prestige);
  console.log(`Full graph: ${graph.players.size} nodes (tier ≥ ${POOL_TIER})`);

  // Compare: connectors from the FULL pool vs a FAMOUS-ONLY subgraph of the top-N players.
  for (const famousN of [400, 700, 1200]) {
    const keep = new Set(ranked.slice(0, famousN).map((p) => p.id));
    const g = subgraph(graph, keep);
    const endpoints = ranked.slice(0, 700).filter((p) => keep.has(p.id)).slice(0, 200);
    const endpointIds = new Set(ranked.slice(0, 700).map((p) => p.id));
    const hist = new Map<number, number>();
    let unreachable = 0;
    for (const start of endpoints) {
      const { dist } = bfs(g, start.id);
      for (const id of keep) {
        if (id === start.id || !endpointIds.has(id)) continue;
        const d = dist.get(id);
        if (d === undefined) unreachable += 1;
        else hist.set(d, (hist.get(d) ?? 0) + 1);
      }
    }
    const line = [...hist.keys()].sort((a, b) => a - b).map((d) => `d${d}:${hist.get(d)}`).join('  ');
    console.log(`\nFamous-only connectors top-${famousN}: ${line}  (unreachable pairs: ${unreachable})`);
  }
}

// ---- CLI preview -------------------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}` && process.argv.includes('--stats')) {
  distanceStats().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
} else if (import.meta.url === `file://${process.argv[1]}`) {
  const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);
  generateClubChainPuzzle(date)
    .then(async (result) => {
      if (!result) {
        console.log('No viable Club Chain puzzle for', date);
        process.exit(1);
      }
      const { puzzle, answer } = result;
      console.log(`\n=== CLUB CHAIN ${date} === [${puzzle.difficulty}]  par ${puzzle.shortestPathLength} links · max ${puzzle.maxMoves} moves`);
      console.log(`START : ${puzzle.start.name} (${puzzle.start.nationality})`);
      console.log(`TARGET: ${puzzle.target.name} (${puzzle.target.nationality})`);
      console.log('\nOne optimal route (with the shared clubs):');
      const nations = await nationSet();
      const spells = await loadSpells(answer.shortestPathPlayerIds, nations);
      const nameById = new Map<string, string>();
      const rows = (await db.execute(sql`
        SELECT id, name FROM players WHERE id IN (${sql.join(answer.shortestPathPlayerIds.map((id) => sql`${id}::uuid`), sql`, `)})
      `)) as unknown as Array<{ id: string; name: string }>;
      for (const r of rows) nameById.set(r.id, r.name);
      for (let i = 0; i < answer.shortestPathPlayerIds.length; i += 1) {
        const id = answer.shortestPathPlayerIds[i]!;
        console.log(`  ${i + 1}. ${nameById.get(id) ?? id}`);
        if (i < answer.shortestPathPlayerIds.length - 1) {
          const link = bestTeammateLink(spells.get(id) ?? [], spells.get(answer.shortestPathPlayerIds[i + 1]!) ?? []);
          console.log(`       ↓ ${link ? `${link.clubName}, ${link.overlapStart}–${link.overlapEnd}` : '???'}`);
        }
      }
      process.exit(0);
    })
    .catch((err) => { console.error(err); process.exit(1); });
}
