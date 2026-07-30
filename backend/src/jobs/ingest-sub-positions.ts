/**
 * Backfill players.sub_position (fine position: Right-Back, Centre-Back, Left Winger, …) from
 * the Transfermarkt players.csv. Also seeds players.sub_positions with the matched primary.
 *
 * players.csv carries only ONE position per player, so this job can never populate a player's
 * secondary roles — job:backfill-lineup-positions derives those from real match lineups. This
 * job therefore only ever ADDS to sub_positions.
 *
 * Match order: external_id (TM player id) → DOB + name tokens.
 *
 * Usage: DATABASE_URL=... npx tsx src/jobs/ingest-sub-positions.ts [transferdata]
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { VALID_SUB_POSITION_SET } from '../services/playerPositionService.js';

const DIR = process.argv[2] ?? process.env.TM_DIR ?? 'transferdata';

function tokens(name: string): Set<string> {
  return new Set(name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((t) => t.length > 1));
}
function isSubset(small: Set<string>, big: Set<string>): boolean {
  for (const t of small) if (!big.has(t)) return false;
  return true;
}
function dobNameMatch(a: Set<string>, b: Set<string>): boolean {
  const [s, big] = a.size <= b.size ? [a, b] : [b, a];
  return s.size >= 1 && isSubset(s, big);
}

function parseCsv(text: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  let header: string[] | null = null;
  let field = ''; let row: string[] = []; let q = false;
  const pf = () => { row.push(field); field = ''; };
  const pr = () => {
    if (row.length === 1 && row[0] === '') { row = []; return; }
    if (!header) header = row; else { const o: Record<string, string> = {}; for (let i = 0; i < header.length; i += 1) o[header[i]!] = row[i] ?? ''; out.push(o); }
    row = [];
  };
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 1; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === ',') pf();
    else if (c === '\n') { pf(); pr(); }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length > 0) { pf(); pr(); }
  return out;
}

async function main() {
  await db.execute(sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS sub_position text`);
  await db.execute(sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS sub_positions text[] DEFAULT '{}'::text[] NOT NULL`);

  console.log('Loading TM players.csv...');
  const tm = parseCsv(readFileSync(`${DIR}/players.csv`, 'utf8'));

  const tmById = new Map<string, string>();
  const tmByDob = new Map<string, Array<{ toks: Set<string>; sub: string }>>();
  for (const p of tm) {
    const sub = (p.sub_position ?? '').trim();
    if (!VALID_SUB_POSITION_SET.has(sub)) continue;
    const id = (p.player_id ?? p.id ?? '').trim();
    if (id) tmById.set(id, sub);
    const dob = (p.date_of_birth ?? '').slice(0, 10);
    if (!dob) continue;
    (tmByDob.get(dob) ?? tmByDob.set(dob, []).get(dob)!).push({ toks: tokens(p.name ?? ''), sub });
  }

  const ours = (await db.execute(sql`
    SELECT id, name, birth_date::text AS dob, external_id
    FROM players
    WHERE birth_date IS NOT NULL OR external_id IS NOT NULL
  `)) as unknown as Array<{ id: string; name: string; dob: string | null; external_id: string | null }>;

  const updates: Array<{ id: string; sub: string }> = [];
  for (const o of ours) {
    const byId = o.external_id ? tmById.get(o.external_id) : undefined;
    if (byId) {
      updates.push({ id: o.id, sub: byId });
      continue;
    }
    if (!o.dob) continue;
    const cands = (tmByDob.get(o.dob.slice(0, 10)) ?? []).filter((c) => dobNameMatch(c.toks, tokens(o.name)));
    if (cands.length >= 1) updates.push({ id: o.id, sub: cands[0]!.sub });
  }
  console.log(`Matched ${updates.length} players to a sub-position`);

  let done = 0;
  for (let i = 0; i < updates.length; i += 500) {
    const batch = updates.slice(i, i + 500);
    const tuples = batch.map((u) => sql`(${u.id}::uuid, ${u.sub})`);
    // Union rather than assign: sub_positions also holds roles derived from real lineups
    // (job:backfill-lineup-positions) and curated overrides, which must survive a re-run.
    await db.execute(sql`
      UPDATE players AS p
      SET sub_position = COALESCE(p.sub_position, v.s),
          sub_positions = CASE
            WHEN p.sub_positions @> ARRAY[v.s]::text[] THEN p.sub_positions
            ELSE array_append(p.sub_positions, v.s)
          END
      FROM (VALUES ${sql.join(tuples, sql`, `)}) AS v(id, s)
      WHERE p.id = v.id
    `);
    done += batch.length;
  }
  console.log(`Updated ${done} rows.`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
