/**
 * World Cup XI daily puzzle generator. Builds a positionally-balanced 4-3-3 of 11 clues drawn from
 * ACROSS all World Cups. Clues come from the curated, human-QA'd `wc_memorable` bank (authored by
 * Claude, squad-verified, year-stamped) — that bank is the SOLE intended source. A thin data-driven
 * fallback fills a slot only if the curated pool can't (so a thin day never leaves a hole), but on a
 * healthy bank it never fires. The game is "name the player": each correct answer scores.
 */
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { resolveClubLogo } from './teamService.js';
import { recentWcxiPlayerYears, wcxiPlayerYearKey } from './puzzleHistory.js';
import { mergeSubPositions } from './playerPositionService.js';

/** Bump when the puzzle JSON shape/source changes so stored puzzles regenerate. */
export const WCXI_VERSION = 4;

/** A player+tournament from a recent XI is skipped (relaxed only if slots can't fill). */
const WCXI_REPEAT_WINDOW_DAYS = 30;

// Selection weight per tournament — strong bias toward recent World Cups (more recognisable),
// with classics appearing occasionally.
const YEAR_WEIGHT: Record<number, number> = {
  2026: 38, 2022: 34, 2018: 32, 2014: 26, 2010: 22, 2006: 16, 2002: 8, 1998: 5, 1994: 4,
};

const DEMONYM: Record<string, string> = {
  Argentina: 'Argentine', Brazil: 'Brazilian', France: 'French', Germany: 'German', Italy: 'Italian',
  Spain: 'Spanish', England: 'English', Netherlands: 'Dutch', Portugal: 'Portuguese', Belgium: 'Belgian',
  Croatia: 'Croatian', Uruguay: 'Uruguayan', Colombia: 'Colombian', Mexico: 'Mexican', Switzerland: 'Swiss',
  Sweden: 'Swedish', Denmark: 'Danish', Poland: 'Polish', Russia: 'Russian', Japan: 'Japanese',
  'South Korea': 'South Korean', 'United States': 'American', Ghana: 'Ghanaian', Nigeria: 'Nigerian',
  Senegal: 'Senegalese', Morocco: 'Moroccan', Cameroon: 'Cameroonian', 'Ivory Coast': 'Ivorian',
  Serbia: 'Serbian', 'Czech Republic': 'Czech', Greece: 'Greek', Turkey: 'Turkish', Ukraine: 'Ukrainian',
  Chile: 'Chilean', Ecuador: 'Ecuadorian', Paraguay: 'Paraguayan', 'Costa Rica': 'Costa Rican',
  Australia: 'Australian', Wales: 'Welsh', Scotland: 'Scottish', 'Republic of Ireland': 'Irish',
  'Saudi Arabia': 'Saudi', Iran: 'Iranian', Tunisia: 'Tunisian', Algeria: 'Algerian', Egypt: 'Egyptian',
  Slovakia: 'Slovak', Slovenia: 'Slovenian', Bulgaria: 'Bulgarian', Romania: 'Romanian', Norway: 'Norwegian',
  Honduras: 'Honduran', 'Bosnia and Herzegovina': 'Bosnian', Peru: 'Peruvian', Iceland: 'Icelandic',
  Qatar: 'Qatari', Panama: 'Panamanian', 'FR Yugoslavia': 'Yugoslav', Yugoslavia: 'Yugoslav',
};
const demonym = (country: string): string => DEMONYM[country] ?? country;

