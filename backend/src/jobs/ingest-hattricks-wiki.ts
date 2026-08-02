/**
 * Career hat-tricks from Wikipedia's per-competition hat-trick lists.
 *
 * Earlier we only counted big-5 leagues + Champions League, which undercounted anyone with
 * hat-tricks elsewhere (Neymar's Brasileirão / Brazil caps, Saka's England caps, Kane's England
 * caps, Europa League, etc.). Domestic cup lists mostly don't exist on Wikipedia, so cup
 * hat-tricks are still missing — Neymar will land around the mid-teens rather than the ~22
 * all-competition figure you see online.
 *
 * Parsing invariant: in every per-hat-trick table the PLAYER is the first wikilink / {{sortname}}
 * in the row, and those tables always have a "Date" column (the by-nationality / by-player summary
 * tables don't), so we only read Date-tables and never double-count within a page.
 *
 * National-team lists already include World Cup / continental finals, so we deliberately do NOT
 * also ingest a separate World Cup page (that would double-count).
 *
 * Usage:
 *   npx tsx src/jobs/ingest-hattricks-wiki.ts --probe   # print counts, no DB write
 *   npx tsx src/jobs/ingest-hattricks-wiki.ts           # write career_hattricks
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { normalizeSearchText } from '../utils/playerSearch.js';

const PAUSE_MS = 350;

/** Club competitions with complete (or near-complete) Wikipedia hat-trick lists. */
const CLUB_PAGES = [
  'List of Premier League hat-tricks',
  'List of La Liga hat-tricks',
  'List of Serie A hat-tricks',
  'List of Bundesliga hat-tricks',
  'List of Ligue 1 hat-tricks',
  'List of UEFA Champions League hat-tricks',
  'List of UEFA Europa League hat-tricks',
  'List of Campeonato Brasileiro Série A hat-tricks',
  'List of Primeira Liga hat-tricks',
  'List of Eredivisie hat-tricks',
  'List of Major League Soccer hat-tricks',
  'List of Scottish Professional Football League hat-tricks',
  'List of FIFA Club World Cup hat-tricks',
];

/** Senior international lists — covers friendlies, qualifiers, and finals tournaments. */
const NATION_PAGES = [
  'List of England national football team hat-tricks',
  'List of Brazil national football team hat-tricks',
  'List of France national football team hat-tricks',
  'List of Germany national football team hat-tricks',
  'List of Spain national football team hat-tricks',
  'List of Italy national football team hat-tricks',
  'List of Portugal national football team hat-tricks',
  'List of Netherlands national football team hat-tricks',
  'List of Belgium national football team hat-tricks',
  'List of Argentina national football team hat-tricks',
  'List of Uruguay national football team hat-tricks',
  'List of Croatia national football team hat-tricks',
  'List of Sweden national football team hat-tricks',
  'List of Norway national football team hat-tricks',
  'List of Denmark national football team hat-tricks',
  'List of Poland national football team hat-tricks',
  'List of Serbia national football team hat-tricks',
  'List of Switzerland national football team hat-tricks',
  'List of Austria national football team hat-tricks',
  'List of Turkey national football team hat-tricks',
  'List of Greece national football team hat-tricks',
  'List of Czech Republic national football team hat-tricks',
  'List of Romania national football team hat-tricks',
  'List of Hungary national football team hat-tricks',
  'List of Scotland national football team hat-tricks',
  'List of Wales national football team hat-tricks',
  'List of Republic of Ireland national football team hat-tricks',
  'List of Mexico national football team hat-tricks',
  'List of United States national football team hat-tricks',
  'List of Colombia national football team hat-tricks',
  'List of Chile national football team hat-tricks',
  'List of Paraguay national football team hat-tricks',
  'List of Peru national football team hat-tricks',
  'List of Ecuador national football team hat-tricks',
  'List of Japan national football team hat-tricks',
  'List of South Korea national football team hat-tricks',
  'List of Australia national football team hat-tricks',
  'List of Nigeria national football team hat-tricks',
  'List of Ghana national football team hat-tricks',
  'List of Cameroon national football team hat-tricks',
  'List of Ivory Coast national football team hat-tricks',
  'List of Senegal national football team hat-tricks',
  'List of Morocco national football team hat-tricks',
  'List of Egypt national football team hat-tricks',
  'List of Algeria national football team hat-tricks',
  'List of Tunisia national football team hat-tricks',
];

