/**
 * DATA-FIRST World Cup XI clue builder.
 *
 * Instead of asking an LLM to invent clues and then trying to catch the lies, this derives clues
 * DIRECTLY from verified data (wc_match_events, player_awards, wc_squads, player_stats). Every clue
 * is therefore TRUE BY CONSTRUCTION — no fabrication is possible. Clues are position-led and DO NOT
 * mention the year (the app shows the year + club above the clue). Only famous players pass a fame
 * floor (players.market_value_tier ≥ FAME_MIN) so the pool stays recognisable/memorable.
 *
 *   (default)   preview: write wc_datafirst_preview.csv + print coverage, DON'T touch the live bank.
 *   apply:      replace wc_memorable with the data-first clues + export wc_memorable_review.csv.
 *
 * A later step can pass each true clue to Claude for wording polish (rephrase only, no new facts).
 *
 * Usage: DATABASE_URL=... npx tsx src/jobs/build-wc-datafirst.ts [apply]
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { polishClues } from '../services/llmCuration.js';

const YEARS = [2006, 2010, 2014, 2018, 2022, 2026];
const FAME_MIN = 3; // players.market_value_tier ≥ this — keeps the pool recognisable
const PREVIEW_FILE = 'wc_datafirst_preview.csv';
const REVIEW_FILE = 'wc_memorable_review.csv';

const POS_WORD: Record<string, string> = { GK: 'goalkeeper', DF: 'defender', MF: 'midfielder', FW: 'forward' };

// Transfermarkt fine position → a natural, specific role phrase (much less "lost" than defender/mid/fwd).
const ROLE_WORD: Record<string, string> = {
  Goalkeeper: 'goalkeeper',
  'Right-Back': 'right-back', 'Left-Back': 'left-back', 'Centre-Back': 'centre-back',
  'Defensive Midfield': 'defensive midfielder', 'Central Midfield': 'central midfielder',
  'Attacking Midfield': 'attacking midfielder', 'Right Midfield': 'right midfielder', 'Left Midfield': 'left midfielder',
  'Right Winger': 'winger', 'Left Winger': 'winger',
  'Centre-Forward': 'striker', 'Second Striker': 'forward',
};

// Nationality demonym for the national side (the clue leads with it, e.g. "The Brazilian…").
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
  Qatar: 'Qatari', Panama: 'Panamanian', 'Serbia and Montenegro': 'Serbia & Montenegro', 'Trinidad and Tobago': 'Trinidadian',
  'Saudi Arabia ': 'Saudi',
};
const demonym = (c: string): string => DEMONYM[c] ?? c;

// Tournament finishes (static, 2006–2022) so captaincy clues can say how far the side went.
// champion / runner-up / the two beaten semi-finalists / the four beaten quarter-finalists.
const FINISH: Record<number, { champion: string; runnerUp: string; semi: string[]; quarter: string[] }> = {
  2006: { champion: 'Italy', runnerUp: 'France', semi: ['Germany', 'Portugal'], quarter: ['England', 'Ukraine', 'Brazil', 'Argentina'] },
  2010: { champion: 'Spain', runnerUp: 'Netherlands', semi: ['Germany', 'Uruguay'], quarter: ['Argentina', 'Paraguay', 'Brazil', 'Ghana'] },
  2014: { champion: 'Germany', runnerUp: 'Argentina', semi: ['Netherlands', 'Brazil'], quarter: ['France', 'Belgium', 'Costa Rica', 'Colombia'] },
  2018: { champion: 'France', runnerUp: 'Croatia', semi: ['Belgium', 'England'], quarter: ['Uruguay', 'Brazil', 'Russia', 'Sweden'] },
  2022: { champion: 'Argentina', runnerUp: 'France', semi: ['Croatia', 'Morocco'], quarter: ['Netherlands', 'Brazil', 'England', 'Portugal'] },
  2026: { champion: 'Spain', runnerUp: 'Argentina', semi: ['France', 'England'], quarter: ['Norway', 'Belgium', 'Morocco', 'Switzerland'] },
};
/** How to phrase what the captain led the side to, or null for a group-stage exit. */
function captainedPhrase(country: string, year: number): string {
  const f = FINISH[year];
  if (!f) return 'the side';
  if (country === f.champion) return 'the champions';
  if (country === f.runnerUp) return 'the runners-up';
  if (f.semi.includes(country)) return 'the side to the semi-finals';
  if (f.quarter.includes(country)) return 'the side to the quarter-finals';
  return 'the side';
}
const AWARD_SHORT: Record<string, string> = {
  'World Cup Golden Ball': 'Golden Ball', 'World Cup Golden Boot': 'Golden Boot',
  'World Cup Golden Glove': 'Golden Glove', 'World Cup Young Player': 'Best Young Player award',
};
// FBref/data opponent spelling → nicer display.
const OPP_DISPLAY: Record<string, string> = {
  'IR Iran': 'Iran', 'Korea Republic': 'South Korea', 'Korea DPR': 'North Korea',
  'United States': 'the United States', 'China PR': 'China',
  'Serbia and Montenegro': 'Serbia & Montenegro', 'S & M': 'Serbia & Montenegro',
  "Côte d'Ivoire": 'Ivory Coast', Czechia: 'Czech Republic',
};
const opp = (o: string): string => OPP_DISPLAY[o] ?? o;