// 4-3-3 pitch layout (normalised), GK at bottom — matches the iOS pitch coordinate space.
const LAYOUT: Array<{ label: string; x: number; y: number; bucket: 'GK' | 'DF' | 'MF' | 'FW' }> = [
  { label: 'GK', x: 0.50, y: 0.88, bucket: 'GK' },
  { label: 'RB', x: 0.82, y: 0.72, bucket: 'DF' },
  { label: 'CB', x: 0.62, y: 0.78, bucket: 'DF' },
  { label: 'CB', x: 0.38, y: 0.78, bucket: 'DF' },
  { label: 'LB', x: 0.18, y: 0.72, bucket: 'DF' },
  { label: 'CM', x: 0.30, y: 0.52, bucket: 'MF' },
  { label: 'CM', x: 0.50, y: 0.48, bucket: 'MF' },
  { label: 'CM', x: 0.70, y: 0.52, bucket: 'MF' },
  { label: 'RW', x: 0.78, y: 0.28, bucket: 'FW' },
  { label: 'ST', x: 0.50, y: 0.14, bucket: 'FW' },
  { label: 'LW', x: 0.22, y: 0.28, bucket: 'FW' },
];

const TOP5 = new Map<number, string>([[39, 'the Premier League'], [140, 'La Liga'], [135, 'Serie A'], [78, 'the Bundesliga'], [61, 'Ligue 1']]);
const AWARD_SHORT: Record<string, string> = {
  'World Cup Golden Ball': 'Golden Ball', 'World Cup Golden Boot': 'Golden Boot',
  'World Cup Golden Glove': 'Golden Glove', 'World Cup Young Player': 'Best Young Player award',
};
const POS_WORD: Record<string, string> = { GK: 'goalkeeper', DF: 'defender', MF: 'midfielder', FW: 'forward' };

// Transfermarkt sub_position → the fine pitch slot it can fill in a 4-3-3.
const SUBPOS_SLOT: Record<string, string> = {
  Goalkeeper: 'GK',
  'Right-Back': 'RB', 'Left-Back': 'LB', 'Centre-Back': 'CB',
  'Defensive Midfield': 'CM', 'Central Midfield': 'CM', 'Attacking Midfield': 'CM',
  'Right Winger': 'RW', 'Right Midfield': 'RW',
  'Left Winger': 'LW', 'Left Midfield': 'LW',
  'Centre-Forward': 'ST', 'Second Striker': 'ST',
};

function hashString(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) { h = (h << 5) - h + input.charCodeAt(i); h |= 0; }
  return Math.abs(h);
}
interface Cand { playerId: string; name: string; country: string; position: string; subPosition: string | null; subPositions: string[]; year: number; mvt: number; isCaptain: boolean; club: string | null; }
interface Ev { type: string; stage: string; opponent: string; detail: string | null; }
interface Fact { sig: string; score: number; clue: string; }
interface Scored { c: Cand; facts: Fact[]; }

export interface WorldCupXiSlot {
  id: string; label: string; x: number; y: number; expectedName: string; clues: string[];
  // Shown to the player ABOVE the clue: the tournament year, the club they were at THEN (+ crest),
  // and their nation (rendered as a flag emoji on the client).
  year: number; club: string | null; clubBadgeUrl: string | null; nation: string;
}
export interface WorldCupXiPuzzleJson {
  modeId: 'world_cup_xi';
  puzzleId: string;
  date: string;
  version: number;
  formation: string;
  title: string;
  slots: WorldCupXiSlot[];
}

/**
 * The curated bank — Claude-authored, squad-verified, year-stamped clues. One candidate per
 * (player, year) so a player can surface with different clues on different days; the `used` set keeps
 * a player to one slot per XI. Each clue gets a UNIQUE signature so a full XI of curated clues can
 * render (the old shared 'memorable' sig let only one curated clue appear per puzzle).
 */
