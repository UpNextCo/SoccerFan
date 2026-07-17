import { createHash } from 'node:crypto';
import type {
  LMSQuestionAnswer,
  LMSQuestionPublic,
  LMSQuestionType,
  LMSGeneratedQuestionType,
  LMSGenerationMetadata,
  LastManStandingAnswer,
  LastManStandingPuzzle,
} from './types.js';
import { clubUsedKey, hlPairUsedKey, metricFromPrompt, playerUsedKey } from './recognition.js';

export const LMS_EXACT_SIGNATURE_LOOKBACK_DAYS = 45;
export const LMS_BROAD_RESOURCE_LOOKBACK_DAYS = (() => {
  // Clubs and players are reused across several question types each day. A longer broad
  // window exhausts the finite household pool even when every exact card is fresh.
  const configured = Number(process.env.LMS_BROAD_COOLDOWN_DAYS ?? 3);
  return Number.isInteger(configured) && configured > 0
    ? Math.min(configured, LMS_EXACT_SIGNATURE_LOOKBACK_DAYS)
    : 3;
})();

export const LMS_COOLDOWN_MINIMUM_BY_TYPE: Record<LMSGeneratedQuestionType, number> = {
  higher_lower: 135,
  career_path: 135,
  odd_one_out: 90,
  image_badge: 45,
  which_club: 45,
};

export const LMS_COOLDOWN_MINIMUM_TOTAL = Object.values(LMS_COOLDOWN_MINIMUM_BY_TYPE)
  .reduce((sum, count) => sum + count, 0);

