import { and, eq, gte, isNotNull, lte } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { dailyPuzzles, lmsBank } from '../../db/schema.js';
import {
  LMS_COOLDOWN_MINIMUM_BY_TYPE,
  LMS_EXACT_SIGNATURE_LOOKBACK_DAYS,
  lmsContentSignature,
} from './freshness.js';
import type {
  LMSQuestionType,
  LastManStandingAnswer,
  LastManStandingPuzzle,
} from './types.js';

interface TypeAudit {
  activeBank: number;
  cooldownMinimum: number;
  meetsCooldownInventory: boolean;
  recentQuestions: number;
  recentUniqueSignatures: number;
  repeatedSignatures: number;
  repeatedOccurrences: number;
}

export interface LMSFreshnessAudit {
  lookbackDays: number;
  cutoffDate: string;
  byType: Record<LMSQuestionType, TypeAudit>;
}

function emptyCounts(): Record<LMSQuestionType, number> {
  return {
    higher_lower: 0,
    career_path: 0,
    odd_one_out: 0,
    image_badge: 0,
    which_club: 0,
  };
}

/** Read-only audit of bank depth and exact semantic repetitions in recent stored dailies. */
export async function auditLMSFreshness(
  now = new Date(),
  lookbackDays = LMS_EXACT_SIGNATURE_LOOKBACK_DAYS
): Promise<LMSFreshnessAudit> {
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - (lookbackDays - 1));
  const cutoffDate = cutoff.toISOString().slice(0, 10);
  const throughDate = now.toISOString().slice(0, 10);

  const [bankRows, dailyRows] = await Promise.all([
    db
      .select({ type: lmsBank.type, contentSignature: lmsBank.contentSignature })
      .from(lmsBank)
      .where(and(eq(lmsBank.status, 'active'), isNotNull(lmsBank.contentSignature))),
    db
      .select({ puzzleJson: dailyPuzzles.puzzleJson, answerJson: dailyPuzzles.answerJson })
      .from(dailyPuzzles)
      .where(and(
        eq(dailyPuzzles.modeId, 'last_man_standing'),
        gte(dailyPuzzles.date, cutoffDate),
        lte(dailyPuzzles.date, throughDate)
      )),
  ]);

  const active = emptyCounts();
  const activeSignatures = new Map<LMSQuestionType, Set<string>>();
  for (const type of Object.keys(active) as LMSQuestionType[]) {
    activeSignatures.set(type, new Set());
  }
  for (const row of bankRows) {
    if (row.type in active && row.contentSignature) {
      activeSignatures.get(row.type as LMSQuestionType)!.add(row.contentSignature);
    }
  }
  for (const [type, values] of activeSignatures) {
    active[type] = values.size;
  }

  const signatures = new Map<LMSQuestionType, Map<string, number>>();
  for (const type of Object.keys(active) as LMSQuestionType[]) signatures.set(type, new Map());
  for (const row of dailyRows) {
    const puzzle = row.puzzleJson as LastManStandingPuzzle;
    const answer = row.answerJson as LastManStandingAnswer;
    if (!puzzle?.questions?.length || !answer?.questions?.length) continue;
    const answerById = new Map(answer.questions.map((item) => [item.questionId, item]));
    for (const question of puzzle.questions) {
      const questionAnswer = answerById.get(question.id);
      if (!questionAnswer) continue;
      const signature = lmsContentSignature(question, questionAnswer);
      if (!signature) continue;
      const typeSignatures = signatures.get(question.type)!;
      typeSignatures.set(signature, (typeSignatures.get(signature) ?? 0) + 1);
    }
  }

  const byType = {} as Record<LMSQuestionType, TypeAudit>;
  for (const type of Object.keys(active) as LMSQuestionType[]) {
    const counts = [...signatures.get(type)!.values()];
    const minimum = LMS_COOLDOWN_MINIMUM_BY_TYPE[type];
    byType[type] = {
      activeBank: active[type],
      cooldownMinimum: minimum,
      meetsCooldownInventory: active[type] >= minimum,
      recentQuestions: counts.reduce((sum, count) => sum + count, 0),
      recentUniqueSignatures: counts.length,
      repeatedSignatures: counts.filter((count) => count > 1).length,
      repeatedOccurrences: counts.reduce((sum, count) => sum + Math.max(0, count - 1), 0),
    };
  }

  return { lookbackDays, cutoffDate, byType };
}
