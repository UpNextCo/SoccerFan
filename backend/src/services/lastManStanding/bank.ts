/**
 * Draw curated LMS questions from lms_bank (Claude-reviewed, DB-built).
 * Remaps question/option IDs to the daily slot so the live check path stays unchanged.
 */
import { sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import type {
  LMSBuilderResult,
  LMSQuestionAnswer,
  LMSQuestionPublic,
  LMSGeneratedQuestionType,
} from './types.js';
import type { LMSDifficulty, LMSTier } from './difficulty.js';
import {
  groupLMSBankRowsBySignature,
  lmsContentSignature,
  lmsSignatureUsedKey,
} from './freshness.js';

export interface LmsBankDrawRow {
  id: string;
  type: string;
  tier: string;
  difficulty: number;
  repeatKey: string;
  contentSignature: string;
  questionJson: LMSQuestionPublic;
  answerJson: LMSQuestionAnswer;
  extraKeys: string[];
}

function remapBuilderResult(
  row: LmsBankDrawRow,
  date: string,
  slot: number
): LMSBuilderResult {
  const questionId = `${date}-lms-q${slot}`;
  const oldQ = row.questionJson;
  const oldA = row.answerJson;
  const oldQuestionId = oldQ.id;

  const options = oldQ.options.map((opt) => ({
    ...opt,
    id: opt.id.startsWith(oldQuestionId)
      ? `${questionId}${opt.id.slice(oldQuestionId.length)}`
      : `${questionId}-${opt.id}`,
  }));

  const correctOptionId = oldA.correctOptionId.startsWith(oldQuestionId)
    ? `${questionId}${oldA.correctOptionId.slice(oldQuestionId.length)}`
    : options.find((o) => o.label === oldQ.options.find((x) => x.id === oldA.correctOptionId)?.label)?.id
      ?? options[0]!.id;

  return {
    question: {
      ...oldQ,
      id: questionId,
      slot,
      options,
    },
    answer: {
      questionId,
      correctOptionId,
      reveal: oldA.reveal,
    },
    repeatKey: row.repeatKey,
    contentSignature: row.contentSignature,
    bankRowId: row.id,
    extraUsedKeys: row.extraKeys ?? [],
  };
}

/** Tiers acceptable for a slot — allow one step harder from the bank when needed. */
function acceptableTiers(target: LMSTier): string[] {
  switch (target) {
    case 'easy':
      return ['easy', 'medium'];
    case 'medium':
      return ['medium', 'hard', 'easy'];
    case 'hard':
      return ['hard', 'signature', 'medium'];
    case 'signature':
      return ['signature', 'hard'];
  }
}

export async function drawLMSFromBank(args: {
  type: LMSGeneratedQuestionType;
  difficulty: LMSDifficulty;
  usedKeys: Set<string>;
  date: string;
  slot: number;
}): Promise<LMSBuilderResult | null> {
  const tiers = acceptableTiers(args.difficulty.tier);
  const rows = (await db.execute(sql`
    SELECT id, type, tier, difficulty, repeat_key, content_signature,
      question_json, answer_json, extra_keys
    FROM lms_bank
    WHERE status = 'active'
      AND type = ${args.type}
      AND tier IN (${sql.join(tiers.map((t) => sql`${t}`), sql`, `)})
    ORDER BY used_count ASC, last_used_date ASC NULLS FIRST, created_at ASC, id ASC
    LIMIT 500
  `)) as unknown as Array<{
    id: string;
    type: string;
    tier: string;
    difficulty: number;
    repeat_key: string;
    content_signature: string | null;
    question_json: LMSQuestionPublic;
    answer_json: LMSQuestionAnswer;
    extra_keys: string[] | null;
  }>;

  for (const r of rows) {
    const extra = Array.isArray(r.extra_keys) ? r.extra_keys : [];
    const contentSignature =
      r.content_signature ?? lmsContentSignature(r.question_json, r.answer_json);
    if (!contentSignature || args.usedKeys.has(lmsSignatureUsedKey(contentSignature))) continue;
    if (args.usedKeys.has(r.repeat_key)) continue;
    if (extra.some((k) => args.usedKeys.has(k))) continue;

    const draw: LmsBankDrawRow = {
      id: r.id,
      type: r.type,
      tier: r.tier,
      difficulty: r.difficulty,
      repeatKey: r.repeat_key,
      contentSignature,
      questionJson: r.question_json,
      answerJson: r.answer_json,
      extraKeys: extra,
    };
    return remapBuilderResult(draw, args.date, args.slot);
  }
  return null;
}

/** Marks accepted bank rows only after the complete puzzle has composed successfully. */
export async function markLMSBankRowsUsed(rowIds: string[], date: string): Promise<void> {
  const uniqueIds = [...new Set(rowIds)];
  if (uniqueIds.length === 0) return;
  await db.execute(sql`
    UPDATE lms_bank
    SET used_count = used_count + 1, last_used_date = ${date}::date
    WHERE id IN (${sql.join(uniqueIds.map((id) => sql`${id}::uuid`), sql`, `)})
  `);
}

/**
 * Backfills legacy nullable signatures. Duplicate semantic cards retain one preferred row;
 * the rest are rejected and left nullable so the unique partial index remains valid.
 */
export async function backfillLMSBankContentSignatures(): Promise<{
  signed: number;
  duplicatesRejected: number;
}> {
  const rows = (await db.execute(sql`
    SELECT id, status, used_count, created_at, question_json, answer_json
    FROM lms_bank
  `)) as unknown as Array<{
    id: string;
    status: string;
    used_count: number;
    created_at: Date | string;
    question_json: LMSQuestionPublic;
    answer_json: LMSQuestionAnswer;
  }>;
  const groups = groupLMSBankRowsBySignature(rows.map((row) => ({
    id: row.id,
    status: row.status,
    usedCount: row.used_count,
    createdAt: row.created_at,
    question: row.question_json,
    answer: row.answer_json,
  })));

  let duplicateCount = 0;
  await db.transaction(async (tx) => {
    for (const group of groups) {
      if (group.duplicateIds.length > 0) {
        duplicateCount += group.duplicateIds.length;
        await tx.execute(sql`
          UPDATE lms_bank
          SET status = 'rejected', content_signature = NULL,
            review_reason = COALESCE(review_reason, 'duplicate semantic content')
          WHERE id IN (${sql.join(group.duplicateIds.map((id) => sql`${id}::uuid`), sql`, `)})
        `);
      }
      await tx.execute(sql`
        UPDATE lms_bank
        SET content_signature = ${group.signature}
        WHERE id = ${group.keeperId}::uuid
      `);
    }
  });
  return { signed: groups.length, duplicatesRejected: duplicateCount };
}

export async function lmsBankCounts(): Promise<Record<string, number>> {
  const rows = (await db.execute(sql`
    SELECT type, tier, COUNT(*)::int AS n
    FROM lms_bank
    WHERE status = 'active'
    GROUP BY type, tier
  `)) as unknown as Array<{ type: string; tier: string; n: number }>;
  const out: Record<string, number> = {};
  for (const r of rows) out[`${r.type}:${r.tier}`] = r.n;
  return out;
}
