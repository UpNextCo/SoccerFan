/**
 * Accurate career hat-tricks from Wikipedia's per-competition hat-trick lists (the authoritative,
 * complete record — far better than deriving from match events, which only covered 2012+ league
 * games and undercounted e.g. Harry Kane). Counts one hat-trick per table row and sums across the
 * big-5 leagues + the Champions League, then writes player_extra_stats.career_hattricks.
 *
 * Parsing invariant: in every per-hat-trick table the PLAYER is the first wikilink / {{sortname}}
 * in the row, and those tables always have a "Date" column (the by-nationality / by-player summary
 * tables don't), so we only read Date-tables and never double-count.
 *
 * Usage:
 *   npx tsx src/jobs/ingest-hattricks-wiki.ts --probe   # print counts, no DB write
 *   npx tsx src/jobs/ingest-hattricks-wiki.ts           # write career_hattricks
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { normalizeSearchText } from '../utils/playerSearch.js';

const PAGES = [
  'List of Premier League hat-tricks',
  'List of La Liga hat-tricks',
  'List of Serie A hat-tricks',
  'List of Bundesliga hat-tricks',
  'List of Ligue 1 hat-tricks',
  'List of UEFA Champions League hat-tricks',
];

async function fetchWikitext(title: string): Promise<string | null> {
  const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&format=json&formatversion=2&redirects=1`;
  const res = await fetch(url, { headers: { 'User-Agent': 'BallKnowledge/1.0 (dev@ballknowledge.app)' } });
  if (!res.ok) return null;
  return ((await res.json()) as any)?.parse?.wikitext ?? null;
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
    if (!/player|for|against|home|away/.test(headerText)) continue;

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
  for (const page of PAGES) {
    const wt = await fetchWikitext(page);
    if (!wt) { console.warn(`  ! ${page}: not found`); continue; }
    const counts = countHatTricks(wt);
    const sum = [...counts.values()].reduce((a, b) => a + b, 0);
    console.log(`  ${page}: ${counts.size} players, ${sum} hat-tricks`);
    for (const [name, n] of counts) total.set(name, (total.get(name) ?? 0) + n);
  }

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

  if (probe) { console.log('\n(--probe: no DB write)'); process.exit(0); }

  let written = 0;
  for (const [id, n] of matched) {
    await db.execute(sql`
      INSERT INTO player_extra_stats (player_id, career_hattricks) VALUES (${id}, ${n})
      ON CONFLICT (player_id) DO UPDATE SET career_hattricks = ${n}
    `);
    written += 1;
  }
  console.log(`\nWrote career_hattricks for ${written} players.`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