function normalizeSemanticText(value: string | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export interface LMSSemanticSignaturePayload {
  version: 2;
  type: LMSQuestionType;
  prompt: string;
  subPrompt: string;
  optionLabels: string[];
  correctLabel: string;
  careerClubPath: string[];
  imageIdentity?: string;
}

/** Canonical content facts, deliberately excluding date, slot, IDs, option order and media enrichment. */
export function lmsSemanticSignaturePayload(
  question: LMSQuestionPublic,
  answer: LMSQuestionAnswer
): LMSSemanticSignaturePayload | null {
  const correct = question.options.find((option) => option.id === answer.correctOptionId);
  if (!correct) return null;

  return {
    version: 2,
    type: question.type,
    prompt: normalizeSemanticText(question.prompt),
    subPrompt: normalizeSemanticText(question.subPrompt),
    optionLabels: question.options
      .map((option) => normalizeSemanticText(option.label))
      .sort(),
    correctLabel: normalizeSemanticText(correct.label),
    careerClubPath:
      question.presentation?.careerClubs?.map((club) =>
        `${normalizeSemanticText(club.name)}${club.note === 'loan' ? ':loan' : ''}`
      ) ?? [],
    ...(question.type === 'custom_image'
      ? { imageIdentity: (question.presentation?.imageUrl ?? '').trim().toLowerCase() }
      : {}),
  };
}

/** Compact, stable semantic signature for one LMS question. */
export function lmsContentSignature(
  question: LMSQuestionPublic,
  answer: LMSQuestionAnswer
): string | null {
  const payload = lmsSemanticSignaturePayload(question, answer);
  if (!payload) return null;
  const digest = createHash('sha256').update(JSON.stringify(payload)).digest('base64url').slice(0, 22);
  return `lms2_${digest}`;
}

export function lmsSignatureUsedKey(signature: string): string {
  return `lms:signature:${signature}`;
}

export function includeLMSUsedKeyForWindow(
  key: string,
  withinBroadResourceWindow: boolean
): boolean {
  return key.startsWith('lms:signature:') || withinBroadResourceWindow;
}

export function createLMSGenerationMetadata(rowIds: readonly string[]): LMSGenerationMetadata {
  return { acceptedBankRowIds: [...new Set(rowIds)] };
}

function playerIdFromOption(questionId: string, optionId: string): string | null {
  if (!optionId.startsWith(`${questionId}-`)) return null;
  const rest = optionId.slice(questionId.length + 1);
  if (rest === 'correct' || rest === 'odd' || rest.startsWith('w') || rest.startsWith('m')) return null;
  if (/^\d+$/.test(rest)) return null;
  return rest;
}

/** Pure extraction used by history loading and freshness audits. */
export function extractLMSUsedKeys(
  puzzle: LastManStandingPuzzle,
  answer: LastManStandingAnswer
): string[] {
  const keys: string[] = [];
  const answersByQuestion = new Map(answer.questions.map((item) => [item.questionId, item]));

  for (const question of puzzle.questions) {
    const questionAnswer = answersByQuestion.get(question.id);
    if (!questionAnswer) continue;

    const signature = lmsContentSignature(question, questionAnswer);
    if (signature) keys.push(lmsSignatureUsedKey(signature));

    switch (question.type) {
      case 'higher_lower': {
        const metricId = metricFromPrompt(question.prompt);
        const ids = question.options
          .map((option) => playerIdFromOption(question.id, option.id))
          .filter((id): id is string => id != null);
        if (ids.length === 2 && metricId) keys.push(hlPairUsedKey(ids[0]!, ids[1]!, metricId));
        break;
      }
      case 'image_badge':
      case 'which_club': {
        const correct = question.options.find((option) => option.id === questionAnswer.correctOptionId);
        if (correct) keys.push(clubUsedKey(correct.label));
        break;
      }
      case 'custom_image':
        break;
      case 'custom_question': {
        const playerId = playerIdFromOption(question.id, questionAnswer.correctOptionId);
        if (playerId) keys.push(playerUsedKey(playerId));
        break;
      }
      case 'career_path': {
        const playerId = playerIdFromOption(question.id, questionAnswer.correctOptionId);
        if (playerId) keys.push(playerUsedKey(playerId));
        break;
      }
      case 'odd_one_out': {
        if (question.subPrompt?.startsWith('Who never played for ')) {
          const club = question.subPrompt.slice('Who never played for '.length).replace(/\?$/, '');
          keys.push(clubUsedKey(club));
        }
        break;
      }
    }
  }

  return keys;
}

export interface LMSHistoryKeySource {
  date: string;
  puzzleJson: unknown;
  answerJson: unknown;
}

export function collectLMSHistoryUsedKeys(
  rows: LMSHistoryKeySource[],
  broadCutoffDate: string
): Set<string> {
  const used = new Set<string>();
  for (const row of rows) {
    const puzzle = row.puzzleJson as LastManStandingPuzzle;
    const answer = row.answerJson as LastManStandingAnswer;
    if (!puzzle?.questions?.length || !answer?.questions?.length) continue;
    for (const key of extractLMSUsedKeys(puzzle, answer)) {
      if (includeLMSUsedKeyForWindow(key, row.date >= broadCutoffDate)) used.add(key);
    }
  }
  return used;
}

export interface LMSBankSignatureSource {
  id: string;
  status: string;
  usedCount: number;
  createdAt: Date | string;
  question: LMSQuestionPublic;
  answer: LMSQuestionAnswer;
}

export interface LMSBankSignatureGroup {
  signature: string;
  keeperId: string;
  duplicateIds: string[];
}

export interface LMSBankInventorySource {
  type: LMSGeneratedQuestionType;
  status: string;
  contentSignature: string | null;
  question: LMSQuestionPublic;
  answer: LMSQuestionAnswer;
}

export function summarizeLMSBankInventory(rows: LMSBankInventorySource[]): {
  knownSignatures: Set<string>;
  activeDistinctByType: Record<LMSGeneratedQuestionType, number>;
} {
  const knownSignatures = new Set<string>();
  const activeByType = new Map<LMSGeneratedQuestionType, Set<string>>();
  for (const type of Object.keys(LMS_COOLDOWN_MINIMUM_BY_TYPE) as LMSGeneratedQuestionType[]) {
    activeByType.set(type, new Set());
  }
  for (const row of rows) {
    const signature = lmsContentSignature(row.question, row.answer);
    if (!signature) continue;
    knownSignatures.add(signature);
    if (row.status === 'active' && row.contentSignature === signature) {
      activeByType.get(row.type)?.add(signature);
    }
  }
  return {
    knownSignatures,
    activeDistinctByType: Object.fromEntries(
      [...activeByType].map(([type, signatures]) => [type, signatures.size])
    ) as Record<LMSGeneratedQuestionType, number>,
  };
}

/** Deterministically picks one keeper for each semantic signature during legacy backfill. */
export function groupLMSBankRowsBySignature(
  rows: LMSBankSignatureSource[]
): LMSBankSignatureGroup[] {
  const grouped = new Map<string, LMSBankSignatureSource[]>();
  for (const row of rows) {
    const signature = lmsContentSignature(row.question, row.answer);
    if (!signature) continue;
    const group = grouped.get(signature) ?? [];
    group.push(row);
    grouped.set(signature, group);
  }

  return [...grouped.entries()].map(([signature, group]) => {
    const ordered = [...group].sort((a, b) => {
      const activeDelta = Number(b.status === 'active') - Number(a.status === 'active');
      if (activeDelta !== 0) return activeDelta;
      if (b.usedCount !== a.usedCount) return b.usedCount - a.usedCount;
      const dateDelta = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return dateDelta || a.id.localeCompare(b.id);
    });
    return {
      signature,
      keeperId: ordered[0]!.id,
      duplicateIds: ordered.slice(1).map((row) => row.id),
    };
  });
}
