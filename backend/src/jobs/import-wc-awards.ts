/**
 * Import World Cup individual awards from the Wikipedia "FIFA World Cup awards" article
 * into player_awards: Golden Ball (best player), Golden Boot (top scorer), Golden Glove
 * (best keeper, 1994+) and the FIFA Young Player Award (2006+).
 *
 * Each award is a section whose winners table has a `[[YYYY FIFA World Cup|…]]` year cell
 * followed by a `{{fbicon|XXX}} [[Winner]]` cell. We take the winner (placement='winner')
 * for every tournament and match to our players by normalized name (tie-break career apps).
 *
 * Usage: DATABASE_URL=... npx tsx src/jobs/import-wc-awards.ts [--probe]
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { normalizeSearchText } from '../utils/playerSearch.js';

const PAGE = 'FIFA World Cup awards';

// award label → text anchor at which its winners table begins.
const AWARDS: Array<{ award: string; anchor: string }> = [
  { award: 'World Cup Golden Ball', anchor: 'Official winners (1982' },
  { award: 'World Cup Golden Boot', anchor: '==Golden Boot==' },
  { award: 'World Cup Golden Glove', anchor: '==Golden Glove==' },
  { award: 'World Cup Young Player', anchor: '==FIFA Young Player Award==' },
];

async function fetchWikitext(title: string): Promise<string | null> {
  const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&format=json&formatversion=2&redirects=1`;
  const res = await fetch(url, { headers: { 'User-Agent': 'BallKnowledge/1.0 (dev@ballknowledge.app)' } });
  if (!res.ok) return null;
  return ((await res.json()) as any)?.parse?.wikitext ?? null;
}

function firstLinkName(cell: string): string {
  const m = cell.match(/\[\[([^\]]+)\]\]/);
  if (!m) return '';
  const inner = m[1]!.includes('|') ? m[1]!.split('|').pop()! : m[1]!;
  return inner.replace(/\{\{[^}]*\}\}/g, '').replace(/'''/g, '').replace(/\s+/g, ' ').trim();
}

interface Row { player: string; year: number; }

function parseAward(wt: string, anchor: string): Row[] {
  const start = wt.indexOf(anchor);
  if (start < 0) return [];
  const table = wt.slice(start).match(/\{\|[\s\S]*?\n\|\}/)?.[0];
  if (!table) return [];

  const out: Row[] = [];
  for (const rowChunk of table.split(/\n\|-/)) {
    const cells = rowChunk.split(/\n\s*\|/).map((c) => c.trim()).filter(Boolean);
    const yearIdx = cells.findIndex((c) => /\[\[\d{4}\s+FIFA World Cup/.test(c));
    if (yearIdx < 0 || yearIdx + 1 >= cells.length) continue;
    const year = parseInt(cells[yearIdx]!.match(/\[\[(\d{4})\s+FIFA World Cup/)![1]!, 10);
    const player = firstLinkName(cells[yearIdx + 1]!);
    if (player && year) out.push({ player, year });
  }
  return out;
}

function chunk<T>(a: T[], n: number): T[][] {
  const o: T[][] = [];
  for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n));
  return o;
}

async function main() {
  const wt = await fetchWikitext(PAGE);
  if (!wt) throw new Error('Could not fetch FIFA World Cup awards wikitext');

  if (process.argv.includes('--probe')) {
    for (const a of AWARDS) {
      const rows = parseAward(wt, a.anchor);
      console.log(`\n${a.award}: ${rows.length} rows`);
      for (const r of rows) console.log(`  ${r.year}  ${r.player}`);
    }
    process.exit(0);
  }

  // name → [{id, apps}] for matching (incl. aliases)
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

  let stored = 0;
  for (const a of AWARDS) {
    const rows = parseAward(wt, a.anchor);
    const values = rows.map((r) => ({ ...r, playerId: match(r.player) })).filter((v) => v.playerId);
    await db.execute(sql`DELETE FROM player_awards WHERE award = ${a.award}`);
    for (const batch of chunk(values, 200)) {
      const tuples = batch.map((v) => sql`(${v.playerId}::uuid, ${v.player}, ${a.award}, ${v.year}, 'winner')`);
      await db.execute(sql`
        INSERT INTO player_awards (player_id, player_name, award, year, placement)
        VALUES ${sql.join(tuples, sql`, `)}
        ON CONFLICT (award, year, player_name, placement) DO UPDATE SET player_id = EXCLUDED.player_id
      `);
    }
    stored += values.length;
    console.log(`  ${a.award}: ${rows.length} parsed · ${values.length} matched & stored`);
  }
  console.log(`\nTotal stored: ${stored}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
