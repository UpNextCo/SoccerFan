/**
 * Step 1 of the historical-season backfill: map our players to their Transfermarkt id using the
 * local Kaggle players.csv (TM player_id + name + DOB + url slug). Matching is DOB + name-token
 * subset (precise — avoids wrong merges), the same approach as import-transfermarkt.
 *
 * Output: transferdata/tm_id_map.json  [{ ourId, tmId, code, name }]
 * Usage: npx tsx src/jobs/map-transfermarkt-ids.ts [transferdataDir]
 */
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { normalizeSearchText } from '../utils/playerSearch.js';

const DIR = process.argv[2] ?? 'transferdata';

function parseCsv(text: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  let header: string[] | null = null;
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => {
    if (row.length === 1 && row[0] === '') { row = []; return; }
    if (!header) header = row;
    else { const o: Record<string, string> = {}; for (let i = 0; i < header.length; i += 1) o[header[i]!] = row[i] ?? ''; out.push(o); }
    row = [];
  };
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 1; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') pushField();
    else if (c === '\n') { pushField(); pushRow(); }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length > 0) { pushField(); pushRow(); }
  return out;
}

function tokens(name: string): Set<string> {
  return new Set(
    name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((t) => t.length > 1)
  );
}
function isSubset(small: Set<string>, big: Set<string>): boolean {
  for (const t of small) if (!big.has(t)) return false;
  return small.size > 0;
}

async function main() {
  const ours = (await db.execute(sql`
    SELECT id, name, birth_date::text AS dob FROM players WHERE birth_date IS NOT NULL
  `)) as unknown as Array<{ id: string; name: string; dob: string }>;

  // Index our players by DOB -> candidates (with name tokens).
  const byDob = new Map<string, Array<{ id: string; name: string; toks: Set<string> }>>();
  for (const p of ours) {
    const dob = p.dob.slice(0, 10);
    const arr = byDob.get(dob) ?? [];
    arr.push({ id: p.id, name: p.name, toks: tokens(p.name) });
    byDob.set(dob, arr);
  }

  const tm = parseCsv(readFileSync(join(DIR, 'players.csv'), 'utf8'));
  const map: Array<{ ourId: string; tmId: string; code: string; name: string }> = [];
  const usedOurIds = new Set<string>();
  let multi = 0;

  for (const row of tm) {
    const dob = (row.date_of_birth ?? '').slice(0, 10);
    if (!dob) continue;
    const cands = byDob.get(dob);
    if (!cands) continue;
    const tmToks = tokens(row.name ?? '');
    if (tmToks.size === 0) continue;
    // Match if names share a token-subset either direction (handles legal vs common names).
    const hits = cands.filter((c) => isSubset(tmToks, c.toks) || isSubset(c.toks, tmToks));
    if (hits.length === 0) continue;
    if (hits.length > 1) multi += 1;
    const best = hits[0]!;
    if (usedOurIds.has(best.id)) continue;
    usedOurIds.add(best.id);
    map.push({ ourId: best.id, tmId: row.player_id!, code: row.player_code ?? '', name: best.name });
  }

  writeFileSync(join(DIR, 'tm_id_map.json'), JSON.stringify(map, null, 0));
  console.log(`Our players with DOB: ${ours.length}`);
  console.log(`Mapped to a Transfermarkt id: ${map.length} (${multi} had >1 same-DOB candidate)`);
  console.log(`Wrote ${join(DIR, 'tm_id_map.json')}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
