/**
 * World Cup XI daily puzzle generator. Builds a positionally-balanced 4-3-3 of 11 cryptic
 * clues drawn from ACROSS all World Cups (biased to recent tournaments). Each clue names the
 * player's nationality + the year + a feat ("The French midfielder who won the Golden Ball at
 * the 2006 World Cup" → Zidane). The game is "name the player": each correct answer scores —
 * there is no year to guess.
 */
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

// Selection weight per tournament — strong bias toward recent World Cups (more recognisable),
// with classics appearing occasionally.
const YEAR_WEIGHT: Record<number, number> = {
  2022: 34, 2018: 32, 2014: 26, 2010: 22, 2006: 16, 2002: 8, 1998: 5, 1994: 4,
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

function hashString(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) { h = (h << 5) - h + input.charCodeAt(i); h |= 0; }
  return Math.abs(h);
}
interface Cand { playerId: string; name: string; country: string; position: string; year: number; mvt: number; isCaptain: boolean; }
interface Ev { type: string; stage: string; opponent: string; detail: string | null; }
interface Fact { sig: string; score: number; clue: string; }
interface Scored { c: Cand; facts: Fact[]; }

export interface WorldCupXiSlot {
  id: string; label: string; x: number; y: number; expectedName: string; clues: string[];
}
export interface WorldCupXiPuzzleJson {
  modeId: 'world_cup_xi';
  puzzleId: string;
  date: string;
  formation: string;
  title: string;
  slots: WorldCupXiSlot[];
}

/** Gather every (player, tournament) candidate across all World Cups with a ranked clue list. */
async function gatherCandidates(): Promise<Scored[]> {
  const cands = (await db.execute(sql`
    SELECT s.player_id AS "playerId", p.name, s.country, s.position, s.year, p.market_value_tier AS mvt, s.is_captain AS "isCaptain"
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

  return cands.map((c) => ({ c, facts: buildFacts(c) })).filter((x) => x.facts.length);
}

export async function generateWorldCupXiPuzzle(date: string): Promise<WorldCupXiPuzzleJson | null> {
  const all = await gatherCandidates();

  // One entry per player: keep their best (clue strength + fame + recency). This dedupes a
  // player appearing across multiple tournaments to a single, strongest, recency-biased clue.
  const value = (x: Scored) => x.facts[0]!.score + x.c.mvt * 14 + (YEAR_WEIGHT[x.c.year] ?? 4);
  const bestByPlayer = new Map<string, Scored>();
  for (const x of all) {
    const prev = bestByPlayer.get(x.c.playerId);
    if (!prev || value(x) > value(prev)) bestByPlayer.set(x.c.playerId, x);
  }
  const pool = [...bestByPlayer.values()];

  // Deterministic daily shuffle within position buckets, then take the top by value (so the XI
  // varies day to day but stays recognisable + recent-biased).
  const seed = hashString(`${date}:wcxi`);
  const jitter = (x: Scored, i: number) => value(x) + ((hashString(`${seed}:${x.c.playerId}:${i}`) % 100) / 100) * 18;

  const used = new Set<string>();
  const usedSig = new Set<string>();
  const slots: WorldCupXiSlot[] = [];
  const bucketPlayers = (bucket: string) =>
    pool.filter((x) => x.c.position === bucket).map((x, i) => ({ x, j: jitter(x, i) })).sort((a, b) => b.j - a.j);

  const byBucket: Record<string, Array<{ x: Scored; j: number }>> = {
    GK: bucketPlayers('GK'), DF: bucketPlayers('DF'), MF: bucketPlayers('MF'), FW: bucketPlayers('FW'),
  };
  const cursor: Record<string, number> = { GK: 0, DF: 0, MF: 0, FW: 0 };

  for (const pos of LAYOUT) {
    const list = byBucket[pos.bucket]!;
    // advance to the next unused player whose top-available clue sig isn't already used
    while (cursor[pos.bucket]! < list.length) {
      const { x } = list[cursor[pos.bucket]!]!;
      cursor[pos.bucket] += 1;
      if (used.has(x.c.playerId)) continue;
      const fact = x.facts.find((f) => !usedSig.has(f.sig)) ?? x.facts[0]!;
      used.add(x.c.playerId);
      usedSig.add(fact.sig);
      slots.push({ id: `${pos.label}-${slots.length}`, label: pos.label, x: pos.x, y: pos.y, expectedName: x.c.name, clues: [fact.clue] });
      break;
    }
  }
  if (slots.length < 11) return null;

  return {
    modeId: 'world_cup_xi',
    puzzleId: `${date}-world_cup_xi`,
    date,
    formation: '4-3-3',
    title: 'Name the World Cup XI',
    slots,
  };
}
