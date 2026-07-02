/**
 * Import individual AWARDS from Wikipedia list articles into player_awards.
 *
 * Across these articles each winner row leads with a {{flagicon}} then the player's
 * wikilink, with the year/season in the cell before it — so one parser handles Ballon
 * d'Or (with 1st/2nd/3rd podium via rowspan years), European Golden Shoe and the World
 * Cup Golden Boot. Plain Wikipedia API; players matched by name (tie-break career apps).
 *
 * Usage:
 *   DATABASE_URL=... npm run job:import-awards
 *   DATABASE_URL=... npm run job:import-awards -- --probe "Ballon d'Or"
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { normalizeSearchText } from '../utils/playerSearch.js';

interface AwardCfg {
  award: string;
  page: string;
  podium: boolean; // Ballon d'Or = 1st/2nd/3rd; others = single winner
  /** Table lists winner + runners-up per year with no placement markers (The Best, African
   *  POTY…): keep only the first row of each year (the winner row comes first). */
  firstPerYear?: boolean;
  /** Page organises winners as per-year sections (=== 2009 ===) each with a podium table
   *  (FIFA Puskás Award): winner = the '''1st''' row of each section's table. */
  sectionYears?: boolean;
}

const AWARDS: AwardCfg[] = [
  { award: "Ballon d'Or", page: "Ballon d'Or", podium: true },
  { award: 'European Golden Shoe', page: 'European Golden Shoe', podium: false },
  // World Cup Golden Boot is computed from our WC data (top scorer per tournament) in
  // build-milestone-prompts, since that article doesn't use {{flagicon}} winner rows.

  // Individual honours that widen the prestige signal + Bingo award tiles beyond the
  // Ballon d'Or: club-season awards, breakout awards, and continental awards.
  { award: 'The Best FIFA Men\'s Player', page: "The Best FIFA Men's Player", podium: false, firstPerYear: true },
  { award: 'FIFA Puskás Award', page: 'FIFA Puskás Award', podium: false, sectionYears: true },
  { award: 'Golden Boy', page: 'Golden Boy (award)', podium: false, firstPerYear: true },
  { award: 'African Footballer of the Year', page: 'African Footballer of the Year', podium: false, firstPerYear: true },
  { award: "PFA Players' Player of the Year", page: "PFA Players' Player of the Year", podium: false, firstPerYear: true },
  { award: 'PFA Young Player of the Year', page: 'PFA Young Player of the Year', podium: false, firstPerYear: true },
  { award: 'Premier League Player of the Season', page: 'Premier League Player of the Season', podium: false, firstPerYear: true },
  { award: 'UEFA Men\'s Player of the Year', page: "UEFA Men's Player of the Year Award", podium: false, firstPerYear: true },
  { award: 'Serie A Footballer of the Year', page: 'Serie A Footballer of the Year', podium: false, firstPerYear: true },
];

