/**
 * Manual QA for the Football Tower bank.
 *   export (default): writes tower_bank_review.csv (sorted by tier, difficulty) to review.
 *   apply <file>:     reads the edited CSV and applies your `tier` / `status` changes by id.
 *
 * Workflow: run export → open the CSV in Sheets → fix any wrong `tier` or set
 * `status` = rejected for bad prompts → run apply. The daily draw uses only active rows.
 *
 * Usage: DATABASE_URL=... npm run job:tower-bank-review            (export)
 *        DATABASE_URL=... npm run job:tower-bank-review apply f.csv (apply edits)
 */
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

const FILE = 'tower_bank_review.csv';
const COLS = ['id', 'tier', 'status', 'difficulty', 'valid_answers', 'prompt', 'sample_answers'] as const;

function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let q = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 1; } else q = false; } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); field = ''; row = []; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift() ?? [];
  return rows.filter((r) => r.some((c) => c !== '')).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

async function main() {
  const mode = process.argv[2] === 'apply' ? 'apply' : 'export';

  if (mode === 'export') {
    const rows = (await db.execute(sql`
      SELECT id, tier, status, difficulty, valid_answers, prompt, sample_answers
      FROM tower_prompts
      ORDER BY CASE tier WHEN 'easy' THEN 0 WHEN 'medium' THEN 1 WHEN 'hard' THEN 2 ELSE 3 END, difficulty
    `)) as unknown as Array<Record<string, unknown>>;
    const lines = [COLS.join(',')];
    for (const r of rows) {
      const samples = Array.isArray(r.sample_answers) ? (r.sample_answers as string[]).join('; ') : '';
      lines.push([r.id, r.tier, r.status, r.difficulty, r.valid_answers, r.prompt, samples].map(csvCell).join(','));
    }
    writeFileSync(FILE, lines.join('\n'));
    console.log(`Exported ${rows.length} prompts to ${FILE}. Edit 'tier'/'status', then: npm run job:tower-bank-review apply ${FILE}`);
    process.exit(0);
  }

  const file = process.argv[3] ?? FILE;
  const recs = parseCsv(readFileSync(file, 'utf8'));
  let changed = 0;
  for (const r of recs) {
    if (!r.id) continue;
    const tier = (r.tier ?? '').trim();
    const status = (r.status ?? '').trim();
    if (!['easy', 'medium', 'hard', 'elite'].includes(tier) || !['active', 'rejected'].includes(status)) continue;
    const res = await db.execute(sql`
      UPDATE tower_prompts SET tier = ${tier}, status = ${status}
      WHERE id = ${r.id}::uuid AND (tier <> ${tier} OR status <> ${status})
      RETURNING id
    `);
    if ((res as unknown as unknown[]).length) changed += 1;
  }
  console.log(`Applied ${changed} edits from ${file}.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