async function gatherMemorable(): Promise<Scored[]> {
  const rows = (await db.execute(sql`
    SELECT m.player_id AS "playerId", p.name, m.position, p.sub_position AS "subPosition",
           COALESCE(p.sub_positions, ARRAY[]::text[]) AS "subPositions",
           m.year, COALESCE(p.market_value_tier, 0) AS mvt, m.clue, s.club AS club, s.country AS country
    FROM wc_memorable m
    JOIN players p ON p.id = m.player_id
    LEFT JOIN wc_squads s ON s.player_id = m.player_id AND s.year = m.year
    WHERE m.status = 'active' AND m.player_id IS NOT NULL
  `)) as unknown as Array<{ playerId: string; name: string; position: string; subPosition: string | null; subPositions: string[]; year: number; mvt: number; clue: string; club: string | null; country: string | null }>;

  return rows.map((r) => ({
    c: { playerId: r.playerId, name: r.name, country: r.country ?? '', position: r.position, subPosition: r.subPosition, subPositions: r.subPositions ?? [], year: r.year, mvt: r.mvt ?? 0, isCaptain: false, club: r.club },
    facts: [{ sig: `mem:${r.playerId}:${r.year}`, score: 200, clue: r.clue }],
  }));
}

/**
 * Data-driven fallback pool (goals / awards / captaincy / career flavour), deduped to one best clue
 * per player. Used ONLY to fill a slot the curated bank couldn't — never the primary source.
 */
