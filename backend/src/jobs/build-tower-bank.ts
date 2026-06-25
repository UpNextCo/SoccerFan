/**
 * Build the reviewed Football Tower prompt bank. Runs offline in batches:
 *   Claude proposes → DB verifies solvability → Claude rates difficulty → insert (dedup).
 * Each batch avoids prompts already in the bank, so coverage keeps growing. Re-runnable —
 * just tops the bank up. After building, review in the DB / via job:tower-bank-review and
 * mark bad ones status='rejected'; the daily draw only uses active prompts.
 *
 * Usage: DATABASE_URL=... ANTHROPIC_API_KEY=... npm run job:build-tower-bank [target] [maxBatches]
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { towerPrompts } from '../db/schema.js';
import { countRecallablePlayers, countValidPlayers, sampleFamousPlayers, towerVocab } from '../services/towerRules.js';
import { proposeTowerPrompts, rateTowerDifficulty, type CurationItem } from '../services/llmCuration.js';

function normPrompt(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 48);
}
function abundanceCap(recallable: number): number {
  if (recallable >= 20) return 25;
  if (recallable >= 12) return 40;
  if (recallable >= 6) return 60;
  if (recallable >= 3) return 80;
  return 100;
}
function tierFor(d: number): string {
  if (d >= 70) return 'elite';
  if (d >= 50) return 'hard';
  if (d >= 25) return 'medium';
  return 'easy';
}
function isMalformed(p: string): boolean {
  if (p.length > 110) return true;
  if (/\bor\b/i.test(p)) return true;
  if (/\b(wait|let me|allowed|actually|hmm|i should|note:|i.?ll use)\b/i.test(p)) return true;
  if (p.includes('—') || (p.match(/\./g)?.length ?? 0) > 1) return true;
  return false;
}

async function tierCounts(): Promise<Record<string, number>> {
  const rows = (await db.execute(sql`SELECT tier, COUNT(*)::int AS n FROM tower_prompts WHERE status='active' GROUP BY tier`)) as unknown as Array<{ tier: string; n: number }>;
  const out: Record<string, number> = { easy: 0, medium: 0, hard: 0, elite: 0 };
  for (const r of rows) out[r.tier] = r.n;
  return out;
}

async function main() {
  const target = Number(process.argv[2] ?? 600);
  const maxBatches = Number(process.argv[3] ?? 30);
  const vocab = await towerVocab();

  // Target supply per tier — hard/elite are the scarce, slow-recycling ones the draw needs.
  const TIER_TARGET = { medium: 90, hard: 130, elite: 90 };

  for (let batch = 1; batch <= maxBatches; batch += 1) {
    const tc = await tierCounts();
    const have = tc.easy + tc.medium + tc.hard + tc.elite;
    const hardEliteDone = tc.hard >= TIER_TARGET.hard && tc.elite >= TIER_TARGET.elite;
    const mediumDone = tc.medium >= TIER_TARGET.medium;
    if ((have >= target || mediumDone) && hardEliteDone) {
      console.log(`Bank stocked (medium ${tc.medium}, hard ${tc.hard}, elite ${tc.elite}). Stopping.`);
      break;
    }
    // Once we have enough easy/medium, focus the scarce hard/elite tiers.
    const focus: 'all' | 'hard' = tc.medium >= 60 ? 'hard' : 'all';
    const existing = (await db.execute(sql`SELECT prompt FROM tower_prompts ORDER BY random() LIMIT 80`)) as unknown as Array<{ prompt: string }>;
    const avoid = existing.map((r) => r.prompt);
    console.log(`\nBatch ${batch}/${maxBatches} — medium ${tc.medium} hard ${tc.hard} elite ${tc.elite} · focus=${focus}…`);

    const proposals = await proposeTowerPrompts(vocab, avoid, 60, focus);
    if (!proposals) {
      console.warn('  Proposal failed; stopping.');
      break;
    }

    const verified: Array<{ prompt: string; rule: unknown; valid: number }> = [];
    const seen = new Set<string>();
    for (const p of proposals) {
      const n = normPrompt(p.prompt);
      if (seen.has(n) || isMalformed(p.prompt)) continue;
      seen.add(n);
      let valid = 0;
      try {
        valid = await countValidPlayers(p.rule);
      } catch {
        valid = 0;
      }
      if (valid >= 1) verified.push({ prompt: p.prompt, rule: p.rule, valid });
    }
    if (verified.length === 0) {
      console.log('  Nothing verified this batch.');
      continue;
    }

    const items: CurationItem[] = [];
    const samplesBy = new Map<string, string[]>();
    const recallableBy = new Map<string, number>();
    for (const v of verified) {
      const samples = await sampleFamousPlayers(v.rule as never, 8);
      samplesBy.set(v.prompt, samples);
      recallableBy.set(v.prompt, await countRecallablePlayers(v.rule as never));
      items.push({ id: slug(v.prompt), prompt: v.prompt, samples });
    }
    const ratings = await rateTowerDifficulty(items);

    let inserted = 0;
    for (const v of verified) {
      const claudeDiff = ratings?.get(slug(v.prompt)) ?? 50;
      const diff = Math.min(claudeDiff, abundanceCap(recallableBy.get(v.prompt) ?? 0));
      const res = await db
        .insert(towerPrompts)
        .values({
          prompt: v.prompt,
          promptNorm: normPrompt(v.prompt),
          rule: v.rule,
          answerType: 'player',
          tier: tierFor(diff),
          difficulty: Math.round(diff),
          validAnswers: v.valid,
          sampleAnswers: samplesBy.get(v.prompt) ?? [],
        })
        .onConflictDoNothing({ target: towerPrompts.promptNorm })
        .returning({ id: towerPrompts.id });
      if (res.length) inserted += 1;
    }
    console.log(`  +${inserted} new prompts`);
  }

  const dist = (await db.execute(sql`
    SELECT tier, COUNT(*)::int AS n FROM tower_prompts WHERE status='active' GROUP BY tier ORDER BY tier
  `)) as unknown as Array<{ tier: string; n: number }>;
  console.log('\n=== BANK BY TIER (active) ===');
  console.table(dist);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