const PAGES = [...CLUB_PAGES, ...NATION_PAGES];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchWikitext(title: string): Promise<string | null> {
  const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&format=json&formatversion=2&redirects=1`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': 'BallKnowledge/1.0 (dev@ballknowledge.app)' } });
    if (res.status === 429) {
      await sleep(Number(res.headers.get('Retry-After') ?? 2) * 1000 * (attempt + 1));
      continue;
    }
    if (!res.ok) return null;
    const body = (await res.json()) as { parse?: { wikitext?: string }; error?: { code?: string } };
    if (body.error) return null;
    return body.parse?.wikitext ?? null;
  }
  return null;
}

/** Split wikitext into top-level table blocks ({| … |}). */
function tableBlocks(wt: string): string[] {
  const lines = wt.split('\n');
  const out: string[] = [];
  let cur: string[] | null = null;
  let depth = 0;
  for (const ln of lines) {
    if (/^\s*\{\|/.test(ln)) { if (depth === 0) cur = []; depth += 1; }
    if (cur) cur.push(ln);
    if (/^\s*\|\}/.test(ln)) { depth -= 1; if (depth === 0 && cur) { out.push(cur.join('\n')); cur = null; } }
  }
  return out;
}

/** The first person reference in a row: {{sortname|First|Last}} or [[Link|Disp]] / [[Link]]. */
function firstPlayer(rowText: string): string | null {
  const sn = rowText.match(/\{\{\s*sortname\s*\|\s*([^|}]+?)\s*\|\s*([^|}]+?)\s*(?:\||\}\})/i);
  if (sn) return `${sn[1]} ${sn[2]}`.replace(/\[\[|\]\]/g, '').trim();
  const link = rowText.match(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/);
  if (link) return (link[2] ?? link[1]).trim();
  return null;
}

/** Count hat-tricks per (Wikipedia) player name across a page's per-hat-trick (Date) tables. */
function countHatTricks(wt: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const block of tableBlocks(wt)) {
    // Header cells start with "!" (the column headers can sit before OR after the first |-, so we
    // gather all of them). Only per-hat-trick tables have a Date column plus a player/club column.
    const headerText = block
      .split('\n')
      .filter((l) => /^\s*!/.test(l))
      .join(' ')
      .toLowerCase();
    if (!headerText.includes('date')) continue;
    if (!/player|for|against|home|away|scorer/.test(headerText)) continue;

    const rows = block.split(/\n\|-/).slice(1); // drop the header chunk
    for (const row of rows) {
      const name = firstPlayer(row);
      if (!name) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return counts;
}

interface PlayerRow { id: string; name: string; norm: string; apps: number }

async function loadPlayerIndex(): Promise<Map<string, PlayerRow>> {
  const rows = (await db.execute(sql`
    SELECT p.id, p.name,
      COALESCE((SELECT SUM(appearances) FROM player_stats s WHERE s.player_id = p.id), 0)::int AS apps
    FROM players p
  `)) as unknown as Array<{ id: string; name: string; apps: number }>;
  // normalized name -> the most-prominent matching player (most appearances)
  const index = new Map<string, PlayerRow>();
  for (const r of rows) {
    const norm = normalizeSearchText(r.name);
    const existing = index.get(norm);
    if (!existing || r.apps > existing.apps) index.set(norm, { id: r.id, name: r.name, norm, apps: r.apps });
  }
  return index;
}

async function main() {
  const probe = process.argv.includes('--probe');

  const total = new Map<string, number>();
  let missingPages = 0;
  for (const page of PAGES) {
    const wt = await fetchWikitext(page);
    await sleep(PAUSE_MS);
    if (!wt) { console.warn(`  ! ${page}: not found`); missingPages += 1; continue; }
    const counts = countHatTricks(wt);
    const sum = [...counts.values()].reduce((a, b) => a + b, 0);
    console.log(`  ${page}: ${counts.size} players, ${sum} hat-tricks`);
    for (const [name, n] of counts) total.set(name, (total.get(name) ?? 0) + n);
  }
  console.log(`\nPages scraped: ${PAGES.length - missingPages}/${PAGES.length}`);

  const index = await loadPlayerIndex();
  const matched = new Map<string, number>(); // player_id -> hat-tricks
  let unmatchedTop: Array<[string, number]> = [];
  for (const [name, n] of total) {
    const hit = index.get(normalizeSearchText(name));
    if (hit) matched.set(hit.id, (matched.get(hit.id) ?? 0) + n);
    else unmatchedTop.push([name, n]);
  }

  unmatchedTop = unmatchedTop.sort((a, b) => b[1] - a[1]).slice(0, 25);
  console.log(`\nMatched ${matched.size} players. Top unmatched (name not in DB):`);
  for (const [name, n] of unmatchedTop) console.log(`   ${name}: ${n}`);

  // Show the top matched scorers for a sanity check.
  const byId = new Map([...index.values()].map((p) => [p.id, p.name]));
  const topMatched = [...matched.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  console.log('\nTop matched hat-trick scorers:');
  for (const [id, n] of topMatched) console.log(`   ${byId.get(id) ?? id}: ${n}`);

  const spot = ['Neymar', 'Bukayo Saka', 'Harry Kane', 'Mohamed Salah', 'Cristiano Ronaldo', 'Lionel Messi'];
  console.log('\nSpot checks:');
  for (const name of spot) {
    const hit = index.get(normalizeSearchText(name));
    console.log(`   ${name}: ${hit ? (matched.get(hit.id) ?? 0) : '(not in DB)'}`);
  }

  if (probe) { console.log('\n(--probe: no DB write)'); process.exit(0); }

  // Reset then write — otherwise a player who only had cup HTs from the old TM-events pass would
  // keep a stale positive while everyone else moves to the Wikipedia totals.
  await db.execute(sql`UPDATE player_extra_stats SET career_hattricks = 0, updated_at = now() WHERE career_hattricks <> 0`);

  let written = 0;
  const entries = [...matched.entries()];
  for (let i = 0; i < entries.length; i += 200) {
    const batch = entries.slice(i, i + 200);
    const tuples = batch.map(([id, n]) => sql`(${id}::uuid, ${n})`);
    await db.execute(sql`
      INSERT INTO player_extra_stats (player_id, career_hattricks)
      VALUES ${sql.join(tuples, sql`, `)}
      ON CONFLICT (player_id) DO UPDATE
        SET career_hattricks = EXCLUDED.career_hattricks, updated_at = now()
    `);
    written += batch.length;
  }
  console.log(`\nWrote career_hattricks for ${written} players.`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