async function fetchWikitext(title: string): Promise<string | null> {
  const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&format=json&formatversion=2&redirects=1`;
  const res = await fetch(url, { headers: { 'User-Agent': 'BallKnowledge/1.0 (dev@ballknowledge.app)' } });
  if (!res.ok) return null;
  const data: any = await res.json();
  return data?.parse?.wikitext ?? null;
}

function cleanName(raw: string): string {
  const m = raw.match(/\[\[([^\]]+)\]\]/);
  let v = m ? (m[1]!.includes('|') ? m[1]!.split('|').pop()! : m[1]!) : raw;
  return v.replace(/\{\{[^}]*\}\}/g, '').replace(/'''/g, '').replace(/\([^)]*\)/g, '').replace(/<ref[\s\S]*?(\/>|<\/ref>)/g, '').replace(/\s+/g, ' ').trim();
}

interface Row {
  player: string;
  year: number;
  placement: string;
}

/** Distinct plausible years in a table — the real winners table spans decades, whereas a
 *  current-year nominees table only mentions one or two. */
function distinctYears(block: string): number {
  const years = new Set<number>();
  for (const m of block.matchAll(/\b(19[5-9]\d|20[0-3]\d)\b/g)) years.add(parseInt(m[1]!, 10));
  return years.size;
}

/** Pages organised as `=== 2009 ===` sections with a podium table each (Puskás): the winner
 *  is the `'''1st'''` row of each section's first table. */
function parseSectionYears(wt: string): Row[] {
  const out: Row[] = [];
  const sections = [...wt.matchAll(/===\s*(\d{4})\s*===([\s\S]*?)(?====|$)/g)];
  for (const [, yearStr, body] of sections) {
    const year = parseInt(yearStr!, 10);
    const table = body!.match(/\{\|[\s\S]*?\n\|\}/)?.[0];
    if (!table) continue;
    for (const row of table.split(/\n\|-/)) {
      if (!/'''1st'''/.test(row)) continue;
      const fi = row.indexOf('{{flagicon');
      if (fi < 0) continue;
      const link = row.slice(fi).match(/\[\[([^\]]+)\]\]/);
      if (!link) continue;
      out.push({ player: cleanName(`[[${link[1]}]]`), year, placement: 'winner' });
      break;
    }
  }
  return out;
}

function parseAward(wt: string, cfg: Pick<AwardCfg, 'podium' | 'firstPerYear' | 'sectionYears'>): Row[] {
  if (cfg.sectionYears) return parseSectionYears(wt);
  // Main table = the one spanning the most distinct years (tie-break: most flag icons).
  // Flag-count alone picks a "this year's nominees" table on pages like the Puskás Award.
  const blocks = [...wt.matchAll(/\{\|[\s\S]*?\n\|\}/g)].map((m) => m[0]);
  const table = blocks.sort(
    (a, b) =>
      distinctYears(b) - distinctYears(a) ||
      (b.match(/\{\{flagicon/g)?.length ?? 0) - (a.match(/\{\{flagicon/g)?.length ?? 0)
  )[0];
  if (!table) return [];

  const out: Row[] = [];
  const seenYears = new Set<number>();
  let currentYear = 0;
  for (const row of table.split(/\n\|-/)) {
    const fi = row.indexOf('{{flagicon');
    const head = fi >= 0 ? row.slice(0, fi) : row;
    const ym = head.match(/\b(19[5-9]\d|20[0-3]\d)\b/); // year/season cell precedes the player
    if (ym) currentYear = parseInt(ym[1]!, 10);

    let player = '';
    if (fi >= 0) {
      // Player is usually in the same cell right after the flag (Ballon d'Or: [[Stanley
      // Matthews]]; Golden Shoe: {{sortname|First|Last}}). On PFA-style pages the flag sits
      // alone in a {{sort|…}} cell and the player is the NEXT cell — so if the flag cell has
      // no name, fall through to the following cell only.
      const rest = row.slice(fi);
      const sep = rest.search(/\n\s*[|!]|\|\|/);
      const cell = sep >= 0 ? rest.slice(0, sep) : rest;
      const extract = (text: string): string => {
        const sn = text.match(/\{\{\s*sortname\s*\|([^|}]+)\|([^|}]+)/i);
        if (sn) return `${sn[1]!.trim()} ${sn[2]!.trim()}`;
        const link = text.match(/\[\[([^\]]+)\]\]/);
        return link ? cleanName(`[[${link[1]}]]`) : '';
      };
      player = extract(cell);
      if (!player && sep >= 0) {
        const after = rest.slice(sep);
        const nextStart = after.search(/[^\n|!\s]/);
        const next = nextStart >= 0 ? after.slice(nextStart) : '';
        const nextSep = next.search(/\n\s*[|!]|\|\|/);
        player = extract(nextSep >= 0 ? next.slice(0, nextSep) : next);
      }
    } else if (ym) {
      // No flag icons on this page (e.g. PFA awards): take the first wikilink after the year
      // cell. Club links parsed by mistake resolve to no player and are dropped at match time.
      const rest = row.slice(row.indexOf(ym[1]!) + 4);
      const sn = rest.match(/\{\{\s*sortname\s*\|([^|}]+)\|([^|}]+)/i);
      const link = rest.match(/\[\[([^\]]+)\]\]/);
      if (sn) player = `${sn[1]!.trim()} ${sn[2]!.trim()}`;
      else if (link) player = cleanName(`[[${link[1]}]]`);
    }

    if (!player || !currentYear) continue;
    let placement = 'winner';
    if (cfg.podium) {
      if (/\b1st\b/.test(row)) placement = '1st';
      else if (/\b2nd\b/.test(row)) placement = '2nd';
      else if (/\b3rd\b/.test(row)) placement = '3rd';
      else continue; // not a podium row
    }
    if (cfg.firstPerYear) {
      if (seenYears.has(currentYear)) continue;
      seenYears.add(currentYear);
    }
    out.push({ player, year: currentYear, placement });
  }
  return out;
}

function chunk<T>(a: T[], n: number): T[][] {
  const o: T[][] = [];
  for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n));
  return o;
}

async function main() {
  const probeIdx = process.argv.indexOf('--probe');
  if (probeIdx >= 0) {
    const cfg = AWARDS.find((a) => a.page === process.argv[probeIdx + 1] || a.award === process.argv[probeIdx + 1])!;
    const wt = await fetchWikitext(cfg.page);
    const rows = wt ? parseAward(wt, cfg) : [];
    console.log(`${cfg.award}: ${rows.length} rows`);
    for (const r of rows.slice(0, 20)) console.log(`  ${r.year} ${r.placement.padEnd(6)} ${r.player}`);
    process.exit(0);
  }

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS player_awards (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      player_id uuid REFERENCES players(id) ON DELETE CASCADE,
      player_name text NOT NULL, award text NOT NULL, year integer NOT NULL,
      placement text NOT NULL DEFAULT 'winner',
      created_at timestamp with time zone DEFAULT now() NOT NULL
    )`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS player_awards_unique ON player_awards (award, year, player_name, placement)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS player_awards_player_idx ON player_awards (player_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS player_awards_award_idx ON player_awards (award)`);

  // name -> [{id, apps}] for matching
  const players = (await db.execute(sql`
    SELECT p.id, p.name, p.aliases, COALESCE(SUM(s.appearances),0)::int AS apps
    FROM players p LEFT JOIN player_stats s ON s.player_id = p.id GROUP BY p.id
  `)) as unknown as Array<{ id: string; name: string; aliases: string[]; apps: number }>;
  const byName = new Map<string, Array<{ id: string; apps: number }>>();
  const add = (k: string, id: string, apps: number) => { if (k) (byName.get(k) ?? byName.set(k, []).get(k)!).push({ id, apps }); };
  for (const p of players) {
    add(normalizeSearchText(p.name), p.id, p.apps);
    for (const a of Array.isArray(p.aliases) ? p.aliases : []) add(normalizeSearchText(a), p.id, p.apps);
  }
  const match = (name: string) => {
    const c = byName.get(normalizeSearchText(name));
    return c && c.length ? c.slice().sort((a, b) => b.apps - a.apps)[0]!.id : null;
  };

  let totalRows = 0;
  let totalMatched = 0;
  for (const cfg of AWARDS) {
    const wt = await fetchWikitext(cfg.page);
    await new Promise((r) => setTimeout(r, 200));
    if (!wt) {
      console.log(`  ${cfg.award}: no wikitext`);
      continue;
    }
    const rows = parseAward(wt, cfg);
    // Only keep rows that resolve to a real player — this also self-filters parsing noise
    // (club links like "Bayern Munich" match no player and are dropped).
    const values = rows.map((r) => ({ ...r, playerId: match(r.player) })).filter((v) => v.playerId);
    totalRows += rows.length;
    totalMatched += values.length;
    await db.execute(sql`DELETE FROM player_awards WHERE award = ${cfg.award}`);
    for (const batch of chunk(values, 300)) {
      const tuples = batch.map((v) => sql`(${v.playerId}::uuid, ${v.player}, ${cfg.award}, ${v.year}, ${v.placement})`);
      await db.execute(sql`
        INSERT INTO player_awards (player_id, player_name, award, year, placement)
        VALUES ${sql.join(tuples, sql`, `)}
        ON CONFLICT (award, year, player_name, placement) DO UPDATE SET player_id = EXCLUDED.player_id
      `);
    }
    console.log(`  ${cfg.award}: ${rows.length} parsed · ${values.length} stored (matched to players)`);
  }
  console.log(`\nTotal: ${totalRows} award rows, ${totalMatched} matched to players.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
