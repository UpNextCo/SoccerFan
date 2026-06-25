/**
 * Deactivate duplicate "played for both A and B" Tower prompts that exist in both club
 * orders (A+B and B+A are the same question). Keeps the least-recently-used of each pair,
 * rejects the rest. Pure DB. Usage: DATABASE_URL=... npm run job:dedupe-tower-bank [--apply]
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { normClub } from '../services/managerRules.js';

async function main() {
  const apply = process.argv.includes('--apply');
  const rows = (await db.execute(sql`
    SELECT id, prompt, rule, used_count FROM tower_prompts WHERE status = 'active'
  `)) as unknown as Array<{ id: string; prompt: string; rule: { playedFor?: string[] }; used_count: number }>;

  // group club-pair prompts by their unordered club set
  const groups = new Map<string, Array<{ id: string; prompt: string; used: number }>>();
  for (const r of rows) {
    const clubs = r.rule?.playedFor;
    if (!Array.isArray(clubs) || clubs.length !== 2) continue;
    const key = clubs.map(normClub).sort().join(' + ');
    (groups.get(key) ?? groups.set(key, []).get(key)!).push({ id: r.id, prompt: r.prompt, used: r.used_count });
  }

  const doomed: string[] = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    // keep the least-used; reject the others
    list.sort((a, b) => a.used - b.used);
    const [keep, ...rest] = list;
    console.log(`  ${key}: keep "${keep!.prompt}" · drop ${rest.length}`);
    doomed.push(...rest.map((r) => r.id));
  }
  console.log(`\n${groups.size} club pairs · ${doomed.length} reversed-order duplicates to deactivate`);

  if (apply && doomed.length) {
    for (let i = 0; i < doomed.length; i += 300) {
      const batch = doomed.slice(i, i + 300);
      await db.execute(sql`UPDATE tower_prompts SET status='rejected' WHERE id IN (${sql.join(batch.map((id) => sql`${id}`), sql`, `)})`);
    }
    console.log(`✅ Deactivated ${doomed.length} duplicates.`);
  } else if (!apply) {
    console.log('(dry run — re-run with --apply)');
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
