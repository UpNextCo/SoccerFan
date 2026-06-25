/**
 * Canonicalise players.nationality using utils/nationality.ts so the same nation isn't
 * split across spellings/codes (Ireland vs Republic of Ireland, BFA vs Burkina Faso…).
 * This is what feeds dedupe-by-name's name+nationality grouping (the gap that let the
 * Damien Duff duplicate persist), and also tidies search / prompt nationality matching.
 *
 * Idempotent. DRY RUN by default; pass "apply" to write. Re-run dedupe-by-name afterwards.
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { canonicalNationality } from '../utils/nationality.js';

const APPLY = process.argv.includes('apply') || process.env.APPLY === '1';

async function main() {
  console.log(`Normalise nationalities — ${APPLY ? 'APPLY (writing)' : 'DRY RUN'}\n`);

  const rows = (await db.execute(sql`
    SELECT nationality AS nat, COUNT(*)::int AS n FROM players GROUP BY nationality
  `)) as unknown as Array<{ nat: string; n: number }>;

  const changes: Array<{ from: string; to: string; n: number }> = [];
  let affected = 0;
  for (const r of rows) {
    const canon = canonicalNationality(r.nat);
    if (canon !== r.nat) {
      changes.push({ from: r.nat, to: canon, n: r.n });
      affected += r.n;
    }
  }
  changes.sort((a, b) => b.n - a.n);

  console.log(`${changes.length} nationality strings consolidate · ${affected} players affected\n`);
  for (const c of changes) console.log(`  ${c.from.padEnd(24)} → ${c.to.padEnd(24)} (${c.n})`);

  // Net distinct count after.
  const after = new Set(rows.map((r) => canonicalNationality(r.nat)));
  console.log(`\nDistinct nationalities: ${rows.length} → ${after.size}`);

  if (APPLY) {
    for (const c of changes) {
      await db.execute(sql`UPDATE players SET nationality = ${c.to} WHERE nationality = ${c.from}`);
    }
    console.log('\nApplied. Now re-run: npm run job:dedupe-name  (to merge dups the fix unifies).');
  } else {
    console.log('\n(DRY RUN — re-run with "apply" to write.)');
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
