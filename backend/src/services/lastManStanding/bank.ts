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
  LMSQuestionType,
} from './types.js';
import type { LMSDifficulty, LMSTier } from './difficulty.js';

export interface LmsBankDrawRow {
  id: string;
  type: string;
  tier: string;
  difficulty: number;
  repeatKey: string;
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
  type: LMSQuestionType;
  difficulty: LMSDifficulty;
  usedKeys: Set<string>;
  date: string;
  slot: number;
}): Promise<LMSBuilderResult | null> {
  const tiers = acceptableTiers(args.difficulty.tier);
  const rows = (await db.execute(sql`
    SELECT id, type, tier, difficulty, repeat_key, question_json, answer_json, extra_keys
    FROM lms_bank
    WHERE status = 'active'
      AND type = ${args.type}
      AND tier IN (${sql.join(tiers.map((t) => sql`${t}`), sql`, `)})
    ORDER BY used_count ASC, last_used_date ASC NULLS FIRST, random()
    LIMIT 40
  `)) as unknown as Array<{
    id: string;
    type: string;
    tier: string;
    difficulty: number;
    repeat_key: string;
    question_json: LMSQuestionPublic;
    answer_json: LMSQuestionAnswer;
    extra_keys: string[] | null;
  }>;

  for (const r of rows) {
    const extra = Array.isArray(r.extra_keys) ? r.extra_keys : [];
    if (args.usedKeys.has(r.repeat_key)) continue;
    if (extra.some((k) => args.usedKeys.has(k))) continue;

    const draw: LmsBankDrawRow = {
      id: r.id,
      type: r.type,
      tier: r.tier,
      difficulty: r.difficulty,
      repeatKey: r.repeat_key,
      questionJson: r.question_json,
      answerJson: r.answer_json,
      extraKeys: extra,
    };
    const built = remapBuilderResult(draw, args.date, args.slot);

    await db.execute(sql`
      UPDATE lms_bank
      SET used_count = used_count + 1, last_used_date = ${args.date}::date
      WHERE id = ${r.id}::uuid
    `);
    return built;
  }
  return null;
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
