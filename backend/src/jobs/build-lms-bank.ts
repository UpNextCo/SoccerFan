/**
 * Offline LMS question bank builder.
 *
 * Pipeline (anti-hallucination):
 *   1. Existing DB builders invent NOTHING — they fill facts from Postgres
 *   2. Claude reviews the FINISHED card (keep/reject + difficulty)
 *   3. Keepers land in lms_bank; daily composer draws from there first
 *
 * Usage:
 *   DATABASE_URL=... ANTHROPIC_API_KEY=... npm run job:build-lms-bank
 *   DATABASE_URL=... ANTHROPIC_API_KEY=... npm run job:build-lms-bank -- 80
 *   DATABASE_URL=... ANTHROPIC_API_KEY=... npm run job:build-lms-bank -- 40 --dry
 *
 * Env:
 *   LMS_BANK_SKIP_REVIEW=1  — store without Claude (dev only; not for production quality)
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { reviewLMSQuestions, type LMSReviewItem } from '../services/llmCuration.js';
import { buildCareerPath } from '../services/lastManStanding/builders/careerPath.js';
import { buildHigherLower } from '../services/lastManStanding/builders/higherLower.js';
import { buildImageBadge } from '../services/lastManStanding/builders/imageBadge.js';
import { buildOddOneOut } from '../services/lastManStanding/builders/oddOneOut.js';
import { buildWhichClub } from '../services/lastManStanding/builders/whichClub.js';
import { difficultyForSlot, type LMSTier } from '../services/lastManStanding/difficulty.js';
import { enrichLMSBuilderResult, resetLMSEnrichCache } from '../services/lastManStanding/enrich.js';
import { buildPlayerClubIndex, resetPlayerClubIndex } from '../services/lastManStanding/plausibility.js';
import { famousPlayers } from '../services/lastManStanding/shared.js';
import { LMS_DAILY_SLOTS } from '../services/lastManStanding/slots.js';
import type { LMSBuildContext, LMSBuilderResult, LMSQuestionType } from '../services/lastManStanding/types.js';
import { validateLMSQuestion } from '../services/lastManStanding/validate.js';

const BUILDERS: Record<
  LMSQuestionType,
  (ctx: LMSBuildContext) => Promise<LMSBuilderResult | null>
> = {
  higher_lower: buildHigherLower,
  career_path: buildCareerPath,
  odd_one_out: buildOddOneOut,
  which_club: buildWhichClub,
  image_badge: buildImageBadge,
};

function normKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9:|_-]+/g, '')
    .slice(0, 200);
}

function stripIdsForStorage(built: LMSBuilderResult): LMSBuilderResult {
  // Store with a stable synthetic id — draw path remaps to the daily date/slot.
  const qid = `bank-${built.repeatKey}`.slice(0, 80);
  const oldId = built.question.id;
  return {
    ...built,
    question: {
      ...built.question,
      id: qid,
      options: built.question.options.map((o) => ({
        ...o,
        id: o.id.startsWith(oldId) ? `${qid}${o.id.slice(oldId.length)}` : `${qid}-${o.id}`,
      })),
    },
    answer: {
      ...built.answer,
      questionId: qid,
      correctOptionId: built.answer.correctOptionId.startsWith(oldId)
        ? `${qid}${built.answer.correctOptionId.slice(oldId.length)}`
        : built.answer.correctOptionId,
    },
  };
}

function toReviewItem(id: string, built: LMSBuilderResult, targetTier: LMSTier): LMSReviewItem {
  const correct = built.question.options.find((o) => o.id === built.answer.correctOptionId);
  return {
    id,
    type: built.question.type,
    targetTier,
    prompt: built.question.prompt,
    subPrompt: built.question.subPrompt,
    options: built.question.options.map((o) => o.label),
    correctLabel: correct?.label ?? built.question.options[0]?.label ?? '',
  };
}

function tierFromDifficulty(d: number, fallback: LMSTier): LMSTier {
  if (d >= 78) return 'signature';
  if (d >= 55) return 'hard';
  if (d >= 30) return 'medium';
  if (fallback === 'easy') return 'easy';
  return 'medium';
}

async function ensureTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS lms_bank (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      type text NOT NULL,
      tier text NOT NULL,
      difficulty integer DEFAULT 50 NOT NULL,
      repeat_key text NOT NULL,
      repeat_norm text NOT NULL,
      question_json jsonb NOT NULL,
      answer_json jsonb NOT NULL,
      extra_keys jsonb DEFAULT '[]'::jsonb NOT NULL,
      review_reason text,
      status text DEFAULT 'active' NOT NULL,
      used_count integer DEFAULT 0 NOT NULL,
      last_used_date date,
      created_at timestamptz DEFAULT now() NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS lms_bank_repeat_norm_unique ON lms_bank (repeat_norm)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS lms_bank_type_tier_status_idx ON lms_bank (type, tier, status)
  `);
}

async function existingNorms(): Promise<Set<string>> {
  const rows = (await db.execute(sql`SELECT repeat_norm FROM lms_bank`)) as unknown as Array<{
    repeat_norm: string;
  }>;
  return new Set(rows.map((r) => r.repeat_norm));
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const dry = args.includes('--dry');
  const skipReview = process.env.LMS_BANK_SKIP_REVIEW === '1' || args.includes('--skip-review');
  const target = Math.max(10, Number(args.find((a) => /^\d+$/.test(a)) ?? 60));

  await ensureTable();
  const known = await existingNorms();
  console.log(`LMS bank build — target ${target} new keepers · known ${known.size} · dry=${dry} skipReview=${skipReview}`);

  const pool = await famousPlayers(4, 250);
  resetPlayerClubIndex();
  resetLMSEnrichCache();
  const clubIndex = await buildPlayerClubIndex(pool);

  let kept = 0;
  let rejected = 0;
  let builtFail = 0;
  let batch = 0;

  // Round-robin slots so the bank covers all types/tiers.
  while (kept < target && batch < target * 4) {
    batch += 1;
    const slotDef = LMS_DAILY_SLOTS[(batch - 1) % LMS_DAILY_SLOTS.length]!;
    const builder = BUILDERS[slotDef.type];
    const difficulty = difficultyForSlot(slotDef.slot, slotDef.signature ?? false);
    const usedKeys = new Set<string>();

    const candidates: Array<{ localId: string; built: LMSBuilderResult; tier: LMSTier }> = [];

    for (let attempt = 0; attempt < 12 && candidates.length < 6; attempt += 1) {
      const ctx: LMSBuildContext = {
        date: `bank-${batch}`,
        slot: slotDef.slot,
        signature: slotDef.signature ?? false,
        seed: `lms-bank:${Date.now()}:${batch}:${attempt}`,
        usedKeys,
        difficulty,
        famousPool: pool,
        clubIndex,
      };
      let candidate = await builder(ctx);
      if (!candidate) {
        builtFail += 1;
        continue;
      }
      if (known.has(normKey(candidate.repeatKey)) || usedKeys.has(candidate.repeatKey)) continue;
      candidate = await enrichLMSBuilderResult(candidate);
      if (!validateLMSQuestion(candidate, ctx)) continue;

      usedKeys.add(candidate.repeatKey);
      candidate.extraUsedKeys?.forEach((k) => usedKeys.add(k));
      const stored = stripIdsForStorage(candidate);
      candidates.push({
        localId: `b${batch}a${attempt}`,
        built: stored,
        tier: difficulty.tier,
      });
    }

    if (candidates.length === 0) continue;

    let verdicts =
      skipReview
        ? candidates.map((c) => ({
            id: c.localId,
            keep: true,
            difficulty: c.tier === 'easy' ? 25 : c.tier === 'medium' ? 45 : c.tier === 'signature' ? 80 : 65,
            casualWouldNailIt: false,
            reason: 'skip-review',
          }))
        : await reviewLMSQuestions(candidates.map((c) => toReviewItem(c.localId, c.built, c.tier)));

    if (!verdicts) {
      console.warn('  Claude review failed — skipping batch (set LMS_BANK_SKIP_REVIEW=1 to bypass)');
      continue;
    }

    const byId = new Map(verdicts.map((v) => [v.id, v]));
    for (const c of candidates) {
      const v = byId.get(c.localId);
      if (!v) continue;
      if (!v.keep) {
        rejected += 1;
        console.log(`  ✗ reject [${c.built.question.type}/${c.tier}] ${c.built.question.prompt.slice(0, 60)}… — ${v.reason}`);
        continue;
      }

      const tier = tierFromDifficulty(v.difficulty, c.tier);
      const repeatNorm = normKey(c.built.repeatKey);
      if (known.has(repeatNorm)) continue;

      if (dry) {
        kept += 1;
        known.add(repeatNorm);
        console.log(`  ✓ dry keep [${c.built.question.type}/${tier} d=${v.difficulty}] ${c.built.question.prompt.slice(0, 60)}…`);
        continue;
      }

      await db.execute(sql`
        INSERT INTO lms_bank (
          type, tier, difficulty, repeat_key, repeat_norm,
          question_json, answer_json, extra_keys, review_reason, status
        ) VALUES (
          ${c.built.question.type},
          ${tier},
          ${v.difficulty},
          ${c.built.repeatKey},
          ${repeatNorm},
          ${JSON.stringify(c.built.question)}::jsonb,
          ${JSON.stringify(c.built.answer)}::jsonb,
          ${JSON.stringify(c.built.extraUsedKeys ?? [])}::jsonb,
          ${v.reason || null},
          'active'
        )
        ON CONFLICT (repeat_norm) DO NOTHING
      `);
      known.add(repeatNorm);
      kept += 1;
      console.log(`  ✓ keep [${c.built.question.type}/${tier} d=${v.difficulty}] ${c.built.question.prompt.slice(0, 60)}…`);
    }

    console.log(`  progress ${kept}/${target} kept · ${rejected} rejected · batch ${batch}`);
  }

  const counts = (await db.execute(sql`
    SELECT type, tier, COUNT(*)::int AS n FROM lms_bank WHERE status = 'active' GROUP BY type, tier ORDER BY type, tier
  `)) as unknown as Array<{ type: string; tier: string; n: number }>;
  console.log('\nActive bank:');
  for (const r of counts) console.log(`  ${r.type.padEnd(14)} ${r.tier.padEnd(10)} ${r.n}`);
  console.log(`\nDone — kept ${kept}, rejected ${rejected}, builder misses ~${builtFail}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
