/**
 * Build + QA the curated "memorable World Cup moments" clue bank for World Cup XI.
 *
 *   build (default): ask Claude for memorable players + story clues per World Cup, DB-verify each
 *                    to that year's squad, upsert into wc_memorable (status active), and export
 *                    wc_memorable_review.csv.
 *   apply <file>:    read the edited CSV and apply your `status` (active|rejected) changes by id.
 *
 * Workflow: run build → open the CSV → set status=rejected for any wrong/weak clue → run apply.
 * The generator draws only active rows.
 *
 * Usage: DATABASE_URL=... ANTHROPIC_API_KEY=... npx tsx src/jobs/build-wc-memorable.ts
 *        DATABASE_URL=... npx tsx src/jobs/build-wc-memorable.ts apply wc_memorable_review.csv
 */
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { proposeMemorable } from '../services/llmCuration.js';

const YEARS = [1994, 1998, 2002, 2006, 2010, 2014, 2018, 2022];
const FILE = 'wc_memorable_review.csv';
const COLS = ['id', 'year', 'status', 'position', 'player', 'clue'] as const;

function norm(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
function toks(s: string): Set<string> { return new Set(norm(s).split(' ').filter((t) => t.length > 1)); }
function surnameMatch(a: string, b: string): boolean {
  const ta = toks(a); const tb = toks(b);
  const la = [...ta].pop(); const lb = [...tb].pop();
  if (!la || !lb || la !== lb) return false;
  for (const t of ta) if (tb.has(t)) return true;
  return false;
}
function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = ''; let row: string[] = []; let q = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 1; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); field = ''; row = []; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift() ?? [];
  return rows.filter((r) => r.some((c) => c !== '')).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

async function ensureTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS wc_memorable (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      year integer NOT NULL,
      player_id uuid REFERENCES players(id) ON DELETE CASCADE,
      player_name text NOT NULL,
      position text NOT NULL DEFAULT '',
      clue text NOT NULL,
      status text NOT NULL DEFAULT 'active',
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS wc_memorable_unique ON wc_memorable (year, player_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS wc_memorable_year_status_idx ON wc_memorable (year, status)`);
}

async function exportCsv(): Promise<void> {
  const rows = (await db.execute(sql`
    SELECT id, year, status, position, player_name, clue FROM wc_memorable ORDER BY year, position, player_name
  `)) as unknown as Array<Record<string, unknown>>;
  const lines = [COLS.join(',')];
  for (const r of rows) lines.push([r.id, r.year, r.status, r.position, r.player_name, r.clue].map(csvCell).join(','));
  writeFileSync(FILE, lines.join('\n'));
  console.log(`Exported ${rows.length} memorable clues to ${FILE}.`);
}

async function build(): Promise<void> {
  await ensureTable();
  // Full rebuild so older obscure entries from a previous run are removed. Recent World Cups get
  // a deep set; pre-2006 tournaments get a small, iconic-only set.
  await db.execute(sql`DELETE FROM wc_memorable`);
  for (const year of YEARS) {
    const count = year >= 2006 ? 35 : 14;
    const proposals = await proposeMemorable(year, count);
    if (!proposals) { console.log(`  ${year}: no proposals (API key / failure)`); continue; }

    const squad = (await db.execute(sql`
      SELECT player_name, player_id FROM wc_squads WHERE year = ${year} AND player_id IS NOT NULL
    `)) as unknown as Array<{ player_name: string; player_id: string }>;

    const seen = new Set<string>();
    let stored = 0;
    for (const p of proposals) {
      const match = squad.find((s) => surnameMatch(s.player_name, p.player));
      if (!match || seen.has(match.player_id)) continue; // unverified or duplicate player
      seen.add(match.player_id);
      await db.execute(sql`
        INSERT INTO wc_memorable (year, player_id, player_name, position, clue, status)
        VALUES (${year}, ${match.player_id}::uuid, ${match.player_name}, ${p.position}, ${p.clue}, 'active')
        ON CONFLICT (year, player_id) DO UPDATE SET clue = EXCLUDED.clue, position = EXCLUDED.position
      `);
      stored += 1;
    }
    console.log(`  ${year}: ${proposals.length} proposed · ${stored} verified & stored`);
  }
  await exportCsv();
}

async function apply(file: string): Promise<void> {
  const recs = parseCsv(readFileSync(file, 'utf8'));
  let changed = 0;
  for (const r of recs) {
    if (!r.id) continue;
    const status = (r.status ?? '').trim();
    if (!['active', 'rejected'].includes(status)) continue;
    const clue = (r.clue ?? '').trim();
    const res = clue
      ? await db.execute(sql`UPDATE wc_memorable SET status = ${status}, clue = ${clue} WHERE id = ${r.id}::uuid RETURNING id`)
      : await db.execute(sql`UPDATE wc_memorable SET status = ${status} WHERE id = ${r.id}::uuid AND status <> ${status} RETURNING id`);
    if ((res as unknown as unknown[]).length) changed += 1;
  }
  console.log(`Applied ${changed} edits from ${file}.`);
}

async function main() {
  if (process.argv[2] === 'apply') await apply(process.argv[3] ?? FILE);
  else if (process.argv[2] === 'export') await exportCsv();
  else await build();
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