interface Squad { playerId: string; name: string; country: string; position: string; subPosition: string | null; isCaptain: boolean; year: number; tier: number; }
interface Ev { type: string; stage: string; opponent: string; detail: string | null; matchId: number; }
interface Fact { score: number; clue: string; }

function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** True if a polished clue is safe to use: no year, no digits, doesn't leak the player's name,
 *  still starts with "The ", and isn't wildly longer than the true draft. */
function polishOk(polished: string, draft: string, playerName: string): boolean {
  if (!polished || !/^The /.test(polished)) return false;
  if (/\d/.test(polished)) return false; // no years/numbers the draft didn't have
  if (polished.length > draft.length + 45) return false;
  const surname = playerName.split(' ').pop()!.toLowerCase();
  if (surname.length > 2 && polished.toLowerCase().includes(surname)) return false; // don't reveal the answer
  const nat = draft.split(/\s+/)[1]; // the demonym, e.g. "Brazilian" — must survive the rewrite
  if (nat && !polished.toLowerCase().includes(nat.toLowerCase())) return false;
  return true;
}

async function main() {
  const apply = process.argv[2] === 'apply' || process.argv.includes('apply');
  const polish = process.argv.includes('--polish');

  // Famous squad members (fame floor), 2006+.
  const squads = (await db.execute(sql`
    SELECT s.player_id AS "playerId", p.name, s.country, s.position, p.sub_position AS "subPosition",
           s.is_captain AS "isCaptain", s.year, p.market_value_tier AS tier
    FROM wc_squads s JOIN players p ON p.id = s.player_id
    WHERE s.year >= 2006 AND s.player_id IS NOT NULL
      AND s.position IN ('GK','DF','MF','FW') AND p.market_value_tier >= ${FAME_MIN}
  `)) as unknown as Squad[];

  const awards = (await db.execute(sql`
    SELECT player_id AS "playerId", year, award FROM player_awards
    WHERE award LIKE 'World Cup %' AND player_id IS NOT NULL
  `)) as unknown as Array<{ playerId: string; year: number; award: string }>;
  const awardBy = new Map(awards.map((a) => [`${a.playerId}|${a.year}`, a.award]));

  const events = (await db.execute(sql`
    SELECT player_id AS "playerId", year, type, stage, opponent, detail, match_id AS "matchId"
    FROM wc_match_events WHERE player_id IS NOT NULL AND year >= 2006
  `)) as unknown as Array<Ev & { playerId: string; year: number }>;
  const evBy = new Map<string, Ev[]>();
  for (const e of events) (evBy.get(`${e.playerId}|${e.year}`) ?? evBy.set(`${e.playerId}|${e.year}`, []).get(`${e.playerId}|${e.year}`)!).push(e);

  // All-time records (computed from World Cup player_stats, league_id = 1).
  const wcStats = (await db.execute(sql`
    SELECT player_id AS "playerId", COALESCE(SUM(goals),0)::int AS goals, COALESCE(SUM(appearances),0)::int AS apps
    FROM player_stats WHERE league_id = 1 AND player_id IS NOT NULL GROUP BY player_id
  `)) as unknown as Array<{ playerId: string; goals: number; apps: number }>;
  const topScorer = wcStats.reduce((a, b) => (b.goals > a.goals ? b : a), { playerId: '', goals: -1, apps: 0 });
  const mostApps = wcStats.reduce((a, b) => (b.apps > a.apps ? b : a), { playerId: '', goals: 0, apps: -1 });
  // The record clue is attached to the player's latest World Cup in range.
  const latestYear = new Map<string, number>();
  for (const s of squads) latestYear.set(s.playerId, Math.max(latestYear.get(s.playerId) ?? 0, s.year));

  const buildFacts = (s: Squad): Fact[] => {
    // Difficulty is scaled to fame: the bigger the name, the LESS we give away. Superstars (tier 5)
    // get the coarse position and no opponent; tier 4 keeps the fine role but drops the opponent;
    // lesser names (tier 3) get the full, most helpful clue. The revealable club hint (iOS) is the
    // disambiguator when a vaguer clue could fit more than one player.
    const fineRole = (s.subPosition ? ROLE_WORD[s.subPosition] : undefined) ?? POS_WORD[s.position] ?? 'player';
    const role = s.tier >= 5 ? (POS_WORD[s.position] ?? 'player') : fineRole;
    const who = `The ${demonym(s.country)} ${role} who`;
    const vs = (o: string) => (s.tier >= 4 ? '' : ` against ${opp(o)}`);
    const evs = evBy.get(`${s.playerId}|${s.year}`) ?? [];
    const facts: Fact[] = [];

    // Global records (premium) — only on the player's most recent WC.
    if (latestYear.get(s.playerId) === s.year) {
      if (s.playerId === topScorer.playerId) facts.push({ score: 300, clue: `${who} is the all-time top scorer at the World Cup` });
      if (s.playerId === mostApps.playerId) facts.push({ score: 290, clue: `The ${demonym(s.country)} ${role} with the most World Cup appearances` });
    }

    const award = awardBy.get(`${s.playerId}|${s.year}`);
    if (award) facts.push({ score: 200, clue: `${who} won the ${AWARD_SHORT[award]}` });

    // Goals grouped by match → stage / opponent / count.
    const byMatch = new Map<number, { stage: string; opponent: string; n: number }>();
    for (const e of evs.filter((x) => x.type === 'goal')) {
      const m = byMatch.get(e.matchId) ?? { stage: e.stage, opponent: e.opponent, n: 0 };
      m.n += 1; byMatch.set(e.matchId, m);
    }
    const stages = new Set([...byMatch.values()].map((m) => m.stage));
    const stageGoal = (st: string) => [...byMatch.values()].find((m) => m.stage === st);
    const hat = [...byMatch.values()].find((m) => m.n >= 3);
    const brace = [...byMatch.values()].find((m) => m.n === 2);

    if (stages.has('Final')) facts.push({ score: 150, clue: `${who} scored in the final` });
    if (hat) facts.push({ score: 140, clue: `${who} scored a hat-trick${vs(hat.opponent)}` });
    if (stageGoal('Semi-finals')) facts.push({ score: 120, clue: `${who} scored in the semi-final${vs(stageGoal('Semi-finals')!.opponent)}` });
    if (evs.some((e) => e.type === 'own_goal')) {
      const og = evs.find((e) => e.type === 'own_goal')!;
      facts.push({ score: 110, clue: `${who} scored an own goal${vs(og.opponent)}` });
    }
    const red = evs.find((e) => e.type === 'card' && e.detail === 'Red Card');
    if (red) facts.push({ score: 105, clue: `${who} was sent off${vs(red.opponent)}` });
    if (brace) facts.push({ score: 100, clue: `${who} scored twice${vs(brace.opponent)}` });
    if (stageGoal('Quarter-finals')) facts.push({ score: 95, clue: `${who} scored in the quarter-final${vs(stageGoal('Quarter-finals')!.opponent)}` });
    if (evs.some((e) => e.type === 'shootout_pen' && e.detail === 'scored')) {
      const so = evs.find((e) => e.type === 'shootout_pen' && e.detail === 'scored')!;
      facts.push({ score: 90, clue: `${who} scored a penalty in the shootout${vs(so.opponent)}` });
    }
    if (s.position === 'GK' && evs.some((e) => e.type === 'shootout_save')) {
      const sv = evs.find((e) => e.type === 'shootout_save')!;
      facts.push({ score: 88, clue: `The ${demonym(s.country)} goalkeeper who saved a penalty in the shootout${vs(sv.opponent)}` });
    }
    if (s.isCaptain) facts.push({ score: 80, clue: `${who} captained ${captainedPhrase(s.country, s.year)}` });
    // NB: plain single group/last-16 goals are deliberately NOT included — "scored against
    // [group opponent]" is true but not memorable. Only distinctive feats above make the bank.

    return facts.sort((a, b) => b.score - a.score);
  };

  interface Row { year: number; playerId: string; player: string; position: string; clue: string; score: number; }
  const rows: Row[] = [];
  for (const s of squads) {
    const facts = buildFacts(s);
    if (!facts.length) continue; // no memorable, verified feat → skip (keeps the bank recognisable)
    rows.push({ year: s.year, playerId: s.playerId, player: s.name, position: s.position, clue: facts[0]!.clue, score: facts[0]!.score });
  }

  // Optional Claude wording polish — rephrase only, never add facts; fall back to the true draft
  // on anything that adds a year/number, leaks the player's name, or drifts too far.
  if (polish) {
    const polished = await polishClues(rows.map((r) => ({ id: `${r.playerId}|${r.year}`, draft: r.clue })));
    let changed = 0;
    for (const r of rows) {
      const p = polished.get(`${r.playerId}|${r.year}`);
      if (p && p !== r.clue && polishOk(p, r.clue, r.player)) { r.clue = p; changed += 1; }
    }
    console.log(`Polished ${changed}/${rows.length} clues (kept the true draft for the rest).`);
  }

  // Coverage report.
  const byPos = new Map<string, number>();
  for (const r of rows) byPos.set(r.position, (byPos.get(r.position) ?? 0) + 1);
  console.log(`Data-first clues: ${rows.length} (fame tier ≥ ${FAME_MIN}, ${YEARS[0]}+)`);
  for (const p of ['GK', 'DF', 'MF', 'FW']) console.log(`  ${p}: ${byPos.get(p) ?? 0}`);

  // Preview CSV (sorted so it's easy to skim).
  const sorted = [...rows].sort((a, b) => a.year - b.year || a.position.localeCompare(b.position) || a.player.localeCompare(b.player));
  const lines = ['year,position,player,clue', ...sorted.map((r) => [r.year, r.position, r.player, r.clue].map(csvCell).join(','))];
  writeFileSync(apply ? REVIEW_FILE : PREVIEW_FILE, lines.join('\n'));
  console.log(`Wrote ${apply ? REVIEW_FILE : PREVIEW_FILE}.`);

  if (!apply) {
    console.log('\nPreview only — the live bank was NOT changed. Re-run with `apply` to switch the game over.');
    process.exit(0);
  }

  // Apply: replace wc_memorable with the data-first clues.
  await db.execute(sql`DELETE FROM wc_memorable`);
  for (let i = 0; i < rows.length; i += 300) {
    const batch = rows.slice(i, i + 300);
    const tuples = batch.map((r) => sql`(${r.year}, ${r.playerId}::uuid, ${r.player}, ${r.position}, ${r.clue}, 'active')`);
    await db.execute(sql`
      INSERT INTO wc_memorable (year, player_id, player_name, position, clue, status)
      VALUES ${sql.join(tuples, sql`, `)}
      ON CONFLICT (year, player_id) DO UPDATE SET clue = EXCLUDED.clue, position = EXCLUDED.position, status = 'active'
    `);
  }
  console.log(`Applied ${rows.length} data-first clues to wc_memorable.`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
