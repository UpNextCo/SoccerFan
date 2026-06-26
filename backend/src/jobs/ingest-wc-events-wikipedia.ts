/**
 * Ingest match-level World Cup events for the years StatsBomb doesn't cover (1994–2014) from
 * Wikipedia "{{Football box}}" templates into wc_match_events: goals (scorer + minute +
 * penalty + own-goal), match dates, stages and shootout takers. (Cards aren't in the summary
 * boxes, so they're out of scope here.)
 *
 * Boxes live in the group articles ("YYYY FIFA World Cup Group A"…) and the knockout article
 * ("YYYY FIFA World Cup knockout stage"). Players are matched to ours by link-target name +
 * nationality (resolved from the team's FIFA code).
 *
 * Usage: DATABASE_URL=... npx tsx src/jobs/ingest-wc-events-wikipedia.ts [--probe]
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { normalizeSearchText } from '../utils/playerSearch.js';
import { canonicalNationality } from '../utils/nationality.js';

const YEARS = [1994, 1998, 2002, 2006, 2010, 2014];

// A few knockout matches have their own dedicated article instead of sitting inline in the
// "knockout stage" page (e.g. the 2014 Germany 7-1 Brazil semi-final). Pull those explicitly.
const EXTRA_MATCHES: Record<number, Array<{ title: string; stage: string }>> = {
  2014: [{ title: 'Brazil v Germany (2014 FIFA World Cup)', stage: 'Semi-finals' }],
};

// FIFA/IOC codes used in WC football boxes → country name (canonicalNationality harmonizes the rest).
const CODE: Record<string, string> = {
  ALG: 'Algeria', ARG: 'Argentina', AUS: 'Australia', AUT: 'Austria', BEL: 'Belgium',
  BIH: 'Bosnia and Herzegovina', BOL: 'Bolivia', BRA: 'Brazil', BUL: 'Bulgaria', CMR: 'Cameroon',
  CHI: 'Chile', CHN: 'China PR', COL: 'Colombia', CRC: 'Costa Rica', CRO: 'Croatia',
  CIV: 'Ivory Coast', CZE: 'Czech Republic', DEN: 'Denmark', ECU: 'Ecuador', EGY: 'Egypt',
  ENG: 'England', FRA: 'France', GER: 'Germany', FRG: 'Germany', GHA: 'Ghana', GRE: 'Greece',
  HON: 'Honduras', IRN: 'Iran', IRL: 'Republic of Ireland', ITA: 'Italy', JPN: 'Japan',
  KSA: 'Saudi Arabia', KOR: 'South Korea', MEX: 'Mexico', MAR: 'Morocco', NED: 'Netherlands',
  NGA: 'Nigeria', NOR: 'Norway', PAR: 'Paraguay', POL: 'Poland', POR: 'Portugal', ROU: 'Romania',
  RUS: 'Russia', SCO: 'Scotland', SEN: 'Senegal', SRB: 'Serbia', SCG: 'Serbia and Montenegro',
  SVK: 'Slovakia', SVN: 'Slovenia', RSA: 'South Africa', ESP: 'Spain', SWE: 'Sweden',
  SUI: 'Switzerland', TOG: 'Togo', TUN: 'Tunisia', TUR: 'Turkey', UKR: 'Ukraine', URU: 'Uruguay',
  USA: 'United States', FRY: 'FR Yugoslavia', YUG: 'Yugoslavia', NZL: 'New Zealand',
  PRK: 'North Korea', ANG: 'Angola', TRI: 'Trinidad and Tobago', UAE: 'United Arab Emirates',
  JAM: 'Jamaica', NIR: 'Northern Ireland', SLV: 'El Salvador',
};

async function fetchWikitext(title: string): Promise<string | null> {
  const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&format=json&formatversion=2&redirects=1`;
  const res = await fetch(url, { headers: { 'User-Agent': 'BallKnowledge/1.0 (dev@ballknowledge.app)' } });
  if (!res.ok) return null;
  return ((await res.json()) as any)?.parse?.wikitext ?? null;
}

/** Extract each "{{Football box…}}" template with brace-balanced scanning (boxes nest templates). */
function extractBoxes(wt: string): string[] {
  const boxes: string[] = [];
  // Group articles use {{#invoke:Football box|main|…}}; knockout articles use {{Football box…}}.
  const re = /\{\{\s*(?:#invoke:\s*)?football box/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(wt))) {
    let depth = 0;
    let i = m.index;
    for (; i < wt.length; i += 1) {
      if (wt[i] === '{' && wt[i + 1] === '{') { depth += 1; i += 1; }
      else if (wt[i] === '}' && wt[i + 1] === '}') { depth -= 1; i += 1; if (depth === 0) break; }
    }
    boxes.push(wt.slice(m.index, i + 1));
    re.lastIndex = i + 1;
  }
  return boxes;
}

/** Split a template body into top-level |key=value params (ignoring | inside {{}} or [[]]). */
function params(box: string): Record<string, string> {
  // Strip only the OUTER braces so inner |…| stay at depth>0; the leading template-name
  // segment (e.g. "#invoke:Football box", "main") has no '=' and is ignored below.
  const body = box.trim().replace(/^\{\{/, '').replace(/\}\}$/, '');
  const out: Record<string, string> = {};
  let depthC = 0, depthB = 0, cur = '';
  const parts: string[] = [];
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (c === '{' && body[i + 1] === '{') { depthC += 1; cur += '{{'; i += 1; continue; }
    if (c === '}' && body[i + 1] === '}') { depthC -= 1; cur += '}}'; i += 1; continue; }
    if (c === '[' && body[i + 1] === '[') { depthB += 1; cur += '[['; i += 1; continue; }
    if (c === ']' && body[i + 1] === ']') { depthB -= 1; cur += ']]'; i += 1; continue; }
    if (c === '|' && depthC === 0 && depthB === 0) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  parts.push(cur);
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    out[p.slice(0, eq).trim().toLowerCase()] = p.slice(eq + 1).trim();
  }
  return out;
}

function teamCode(v: string | undefined): string | null {
  const m = v?.match(/\{\{\s*fb[a-z-]*\s*\|\s*([A-Za-z]{3})/i);
  return m ? m[1]!.toUpperCase() : null;
}
function dateOf(v: string | undefined): string | null {
  const m = v?.match(/\{\{\s*start date\s*\|\s*(\d{4})\s*\|\s*(\d{1,2})\s*\|\s*(\d{1,2})/i);
  if (!m) return null;
  return `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`;
}

interface Goal { name: string; minute: number | null; pen: boolean; og: boolean; }

/** Parse a "goals1/goals2" wikitext block into per-scorer goal entries. */
function parseGoals(block: string | undefined): Goal[] {
  if (!block) return [];
  const out: Goal[] = [];
  for (const line of block.split('\n')) {
    if (!/\[\[/.test(line)) continue;
    const link = line.match(/\[\[([^\]|]+)/);
    if (!link) continue;
    const name = link[1]!.trim();
    for (const gm of line.matchAll(/\{\{\s*goal\s*\|([^}]*)\}\}/gi)) {
      const args = gm[1]!.split('|');
      let last: Goal | null = null;
      for (const raw of args) {
        const a = raw.trim();
        if (/^\d+/.test(a)) { last = { name, minute: parseInt(a, 10), pen: false, og: false }; out.push(last); }
        else if (/pen/i.test(a) && last) last.pen = true;
        else if (/o\.?\s*g/i.test(a) && last) last.og = true;
      }
      // a bare {{goal}} with no numeric arg still implies one goal
      if (!/\d/.test(gm[1]!)) out.push({ name, minute: null, pen: false, og: false });
    }
  }
  return out;
}

interface Row {
  year: number; matchDate: string | null; stage: string; team: string; opponent: string;
  playerName: string; type: string; minute: number | null; detail: string | null;
}

const KO_STAGES: Array<[RegExp, string]> = [
  [/round of 16|first knockout|eighth-?final/i, 'Round of 16'],
  [/quarter/i, 'Quarter-finals'],
  [/semi/i, 'Semi-finals'],
  [/third place|3rd place/i, '3rd Place Final'],
  [/final/i, 'Final'],
];

function stageForOffset(wt: string, offset: number): string {
  let stage = 'Knockout';
  for (const m of wt.matchAll(/^==+\s*(.+?)\s*==+/gm)) {
    if (m.index! > offset) break;
    const h = m[1]!;
    for (const [re, label] of KO_STAGES) if (re.test(h)) { stage = label; break; }
  }
  return stage;
}

function boxesToRows(wt: string, year: number, stageFn: (idxInWt: number) => string): Row[] {
  const rows: Row[] = [];
  let searchFrom = 0;
  for (const box of extractBoxes(wt)) {
    const idx = wt.indexOf(box, searchFrom);
    searchFrom = idx + 1;
    const p = params(box);
    const t1 = teamCode(p.team1); const t2 = teamCode(p.team2);
    if (!t1 || !t2) continue;
    const c1 = CODE[t1] ?? t1; const c2 = CODE[t2] ?? t2;
    const date = dateOf(p.date);
    const stage = stageFn(idx);
    const emit = (goals: Goal[], scoringTeam: string, otherTeam: string) => {
      for (const g of goals) {
        // Own goal: listed under the beneficiary team but the scorer plays for the other team.
        const team = g.og ? otherTeam : scoringTeam;
        const opp = g.og ? scoringTeam : otherTeam;
        rows.push({ year, matchDate: date, stage, team, opponent: opp, playerName: g.name,
          type: g.og ? 'own_goal' : 'goal', minute: g.minute, detail: g.pen ? 'penalty' : null });
      }
    };
    emit(parseGoals(p.goals1), c1, c2);
    emit(parseGoals(p.goals2), c2, c1);
  }
  return rows;
}

async function collectYear(year: number): Promise<Row[]> {
  const rows: Row[] = [];

  // Group articles → Group Stage.
  for (const g of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']) {
    const wt = await fetchWikitext(`${year} FIFA World Cup Group ${g}`);
    await new Promise((r) => setTimeout(r, 120));
    if (wt) rows.push(...boxesToRows(wt, year, () => 'Group Stage'));
  }
  // Knockout article → stage by preceding section header.
  const ko = await fetchWikitext(`${year} FIFA World Cup knockout stage`);
  if (ko) rows.push(...boxesToRows(ko, year, (idx) => stageForOffset(ko, idx)));

  // The final's box lives in its own dedicated article (the knockout page only transcludes it).
  // That article also embeds "route to the final" boxes, so keep only the latest-dated match.
  const finalWt = await fetchWikitext(`${year} FIFA World Cup final`);
  if (finalWt) {
    const fRows = boxesToRows(finalWt, year, () => 'Final');
    const latest = fRows.map((r) => r.matchDate).filter(Boolean).sort().pop();
    rows.push(...fRows.filter((r) => r.matchDate === latest));
  }

  // Dedicated single-match articles (e.g. the 2014 7-1 semi) — keep only that one match's box.
  for (const extra of EXTRA_MATCHES[year] ?? []) {
    const wt = await fetchWikitext(extra.title);
    if (!wt) continue;
    const eRows = boxesToRows(wt, year, () => extra.stage);
    const latest = eRows.map((r) => r.matchDate).filter(Boolean).sort().pop();
    rows.push(...eRows.filter((r) => r.matchDate === latest));
  }
  return rows;
}

async function main() {
  const probe = process.argv.includes('--probe');
  const all: Row[] = [];
  for (const year of YEARS) {
    const rows = await collectYear(year);
    const goals = rows.filter((r) => r.type === 'goal').length;
    const ogs = rows.filter((r) => r.type === 'own_goal').length;
    console.log(`  ${year}: ${rows.length} events (${goals} goals, ${ogs} own goals)`);
    all.push(...rows);
  }

  if (probe) {
    const s = all.filter((r) => r.year === 2010 && r.stage !== 'Group Stage').slice(0, 25);
    console.log('\n2010 knockout sample:');
    for (const r of s) console.log(`  ${r.stage.padEnd(16)} ${r.minute ?? '?'}\x27 ${r.playerName} (${r.team}) ${r.type === 'own_goal' ? 'OG' : r.detail ?? ''}`);
    process.exit(0);
  }

  // Player match: name+nationality, then unique global name.
  const players = (await db.execute(sql`SELECT id, name, nationality FROM players`)) as unknown as Array<{ id: string; name: string; nationality: string }>;
  const byNameNat = new Map<string, string>();
  const byName = new Map<string, string[]>();
  for (const p of players) {
    const n = normalizeSearchText(p.name);
    byNameNat.set(`${n}|${canonicalNationality(p.nationality)}`, p.id);
    (byName.get(n) ?? byName.set(n, []).get(n)!).push(p.id);
  }
  const match = (name: string, country: string): string | null => {
    const n = normalizeSearchText(name);
    const exact = byNameNat.get(`${n}|${canonicalNationality(country)}`);
    if (exact) return exact;
    const list = byName.get(n);
    return list && list.length === 1 ? list[0]! : null;
  };

  const withIds = all.map((r) => ({ ...r, pid: match(r.playerName, r.team) }));
  const matched = withIds.filter((r) => r.pid).length;
  console.log(`\n${all.length} events · ${matched} matched (${Math.round((matched / all.length) * 100)}%)`);

  await db.execute(sql`DELETE FROM wc_match_events WHERE year IN (${sql.join(YEARS.map((y) => sql`${y}`), sql`, `)})`);
  for (let i = 0; i < withIds.length; i += 400) {
    const batch = withIds.slice(i, i + 400);
    const tuples = batch.map((r) => sql`(${r.year}, 0, ${r.matchDate}::date, ${r.stage}, ${r.team}, ${r.opponent}, ${r.pid}::uuid, ${r.playerName}, ${r.type}, ${r.minute}, ${r.detail})`);
    await db.execute(sql`
      INSERT INTO wc_match_events (year, match_id, match_date, stage, team, opponent, player_id, player_name, type, minute, detail)
      VALUES ${sql.join(tuples, sql`, `)}
    `);
  }
  console.log('Inserted.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
