/**
 * World Cup XI daily puzzle generator. Builds a positionally-balanced 4-3-3 XI for one World
 * Cup (rotated by date) and auto-generates a cryptic clue for each player from our data
 * (awards, match-level goals/own-goals/shootouts, captaincy, career leagues). The answer the
 * player guesses is the YEAR; host nation / top scorer / winner's captain & manager are the
 * costly "strategic reveal" hints.
 */
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

const WC_YEARS = [1994, 1998, 2002, 2006, 2010, 2014, 2018, 2022];

const HOST: Record<number, string> = {
  1994: 'United States', 1998: 'France', 2002: 'South Korea & Japan', 2006: 'Germany',
  2010: 'South Africa', 2014: 'Brazil', 2018: 'Russia', 2022: 'Qatar',
};
const WINNER: Record<number, string> = {
  1994: 'Brazil', 1998: 'France', 2002: 'Brazil', 2006: 'Italy',
  2010: 'Spain', 2014: 'Germany', 2018: 'France', 2022: 'Argentina',
};

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
function dayNumber(date: string): number {
  const ms = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.floor(ms / 86_400_000) : 0;
}
function withArticle(noun: string): string {
  return `${/^[aeiou]/i.test(noun) ? 'An' : 'A'} ${noun}`;
}

interface Cand { playerId: string; name: string; country: string; position: string; mvt: number; isCaptain: boolean; }
interface Ev { type: string; stage: string; opponent: string; detail: string | null; }
interface Fact { sig: string; score: number; clue: string; }

export interface WorldCupXiSlot {
  id: string; label: string; x: number; y: number; expectedName: string; clues: string[];
}
export interface WorldCupXiPuzzleJson {
  modeId: 'world_cup_xi';
  puzzleId: string;
  date: string;
  id: string;
  country: string;
  year: number;
  formation: string;
  manager: string;
  captain: string;
  hostNation: string;
  topScorerClue: string;
  slots: WorldCupXiSlot[];
}

