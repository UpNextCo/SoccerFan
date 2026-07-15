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
 *   DATABASE_URL=... ANTHROPIC_API_KEY=... npm run job:build-lms-bank -- --total 450
 *   DATABASE_URL=... ANTHROPIC_API_KEY=... npm run job:build-lms-bank -- --new 40 --dry
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
import type {
  LMSBuildContext,
  LMSBuilderResult,
  LMSQuestionAnswer,
  LMSQuestionPublic,
  LMSGeneratedQuestionType,
} from '../services/lastManStanding/types.js';
import { validateLMSQuestion } from '../services/lastManStanding/validate.js';
import { backfillLMSBankContentSignatures } from '../services/lastManStanding/bank.js';
import {
  LMS_COOLDOWN_MINIMUM_BY_TYPE,
  LMS_COOLDOWN_MINIMUM_TOTAL,
  lmsContentSignature,
  summarizeLMSBankInventory,
} from '../services/lastManStanding/freshness.js';

const BUILDERS: Record<
  LMSGeneratedQuestionType,
  (ctx: LMSBuildContext) => Promise<LMSBuilderResult | null>
> = {
  higher_lower: buildHigherLower,
  career_path: buildCareerPath,
  odd_one_out: buildOddOneOut,
  which_club: buildWhichClub,
  image_badge: buildImageBadge,
};

function isGeneratedQuestionType(type: LMSQuestionPublic['type']): type is LMSGeneratedQuestionType {
  return type in BUILDERS;
}

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
      content_signature text,
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
  await db.execute(sql`ALTER TABLE lms_bank ADD COLUMN IF NOT EXISTS content_signature text`);
  await db.execute(sql`DROP INDEX IF EXISTS lms_bank_repeat_norm_unique`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS lms_bank_repeat_norm_idx ON lms_bank (repeat_norm)`);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS lms_bank_content_signature_unique
    ON lms_bank (content_signature) WHERE content_signature IS NOT NULL
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS lms_bank_type_tier_status_idx ON lms_bank (type, tier, status)
  `);
}

async function loadBankInventory() {
  const rows = (await db.execute(sql`
    SELECT type, status, content_signature, question_json, answer_json
    FROM lms_bank
  `)) as unknown as Array<{
    type: LMSGeneratedQuestionType;
    status: string;
    content_signature: string | null;
    question_json: LMSQuestionPublic;
    answer_json: LMSQuestionAnswer;
  }>;
  return summarizeLMSBankInventory(rows.map((row) => ({
    type: row.type,
    status: row.status,
    contentSignature: row.content_signature,
    question: row.question_json,
    answer: row.answer_json,
  })));
}

function numericArg(args: string[], name: string): number | null {
  const direct = args.find((arg) => arg.startsWith(`${name}=`));
  if (direct) return Number(direct.slice(name.length + 1));
  const index = args.indexOf(name);
  return index >= 0 ? Number(args[index + 1]) : null;
}

