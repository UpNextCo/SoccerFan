/**
 * Prune "database-hard" Tower prompts that have no recognisable (star) answer.
 *
 * Difficulty should come from a famous subject + a hard connection, not from obscurity.
 * A prompt whose best answer is a journeyman (e.g. "Udinese + Manchester City") is
 * near-unsolvable and not fun. We gate on the highest market_value_tier among answers —
 * fully populated and correctly rating legends as 5 — and deactivate prompts whose best
 * answer is below tier 4. Closed-set relationship prompts are exempt (curated around
 * famous entities).
 *
 * --apply writes (status='rejected'); without it, dry-run only.
 * Usage: DATABASE_URL=... npm run job:prune-tower-bank [--apply]
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { bestAnswerTier, type TowerRule } from '../services/towerRules.js';

const STAR_TIER = 4; // best answer must be at least market_value_tier 4

async function main() {
  const apply = process.argv.includes('--apply');
  const rows = (await db.execute(sql`
    SELECT id, prompt, rule, tier FROM tower_prompts WHERE status = 'active'
  `)) as unknown as Array<{ id: string; prompt: string; rule: TowerRule; tier: string }>;

  const doomed: Array<{ id: string; prompt: string; tier: string; best: number }> = [];
  for (const r of rows) {
    // Relationship (closed-set) prompts are curated around famous entities — keep.
    if (r.rule?.validIds) continue;
    const best = await bestAnswerTier(r.rule);
    if (best < STAR_TIER) doomed.push({ id: r.id, prompt: r.prompt, tier: r.tier, best });
  }

  doomed.sort((a, b) => a.best - b.best);
  console.log(`${rows.length} active prompts · ${doomed.length} with no answer at tier ${STAR_TIER}+\n`);
  for (const d of doomed.slice(0, 40)) {
    console.log(`  [${d.tier.padEnd(6)}] best tier ${d.best}  ${d.prompt}`);
  }
  if (doomed.length > 40) console.log(`  …and ${doomed.length - 40} more`);

  if (apply && doomed.length) {
    const ids = doomed.map((d) => d.id);
    for (let i = 0; i < ids.length; i += 300) {
      const batch = ids.slice(i, i + 300);
      await db.execute(sql`UPDATE tower_prompts SET status = 'rejected' WHERE id IN (${sql.join(batch.map((id) => sql`${id}`), sql`, `)})`);
    }
    console.log(`\n✅ Deactivated ${ids.length} low-fame prompts (status='rejected').`);
  } else if (!apply) {
    console.log(`\n(dry run — re-run with --apply to deactivate)`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