async function buildXi(year: number): Promise<WorldCupXiSlot[]> {
  const cands = (await db.execute(sql`
    SELECT s.player_id AS "playerId", p.name, s.country, s.position, p.market_value_tier AS mvt, s.is_captain AS "isCaptain"
    FROM wc_squads s JOIN players p ON p.id = s.player_id
    WHERE s.year = ${year} AND s.position IN ('GK','DF','MF','FW')
  `)) as unknown as Cand[];

  const awards = (await db.execute(sql`
    SELECT player_id AS "playerId", award FROM player_awards WHERE year = ${year} AND award LIKE 'World Cup %' AND player_id IS NOT NULL
  `)) as unknown as Array<{ playerId: string; award: string }>;
  const awardBy = new Map(awards.map((a) => [a.playerId, a.award]));

  const events = (await db.execute(sql`
    SELECT player_id AS "playerId", type, stage, opponent, detail FROM wc_match_events WHERE year = ${year} AND player_id IS NOT NULL
  `)) as unknown as Array<Ev & { playerId: string }>;
  const evBy = new Map<string, Ev[]>();
  for (const e of events) (evBy.get(e.playerId) ?? evBy.set(e.playerId, []).get(e.playerId)!).push(e);

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
    const evs = evBy.get(c.playerId) ?? [];
    const cf = careerFlavor(c.playerId);
    const facts: Fact[] = [];

    const award = awardBy.get(c.playerId);
    if (award) facts.push({ sig: `award:${award}`, score: 100, clue: `The ${pw} who won the ${AWARD_SHORT[award]} at the ${year} World Cup` });

    const byMatch = new Map<string, Ev[]>();
    for (const e of evs.filter((x) => x.type === 'goal')) {
      const k = `${e.stage}|${e.opponent}`;
      (byMatch.get(k) ?? byMatch.set(k, []).get(k)!).push(e);
    }
    for (const [key, gl] of byMatch) {
      const [stage, opp] = key.split('|') as [string, string];
      if (gl.length >= 3) facts.push({ sig: `htk:${opp}`, score: 92, clue: `The ${pw} who scored a hat-trick against ${opp} at the ${year} World Cup` });
      else if (gl.length === 2) facts.push({ sig: `brace:${opp}`, score: 74, clue: `The ${pw} who scored twice against ${opp} at the ${year} World Cup` });
      if (stage === 'Final') facts.push({ sig: 'final', score: 88, clue: `The ${pw} who scored in the ${year} World Cup final` });
      else if (stage === 'Semi-finals') facts.push({ sig: `semi:${opp}`, score: 78, clue: `The ${pw} who scored against ${opp} in the semi-final at the ${year} World Cup` });
      else if (stage === 'Quarter-finals') facts.push({ sig: `qf:${opp}`, score: 62, clue: `The ${pw} who scored against ${opp} in the quarter-final at the ${year} World Cup` });
      else if (gl.length === 1) facts.push({ sig: `goal:${opp}`, score: 50, clue: `The ${pw} who scored against ${opp} at the ${year} World Cup${cf}` });
    }

    if (evs.some((e) => e.type === 'own_goal')) facts.push({ sig: 'og', score: 66, clue: `The ${pw} who scored an own goal at the ${year} World Cup${cf}` });
    if (evs.some((e) => e.type === 'shootout_pen' && e.detail === 'scored')) facts.push({ sig: 'so', score: 48, clue: `The ${pw} who scored a penalty in a shootout at the ${year} World Cup${cf}` });

    const wcN = wcScored.get(c.playerId) ?? 0;
    if (wcN >= 3) facts.push({ sig: 'multiwc', score: 64, clue: `The ${pw} who has scored at ${wcN} different World Cups${cf}` });
    if (c.isCaptain) facts.push({ sig: 'captain', score: 44, clue: `The ${pw} who captained ${c.country} at the ${year} World Cup` });

    if (cf) facts.push({ sig: `career:${c.position}`, score: 16 + c.mvt, clue: `${withArticle(`${c.country} ${pw}`)}${cf}` });
    facts.push({ sig: `generic:${c.position}`, score: 6 + c.mvt, clue: `${withArticle(`${c.country} ${pw}`)} at the ${year} World Cup` });
    return facts.sort((a, b) => b.score - a.score);
  };

  const withFacts = cands.map((c) => ({ c, facts: buildFacts(c) })).filter((x) => x.facts.length);
  const sel = (x: { c: Cand; facts: Fact[] }) => x.facts[0]!.score + x.c.mvt * 12;
  const used = new Set<string>();
  const slots: WorldCupXiSlot[] = [];
  const byBucket: Record<string, Array<{ c: Cand; facts: Fact[] }>> = { GK: [], DF: [], MF: [], FW: [] };
  for (const b of ['GK', 'DF', 'MF', 'FW']) {
    byBucket[b] = withFacts.filter((x) => x.c.position === b).sort((a, b2) => sel(b2) - sel(a));
  }
  const taken: Record<string, number> = { GK: 0, DF: 0, MF: 0, FW: 0 };
  for (const pos of LAYOUT) {
    const pool = byBucket[pos.bucket]!;
    const x = pool[taken[pos.bucket]!];
    taken[pos.bucket] += 1;
    if (!x) continue;
    const fact = x.facts.find((f) => !used.has(f.sig)) ?? x.facts[0]!;
    used.add(fact.sig);
    slots.push({ id: `${pos.label}-${slots.length}`, label: pos.label, x: pos.x, y: pos.y, expectedName: x.c.name, clues: [fact.clue] });
  }
  return slots;
}

export async function generateWorldCupXiPuzzle(date: string): Promise<WorldCupXiPuzzleJson | null> {
  const idx = (dayNumber(date) * 3 + hashString(`${date}:wcxi`)) % WC_YEARS.length;
  // Walk years so a thin tournament falls through instead of producing a short XI.
  for (let off = 0; off < WC_YEARS.length; off += 1) {
    const year = WC_YEARS[(idx + off) % WC_YEARS.length]!;
    const slots = await buildXi(year);
    if (slots.length < 11) continue;

    const winner = WINNER[year]!;
    const meta = (await db.execute(sql`
      SELECT player_name, coach, is_captain FROM wc_squads WHERE year = ${year} AND country = ${winner}
    `)) as unknown as Array<{ player_name: string; coach: string | null; is_captain: boolean }>;
    const captain = meta.find((m) => m.is_captain)?.player_name ?? '';
    const manager = meta.find((m) => m.coach)?.coach ?? '';

    const boot = (await db.execute(sql`
      SELECT player_name FROM player_awards WHERE year = ${year} AND award = 'World Cup Golden Boot' LIMIT 1
    `)) as unknown as Array<{ player_name: string }>;
    const topScorerClue = boot[0]
      ? `${boot[0].player_name} won the Golden Boot at this World Cup.`
      : `The Golden Boot was won by ${winner}'s top scorer.`;

    return {
      modeId: 'world_cup_xi',
      puzzleId: `${date}-world_cup_xi`,
      date,
      id: `world_cup_xi_${date}`,
      country: winner,
      year,
      formation: '4-3-3',
      manager,
      captain,
      hostNation: HOST[year]!,
      topScorerClue,
      slots,
    };
  }
  return null;
}