function stringArg(args: string[], name: string): string | null {
  const direct = args.find((arg) => arg.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? null : null;
}

function printTypeInventory(counts: Record<LMSGeneratedQuestionType, number>): void {
  console.log(
    `Distinct signed inventory by type (45-day exact-repeat minimum; broad resources cool down ` +
    `${process.env.LMS_BROAD_COOLDOWN_DAYS ?? 3} days):`
  );
  for (const type of Object.keys(LMS_COOLDOWN_MINIMUM_BY_TYPE) as LMSGeneratedQuestionType[]) {
    const minimum = LMS_COOLDOWN_MINIMUM_BY_TYPE[type];
    const count = counts[type];
    console.log(`  ${type.padEnd(14)} ${String(count).padStart(4)} / ${minimum}`);
  }
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  console.log(`  ${'TOTAL'.padEnd(14)} ${String(total).padStart(4)} / ${LMS_COOLDOWN_MINIMUM_TOTAL}`);
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const dry = args.includes('--dry');
  const skipReview = process.env.LMS_BANK_SKIP_REVIEW === '1' || args.includes('--skip-review');
  const positional = args.find(
    (arg, index) =>
      /^\d+$/.test(arg) &&
      args[index - 1] !== '--new' &&
      args[index - 1] !== '--total'
  );
  const newArg = numericArg(args, '--new') ?? (positional ? Number(positional) : null);
  const totalArg = numericArg(args, '--total');
  const typeArg = stringArg(args, '--type') as LMSGeneratedQuestionType | null;
  if (typeArg && !(typeArg in BUILDERS)) {
    throw new Error(`Unknown LMS type: ${typeArg}`);
  }
  if (newArg != null && totalArg != null) throw new Error('Choose either --new N or --total N, not both');
  if (newArg != null && (!Number.isFinite(newArg) || newArg < 0)) {
    throw new Error('--new must be a non-negative number');
  }
  if (totalArg != null && (!Number.isFinite(totalArg) || totalArg < 0)) {
    throw new Error('--total must be a non-negative number');
  }

  let backfill = { signed: 0, duplicatesRejected: 0 };
  if (!dry) {
    await ensureTable();
    backfill = await backfillLMSBankContentSignatures();
  }
  // Dry mode is strictly read-only. Nullable legacy rows are signed in memory for planning.
  const inventory = await loadBankInventory();
  const known = inventory.knownSignatures;
  const typeCounts = inventory.activeDistinctByType;
  const activeTotal = Object.values(typeCounts).reduce((sum, count) => sum + count, 0);
  const requestedTotal = Math.max(0, totalArg ?? (newArg == null ? LMS_COOLDOWN_MINIMUM_TOTAL : 0));
  const inventoryDeficit = (Object.keys(typeCounts) as LMSGeneratedQuestionType[]).reduce(
    (sum, type) => sum + Math.max(0, LMS_COOLDOWN_MINIMUM_BY_TYPE[type] - typeCounts[type]),
    0
  );
  const totalDeficit = requestedTotal - activeTotal;
  const target = Math.max(
    0,
    Math.floor(newArg ?? Math.max(totalDeficit, requestedTotal >= LMS_COOLDOWN_MINIMUM_TOTAL
      ? inventoryDeficit
      : 0))
  );
  const targetDescription = newArg != null
    ? `${target} new keepers`
    : `total ${requestedTotal} (${target} new needed)`;
  console.log(
    `LMS bank build — target ${targetDescription} · ${known.size} signatures · ` +
    `backfilled ${backfill.signed}, rejected ${backfill.duplicatesRejected} duplicates · ` +
    `dry=${dry} skipReview=${skipReview}`
  );
  printTypeInventory(typeCounts);
  if (target === 0) {
    console.log('\nDone — target already met');
    process.exit(0);
  }

  const pool = await famousPlayers(4, 250);
  resetPlayerClubIndex();
  resetLMSEnrichCache();
  const clubIndex = await buildPlayerClubIndex(pool);
  const eligibleSlots = typeArg
    ? LMS_DAILY_SLOTS.filter((slot) => slot.type === typeArg)
    : LMS_DAILY_SLOTS;
  if (eligibleSlots.length === 0) throw new Error(`No LMS slots for type ${typeArg}`);

  let kept = 0;
  let rejected = 0;
  let builtFail = 0;
  let batch = 0;
  let slotCursor = 0;

  // Round-robin slots so the bank covers all types/tiers.
  while (kept < target && batch < Math.max(20, target * 8)) {
    batch += 1;
    const hasInventoryDeficit = (Object.keys(typeCounts) as LMSGeneratedQuestionType[])
      .some((type) => typeCounts[type] < LMS_COOLDOWN_MINIMUM_BY_TYPE[type]);
    let slotDef = eligibleSlots[slotCursor % eligibleSlots.length]!;
    for (let scan = 0; scan < eligibleSlots.length; scan += 1) {
      const candidateSlot = eligibleSlots[(slotCursor + scan) % eligibleSlots.length]!;
      if (!hasInventoryDeficit ||
          typeCounts[candidateSlot.type] < LMS_COOLDOWN_MINIMUM_BY_TYPE[candidateSlot.type]) {
        slotDef = candidateSlot;
        slotCursor += scan + 1;
        break;
      }
    }
    const builder = BUILDERS[slotDef.type];
    const difficulty = difficultyForSlot(slotDef.slot, slotDef.signature ?? false);

    const candidateTarget = Math.min(typeArg ? 8 : 6, target - kept);
    const candidates: Array<{ localId: string; built: LMSBuilderResult; tier: LMSTier }> = [];
    const batchSignatures = new Set<string>();

    for (
      let attempt = 0;
      attempt < (typeArg ? 24 : 12) && candidates.length < candidateTarget;
      attempt += 1
    ) {
      // Bank generation is not a daily puzzle: do not block fresh signatures merely because
      // they share a player, club or repeatKey with another bank card.
      const usedKeys = new Set<string>();
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
      candidate = await enrichLMSBuilderResult(candidate);
      if (!validateLMSQuestion(candidate, ctx)) continue;
      const contentSignature = lmsContentSignature(candidate.question, candidate.answer);
      if (!contentSignature || known.has(contentSignature) || batchSignatures.has(contentSignature)) continue;

      batchSignatures.add(contentSignature);
      const stored = stripIdsForStorage({ ...candidate, contentSignature });
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
      if (kept >= target) break;
      if (!isGeneratedQuestionType(c.built.question.type)) continue;
      const v = byId.get(c.localId);
      if (!v) continue;
      if (!v.keep) {
        rejected += 1;
        console.log(`  ✗ reject [${c.built.question.type}/${c.tier}] ${c.built.question.prompt.slice(0, 60)}… — ${v.reason}`);
        continue;
      }

      const tier = tierFromDifficulty(v.difficulty, c.tier);
      const repeatNorm = normKey(c.built.repeatKey);
      const contentSignature = c.built.contentSignature;
      if (!contentSignature || known.has(contentSignature)) continue;

      if (dry) {
        kept += 1;
        known.add(contentSignature);
        typeCounts[c.built.question.type] += 1;
        console.log(`  ✓ dry keep [${c.built.question.type}/${tier} d=${v.difficulty}] ${c.built.question.prompt.slice(0, 60)}…`);
        continue;
      }

      const inserted = (await db.execute(sql`
        INSERT INTO lms_bank (
          type, tier, difficulty, repeat_key, repeat_norm, content_signature,
          question_json, answer_json, extra_keys, review_reason, status
        ) VALUES (
          ${c.built.question.type},
          ${tier},
          ${v.difficulty},
          ${c.built.repeatKey},
          ${repeatNorm},
          ${contentSignature},
          ${JSON.stringify(c.built.question)}::jsonb,
          ${JSON.stringify(c.built.answer)}::jsonb,
          ${JSON.stringify(c.built.extraUsedKeys ?? [])}::jsonb,
          ${v.reason || null},
          'active'
        )
        ON CONFLICT (content_signature) WHERE content_signature IS NOT NULL DO NOTHING
        RETURNING id
      `)) as unknown as Array<{ id: string }>;
      if (inserted.length === 0) continue;
      known.add(contentSignature);
      kept += 1;
      typeCounts[c.built.question.type] += 1;
      console.log(`  ✓ keep [${c.built.question.type}/${tier} d=${v.difficulty}] ${c.built.question.prompt.slice(0, 60)}…`);
    }

    console.log(`  progress ${kept}/${target} kept · ${rejected} rejected · batch ${batch}`);
  }

  const finalCounts = dry ? typeCounts : (await loadBankInventory()).activeDistinctByType;
  console.log('');
  printTypeInventory(finalCounts);
  console.log(`\nDone — kept ${kept}, rejected ${rejected}, builder misses ~${builtFail}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
