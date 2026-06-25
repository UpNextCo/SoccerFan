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
}

const AWARDS: AwardCfg[] = [
  { award: "Ballon d'Or", page: "Ballon d'Or", podium: true },
  { award: 'European Golden Shoe', page: 'European Golden Shoe', podium: false },
  // World Cup Golden Boot is computed from our WC data (top scorer per tournament) in
  // build-milestone-prompts, since that article doesn't use {{flagicon}} winner rows.
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

function parseAward(wt: string, podium: boolean): Row[] {
  // main table = the wikitable with the most flag icons (the winners table)
  const blocks = [...wt.matchAll(/\{\|[\s\S]*?\n\|\}/g)].map((m) => m[0]);
  const table = blocks.sort((a, b) => (b.match(/\{\{flagicon/g)?.length ?? 0) - (a.match(/\{\{flagicon/g)?.length ?? 0))[0];
  if (!table) return [];

  const out: Row[] = [];
  let currentYear = 0;
  for (const row of table.split(/\n\|-/)) {
    const fi = row.indexOf('{{flagicon');
    const head = fi >= 0 ? row.slice(0, fi) : row;
    const ym = head.match(/\b(\d{4})\b/); // year/season cell precedes the player's flag
    if (ym) currentYear = parseInt(ym[1]!, 10);
    if (fi < 0) continue; // section header / legend row
    // Player is in the cell right after the flag. It's either a wikilink (Ballon d'Or:
    // [[Stanley Matthews]]) or a {{sortname|First|Last}} template (Golden Shoe). Restrict
    // to that cell so we never read the adjacent club/league cell.
    const rest = row.slice(fi);
    const sep = rest.search(/\n\s*[|!]|\|\|/);
    const cell = sep >= 0 ? rest.slice(0, sep) : rest;
    let player = '';
    const sn = cell.match(/\{\{\s*sortname\s*\|([^|}]+)\|([^|}]+)/i);
    if (sn) player = `${sn[1]!.trim()} ${sn[2]!.trim()}`;
    else {
      const link = cell.match(/\[\[([^\]]+)\]\]/);
      if (link) player = cleanName(`[[${link[1]}]]`);
    }
    if (!player || !currentYear) continue;
    let placement = 'winner';
    if (podium) {
      if (/\b1st\b/.test(row)) placement = '1st';
      else if (/\b2nd\b/.test(row)) placement = '2nd';
      else if (/\b3rd\b/.test(row)) placement = '3rd';
      else continue; // not a podium row
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
    const rows = wt ? parseAward(wt, cfg.podium) : [];
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
    const rows = parseAward(wt, cfg.podium);
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
