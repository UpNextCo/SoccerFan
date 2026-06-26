/**
 * PREVIEW generator for World Cup XI clue puzzles (single-tournament flavour).
 *
 * Builds a positionally-balanced XI for a given World Cup year and auto-generates a cryptic
 * clue for each player from our data (awards, match-level goals/own-goals/shootouts, captaincy,
 * career leagues) — in the style of the hand-written examples. This is an evaluation tool: it
 * prints the XIs so we can iterate on clue quality before wiring into the daily puzzle + app.
 *
 * Usage: DATABASE_URL=... npx tsx src/jobs/gen-wc-xi.ts [year ...]   (default 2018 2010)
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

const TOP5 = new Map<number, string>([[39, 'the Premier League'], [140, 'La Liga'], [135, 'Serie A'], [78, 'the Bundesliga'], [61, 'Ligue 1']]);
const AWARD_SHORT: Record<string, string> = {
  'World Cup Golden Ball': 'Golden Ball', 'World Cup Golden Boot': 'Golden Boot',
  'World Cup Golden Glove': 'Golden Glove', 'World Cup Young Player': 'Best Young Player award',
};
const POS_WORD: Record<string, string> = { GK: 'goalkeeper', DF: 'defender', MF: 'midfielder', FW: 'forward' };

interface Cand {
  playerId: string; name: string; country: string; position: string; club: string | null;
  mvt: number; isCaptain: boolean;
}
interface Ev { type: string; stage: string; opponent: string; minute: number | null; detail: string | null; matchDate: string | null; }

function stageWord(stage: string): string {
  switch (stage) {
    case 'Final': return 'the final';
    case 'Semi-finals': return 'the semi-final';
    case 'Quarter-finals': return 'the quarter-final';
    case 'Round of 16': return 'the round of 16';
    case '3rd Place Final': return 'the third-place play-off';
    default: return 'the group stage';
  }
}

async function main() {
  const years = process.argv.slice(2).map(Number).filter(Boolean);
  const targetYears = years.length ? years : [2018, 2010];

  for (const year of targetYears) {
    // Candidates = this year's squads with a matched player, their fame + captaincy.
    const cands = (await db.execute(sql`
      SELECT s.player_id AS "playerId", p.name, s.country, s.position, s.club, p.market_value_tier AS mvt, s.is_captain AS "isCaptain"
      FROM wc_squads s JOIN players p ON p.id = s.player_id
      WHERE s.year = ${year} AND s.position IN ('GK','DF','MF','FW')
    `)) as unknown as Cand[];

    // Awards that year → playerId → award label.
    const awards = (await db.execute(sql`
      SELECT player_id AS "playerId", award FROM player_awards WHERE year = ${year} AND award LIKE 'World Cup %' AND player_id IS NOT NULL
    `)) as unknown as Array<{ playerId: string; award: string }>;
    const awardBy = new Map(awards.map((a) => [a.playerId, a.award]));

    // Match events that year by player.
    const events = (await db.execute(sql`
      SELECT player_id AS "playerId", type, stage, opponent, minute, detail, match_date::text AS "matchDate"
      FROM wc_match_events WHERE year = ${year} AND player_id IS NOT NULL
    `)) as unknown as Array<Ev & { playerId: string }>;
    const evBy = new Map<string, Ev[]>();
    for (const e of events) (evBy.get(e.playerId) ?? evBy.set(e.playerId, []).get(e.playerId)!).push(e);

    // Career leagues (top-5) per player, and how many distinct WCs they scored at.
    const leagues = (await db.execute(sql`
      SELECT DISTINCT player_id AS "playerId", league_id AS "leagueId" FROM player_stats WHERE league_id IN (39,140,135,78,61)
    `)) as unknown as Array<{ playerId: string; leagueId: number }>;
    const leagueBy = new Map<string, Set<number>>();
    for (const l of leagues) (leagueBy.get(l.playerId) ?? leagueBy.set(l.playerId, new Set()).get(l.playerId)!).add(l.leagueId);

    const multiWc = (await db.execute(sql`
      SELECT player_id AS "playerId", COUNT(DISTINCT season)::int AS n FROM player_stats WHERE league_id = 1 AND goals > 0 GROUP BY player_id
    `)) as unknown as Array<{ playerId: string; n: number }>;
    const wcScoredSeasons = new Map(multiWc.map((m) => [m.playerId, m.n]));

    // ---- clue builder ----
    const careerFlavor = (c: Cand): string => {
      const ls = leagueBy.get(c.playerId);
      if (ls?.has(39)) return ' who has played in the Premier League';
      for (const [id, name] of TOP5) if (ls?.has(id)) return ` who has played in ${name}`;
      return '';
    };

    const matchGoals = (evs: Ev[]) => evs.filter((e) => e.type === 'goal');
    const goalsByMatch = (evs: Ev[]) => {
      const m = new Map<string, Ev[]>();
      for (const e of matchGoals(evs)) {
        const k = `${e.stage}|${e.opponent}`;
        (m.get(k) ?? m.set(k, []).get(k)!).push(e);
      }
      return m;
    };

    interface Fact { sig: string; score: number; clue: string; }

    // A ranked list of candidate clues for a player; selection later picks the highest-ranked
    // one whose `sig` hasn't already been used in the XI (keeps every line distinct).
    const buildFacts = (c: Cand): Fact[] => {
      const pw = POS_WORD[c.position] ?? 'player';
      const evs = evBy.get(c.playerId) ?? [];
      const cf = careerFlavor(c);
      const facts: Fact[] = [];

      const award = awardBy.get(c.playerId);
      if (award) facts.push({ sig: `award:${award}`, score: 100, clue: `The ${pw} who won the ${AWARD_SHORT[award]} at the ${year} World Cup` });

      for (const [key, gl] of goalsByMatch(evs)) {
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

      const wcN = wcScoredSeasons.get(c.playerId) ?? 0;
      if (wcN >= 3) facts.push({ sig: 'multiwc', score: 64, clue: `The ${pw} who has scored at ${wcN} different World Cups${cf}` });

      if (c.isCaptain) facts.push({ sig: 'captain', score: 44, clue: `The ${pw} who captained ${c.country} at the ${year} World Cup` });

      // Weak fallbacks so every slot can still get a (less cryptic) line.
      if (cf) facts.push({ sig: `career:${c.position}`, score: 16 + c.mvt, clue: `A ${c.country} ${pw}${cf}` });
      facts.push({ sig: `generic:${c.position}`, score: 6 + c.mvt, clue: `A ${c.country} ${pw} at the ${year} World Cup` });

      return facts.sort((a, b) => b.score - a.score);
    };

    // Select a balanced XI (1 GK, 4 DF, 3 MF, 3 FW). Blend clue strength with FAME so the XI is
    // always recognisable (a famous player with a modest feat beats an obscure one with a neat
    // feat) — then diversified assignment still gives each their best distinct clue.
    const sel = (x: { c: Cand; facts: Fact[] }) => x.facts[0]!.score + x.c.mvt * 12;
    const withFacts = cands.map((c) => ({ c, facts: buildFacts(c) })).filter((x) => x.facts.length);
    const pick = (pos: string, n: number) =>
      withFacts.filter((x) => x.c.position === pos)
        .sort((a, b) => sel(b) - sel(a))
        .slice(0, n);
    const xi = [...pick('GK', 1), ...pick('DF', 4), ...pick('MF', 3), ...pick('FW', 3)];

    // Diversified assignment: process by best score, give each its top fact with an unused sig.
    const usedSigs = new Set<string>();
    const assigned = xi
      .sort((a, b) => b.facts[0]!.score - a.facts[0]!.score)
      .map((x) => {
        const fact = x.facts.find((f) => !usedSigs.has(f.sig)) ?? x.facts[0]!;
        usedSigs.add(fact.sig);
        return { c: x.c, clue: fact.clue };
      });

    const order = { GK: 0, DF: 1, MF: 2, FW: 3 } as Record<string, number>;
    assigned.sort((a, b) => (order[a.c.position]! - order[b.c.position]!));
    console.log(`\n===================== WORLD CUP ${year} =====================`);
    for (const a of assigned) console.log(`${a.c.position.padEnd(2)} - ${a.clue} (${a.c.name})`);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