async function gatherDataFallback(): Promise<Scored[]> {
  const cands = (await db.execute(sql`
    SELECT s.player_id AS "playerId", p.name, s.country, s.position, p.sub_position AS "subPosition",
           COALESCE(p.sub_positions, ARRAY[]::text[]) AS "subPositions",
           s.year, COALESCE(p.market_value_tier, 0) AS mvt, s.is_captain AS "isCaptain", s.club AS club
    FROM wc_squads s JOIN players p ON p.id = s.player_id
    WHERE s.position IN ('GK','DF','MF','FW')
  `)) as unknown as Cand[];

  const awards = (await db.execute(sql`
    SELECT player_id AS "playerId", year, award FROM player_awards WHERE award LIKE 'World Cup %' AND player_id IS NOT NULL
  `)) as unknown as Array<{ playerId: string; year: number; award: string }>;
  const awardBy = new Map(awards.map((a) => [`${a.playerId}|${a.year}`, a.award]));

  const events = (await db.execute(sql`
    SELECT player_id AS "playerId", year, type, stage, opponent, detail FROM wc_match_events WHERE player_id IS NOT NULL
  `)) as unknown as Array<Ev & { playerId: string; year: number }>;
  const evBy = new Map<string, Ev[]>();
  for (const e of events) (evBy.get(`${e.playerId}|${e.year}`) ?? evBy.set(`${e.playerId}|${e.year}`, []).get(`${e.playerId}|${e.year}`)!).push(e);

  const leagues = (await db.execute(sql`
    SELECT DISTINCT player_id AS "playerId", league_id AS "leagueId" FROM player_stats WHERE league_id IN (39,140,135,78,61)
  `)) as unknown as Array<{ playerId: string; leagueId: number }>;
  const leagueBy = new Map<string, Set<number>>();
  for (const l of leagues) (leagueBy.get(l.playerId) ?? leagueBy.set(l.playerId, new Set()).get(l.playerId)!).add(l.leagueId);

  const multiWc = (await db.execute(sql`
    SELECT player_id AS "playerId", COUNT(DISTINCT season)::int AS n FROM player_stats WHERE league_id = 1 AND goals > 0 GROUP BY player_id
  `)) as unknown as Array<{ playerId: string; n: number }>;
  const wcScored = new Map(multiWc.map((m) => [m.playerId, m.n]));

  const careerFlavor = (id: string): string => {
    const ls = leagueBy.get(id);
    if (ls?.has(39)) return ' who has played in the Premier League';
    for (const [lid, nm] of TOP5) if (ls?.has(lid)) return ` who has played in ${nm}`;
    return '';
  };

  const buildFacts = (c: Cand): Fact[] => {
    const pw = POS_WORD[c.position] ?? 'player';
    const dem = demonym(c.country);
    const evs = evBy.get(`${c.playerId}|${c.year}`) ?? [];
    const cf = careerFlavor(c.playerId);
    const facts: Fact[] = [];
    const y = c.year;

    const award = awardBy.get(`${c.playerId}|${y}`);
    if (award) facts.push({ sig: `award:${award}`, score: 100, clue: `The ${dem} ${pw} who won the ${AWARD_SHORT[award]} at the ${y} World Cup` });

    const byMatch = new Map<string, Ev[]>();
    for (const e of evs.filter((x) => x.type === 'goal')) {
      const k = `${e.stage}|${e.opponent}`;
      (byMatch.get(k) ?? byMatch.set(k, []).get(k)!).push(e);
    }
    for (const [key, gl] of byMatch) {
      const [stage, opp] = key.split('|') as [string, string];
      if (gl.length >= 3) facts.push({ sig: `htk:${opp}`, score: 92, clue: `The ${dem} ${pw} who scored a hat-trick against ${opp} at the ${y} World Cup` });
      else if (gl.length === 2) facts.push({ sig: `brace:${opp}`, score: 74, clue: `The ${dem} ${pw} who scored twice against ${opp} at the ${y} World Cup` });
      if (stage === 'Final') facts.push({ sig: 'final', score: 88, clue: `The ${dem} ${pw} who scored in the ${y} World Cup final` });
      else if (stage === 'Semi-finals') facts.push({ sig: `semi:${opp}`, score: 78, clue: `The ${dem} ${pw} who scored against ${opp} in the semi-final at the ${y} World Cup` });
      else if (stage === 'Quarter-finals') facts.push({ sig: `qf:${opp}`, score: 62, clue: `The ${dem} ${pw} who scored against ${opp} in the quarter-final at the ${y} World Cup` });
      else if (gl.length === 1) facts.push({ sig: `goal:${opp}`, score: 50, clue: `The ${dem} ${pw} who scored against ${opp} at the ${y} World Cup${cf}` });
    }

    if (evs.some((e) => e.type === 'own_goal')) facts.push({ sig: 'og', score: 66, clue: `The ${dem} ${pw} who scored an own goal at the ${y} World Cup${cf}` });
    if (evs.some((e) => e.type === 'shootout_pen' && e.detail === 'scored')) facts.push({ sig: 'so', score: 48, clue: `The ${dem} ${pw} who scored a penalty in a shootout at the ${y} World Cup${cf}` });

    const wcN = wcScored.get(c.playerId) ?? 0;
    if (wcN >= 3) facts.push({ sig: 'multiwc', score: 64, clue: `The ${dem} ${pw} who has scored at ${wcN} different World Cups${cf}` });
    if (c.isCaptain) facts.push({ sig: 'captain', score: 44, clue: `The ${dem} ${pw} who captained ${c.country} at the ${y} World Cup` });

    if (cf) facts.push({ sig: 'career', score: 16 + c.mvt, clue: `The ${dem} ${pw}${cf} at the ${y} World Cup` });
    return facts.sort((a, b) => b.score - a.score);
  };

  const scored = cands.map((c) => ({ c, facts: buildFacts(c) })).filter((x) => x.facts.length);
  // One entry per player: keep their best (clue strength + fame + recency).
  const value = (x: Scored) => x.facts[0]!.score + x.c.mvt * 8 + (YEAR_WEIGHT[x.c.year] ?? 4);
  const bestByPlayer = new Map<string, Scored>();
  for (const x of scored) {
    const prev = bestByPlayer.get(x.c.playerId);
    if (!prev || value(x) > value(prev)) bestByPlayer.set(x.c.playerId, x);
  }
  return [...bestByPlayer.values()];
}

type Sorted = Array<{ x: Scored; j: number }>;
interface Pools { fine: Record<string, Sorted>; coarse: Record<string, Sorted> }

export async function generateWorldCupXiPuzzle(
  date: string,
  opts?: { recentPlayerYears?: Set<string> }
): Promise<WorldCupXiPuzzleJson | null> {
  const seed = hashString(`${date}:wcxi`);

  // Repeat suppression: a player+tournament used in a recent XI is skipped, forcing selection
  // deeper into the curated bank / data fallback instead of the same top names anchoring every
  // day. If the banks genuinely can't fill a slot without a recent name, the relax pass below
  // allows one rather than failing the day.
  const recentPlayerYears = opts?.recentPlayerYears ?? (await recentWcxiPlayerYears(date, WCXI_REPEAT_WINDOW_DAYS));
  const value = (x: Scored) => x.facts[0]!.score + x.c.mvt * 8 + (YEAR_WEIGHT[x.c.year] ?? 4);
  // Wide deterministic daily jitter so the day's XI rotates through the pool — different almost
  // every day — while the curated clues' high base score keeps the picks recognisable.
  const jitter = (x: Scored, i: number) => value(x) + ((hashString(`${seed}:${x.c.playerId}:${x.c.year}:${i}`) % 1000) / 1000) * 70;
  const finePositions = (x: Scored): string[] => mergeSubPositions(x.c.subPosition, x.c.subPositions);
  const fineSlotMatches = (x: Scored, label: string): boolean =>
    finePositions(x).some((pos) => SUBPOS_SLOT[pos] === label);

  // FINE pools (RB only holds right-backs, etc.) tried first; COARSE pools (any DF/MF/FW) are the
  // fallback so a thin pool never leaves a hole.
  const buildPools = (items: Scored[]): Pools => {
    const sortPool = (filter: (x: Scored) => boolean): Sorted =>
      items.filter(filter).map((x, i) => ({ x, j: jitter(x, i) })).sort((a, b) => b.j - a.j);
    const fine: Record<string, Sorted> = {};
    for (const label of ['GK', 'RB', 'CB', 'LB', 'CM', 'RW', 'LW', 'ST']) fine[label] = sortPool((x) => fineSlotMatches(x, label));
    const coarse: Record<string, Sorted> = {
      GK: sortPool((x) => x.c.position === 'GK'), DF: sortPool((x) => x.c.position === 'DF'),
      MF: sortPool((x) => x.c.position === 'MF'), FW: sortPool((x) => x.c.position === 'FW'),
    };
    return { fine, coarse };
  };

  const used = new Set<string>();
  const usedSig = new Set<string>();
  const usedClues = new Set<string>();
  // Best usable fact for a player: prefer an unused signature AND unused clue text; otherwise any
  // fact whose clue TEXT hasn't been used. Guarantees no two slots ever ship an identical clue
  // (the old code fell back to facts[0], which could duplicate another slot's clue).
  const availableFact = (x: Scored): Fact | null =>
    x.facts.find((f) => !usedSig.has(f.sig) && !usedClues.has(f.clue)) ??
    x.facts.find((f) => !usedClues.has(f.clue)) ??
    null;
  // Each slot targets a tournament year (a date-seeded rotation of the World Cups) so the daily XI
  // spreads across years instead of clumping on the most recent — different spread every day.
  const wcYears = [2006, 2010, 2014, 2018, 2022, 2026];
  const shuffledYears = [...wcYears].sort((a, b) => hashString(`${seed}:y:${a}`) - hashString(`${seed}:y:${b}`));
  const targetYear = (idx: number): number => shuffledYears[idx % shuffledYears.length]!;

  // First unused candidate in the (jitter-sorted) list matching a predicate; null if none.
  const firstUnused = (list: Sorted, pred: (x: Scored) => boolean): Scored | null => {
    for (const { x } of list) if (!used.has(x.c.playerId) && pred(x)) return x;
    return null;
  };

  const result: Array<WorldCupXiSlot | null> = LAYOUT.map(() => null);
  const fillFrom = (pools: Pools, respectRecency: boolean) => {
    const fresh = (c: Scored) => !respectRecency || !recentPlayerYears.has(wcxiPlayerYearKey(c.c.name, c.c.year));
    LAYOUT.forEach((pos, idx) => {
      if (result[idx]) return;
      const fine = pools.fine[pos.label] ?? [];
      const coarse = pools.coarse[pos.bucket]!;
      const wy = targetYear(idx);
      // Prefer the slot's target year (fine → coarse), then fall back to any year (fine → coarse).
      // Only consider a candidate that still has a non-duplicate clue available.
      const usable = (c: Scored) => availableFact(c) !== null;
      const x =
        firstUnused(fine, (c) => c.c.year === wy && fresh(c) && usable(c)) ??
        firstUnused(coarse, (c) => c.c.year === wy && fresh(c) && usable(c)) ??
        firstUnused(fine, (c) => fresh(c) && usable(c)) ??
        firstUnused(coarse, (c) => fresh(c) && usable(c));
      if (!x) return;
      const fact = availableFact(x)!;
      used.add(x.c.playerId);
      usedSig.add(fact.sig);
      usedClues.add(fact.clue);
      result[idx] = {
        id: `${pos.label}-${idx}`, label: pos.label, x: pos.x, y: pos.y,
        expectedName: x.c.name, clues: [fact.clue],
        year: x.c.year, club: x.c.club, clubBadgeUrl: null, nation: x.c.country,
      };
    });
  };

  // Curated bank is the sole intended source.
  const memorablePools = buildPools(await gatherMemorable());
  fillFrom(memorablePools, true);
  // Only touch the data fallback if the curated pool left a hole.
  let fallbackPools: Pools | null = null;
  if (result.some((s) => !s)) {
    fallbackPools = buildPools(await gatherDataFallback());
    fillFrom(fallbackPools, true);
  }
  // Relax pass: if recency exclusion left holes (bank too thin for the window), allow recently
  // used players rather than failing the day.
  if (result.some((s) => !s)) {
    fillFrom(memorablePools, false);
    if (result.some((s) => !s)) {
      fallbackPools ??= buildPools(await gatherDataFallback());
      fillFrom(fallbackPools, false);
    }
  }

  const slots = result.filter((s): s is WorldCupXiSlot => s !== null);
  if (slots.length < 11) return null;

  // Resolve each slot's club crest (the badge shown in the header). Cached per club name; best-effort
  // — a club without a logo match just shows its name.
  const badgeByClub = new Map<string, string | null>();
  for (const s of slots) {
    if (!s.club) continue;
    if (!badgeByClub.has(s.club)) {
      const logo = await resolveClubLogo(s.club);
      badgeByClub.set(s.club, logo?.logoUrl ?? null);
    }
    s.clubBadgeUrl = badgeByClub.get(s.club) ?? null;
  }

  return {
    modeId: 'world_cup_xi',
    puzzleId: `${date}-world_cup_xi`,
    date,
    version: WCXI_VERSION,
    formation: '4-3-3',
    title: 'Name the World Cup XI',
    slots,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);
  generateWorldCupXiPuzzle(date)
    .then((puzzle) => {
      if (!puzzle) { console.log(`No viable World Cup XI for ${date}`); process.exit(1); }
      console.log(`\n=== WORLD CUP XI ${date} — ${puzzle.slots.length} slots ===\n`);
      for (const s of puzzle.slots) console.log(`  ${s.label.padEnd(4)} ${s.expectedName.padEnd(26)} ${s.clues[0]}`);
      const clues = puzzle.slots.map((s) => s.clues[0]);
      const uniqueClues = new Set(clues).size;
      console.log(`\nUnique clues: ${uniqueClues}/${clues.length} ${uniqueClues === clues.length ? 'OK' : 'DUPLICATE!'}`);
      process.exit(uniqueClues === clues.length ? 0 : 1);
    })
    .catch((err) => { console.error(err); process.exit(1); });
}
