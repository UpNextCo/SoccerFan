import type { LMSBuildContext, LMSBuilderResult } from './types.js';
import {
  maxClueAssociation,
  maxOddPrestigeSpread,
  minCareerOverlapClubs,
  pathOverlapCount,
} from './plausibility.js';

const PLACEHOLDER_RE = /placeholder|option [a-d]/i;
const GK_TELEGRAPH_RE = /goalkeeper|three outfield/i;
const TELEGRAPH_SUBPROMPT_RE = /never played for|three .+ clubs|big six/i;

function playerIdFromOption(questionId: string, optionId: string): string {
  return optionId.startsWith(`${questionId}-`) ? optionId.slice(questionId.length + 1) : optionId;
}

/** Reject broken shapes and giveaway plausibility before they ship. */
export function validateLMSQuestion(built: LMSBuilderResult, ctx: LMSBuildContext): boolean {
  const { question } = built;
  const index = ctx.clubIndex;
  if (!question.prompt?.trim()) return false;
  if (PLACEHOLDER_RE.test(question.prompt)) return false;
  if (question.subPrompt && GK_TELEGRAPH_RE.test(question.subPrompt)) return false;
  if (question.subPrompt && TELEGRAPH_SUBPROMPT_RE.test(question.subPrompt)) return false;

  const optionCount = question.options.length;
  if (question.type === 'higher_lower') {
    if (optionCount !== 2) return false;
  } else if (optionCount !== 4) {
    return false;
  }

  const labels = new Set(question.options.map((o) => o.label));
  if (labels.size !== optionCount) return false;

  if (!index) return question.type === 'higher_lower' || question.type === 'image_badge';

  switch (question.type) {
    case 'career_path': {
      const clubs = question.presentation?.careerClubs?.map((c) => c.name) ?? [];
      if (clubs.length < 3) return false;
      const minOverlap = minCareerOverlapClubs(ctx.difficulty.tier);
      for (const opt of question.options) {
        if (opt.id === built.answer.correctOptionId) continue;
        const pid = playerIdFromOption(question.id, opt.id);
        if (pathOverlapCount(index, pid, clubs) < minOverlap) return false;
      }
      return true;
    }
    case 'which_club': {
      const answerClub = question.options.find((o) => o.id === built.answer.correctOptionId)?.label;
      if (!answerClub || !question.subPrompt?.includes('·')) return false;
      const names = question.subPrompt.split('·').map((s) => s.trim());
      if (names.length !== 3) return false;
      const maxAssoc = maxClueAssociation(ctx.difficulty.tier);
      for (const name of names) {
        const playerId = index.playerIdByName.get(name);
        if (!playerId) return false;
        const assoc = index.associationByPlayer.get(playerId)?.get(answerClub) ?? 0;
        if (assoc > maxAssoc) return false;
        if (index.primaryClubByPlayer.get(playerId) === answerClub) return false;
      }
      return true;
    }
    case 'odd_one_out': {
      if (question.presentation?.layout !== 'grid') return false;
      const ids = question.options.map((o) => playerIdFromOption(question.id, o.id));
      const prestiges = ids
        .map((id) => index.prestigeByPlayer.get(id))
        .filter((v): v is number => v != null);
      if (prestiges.length >= 4) {
        const spread = Math.max(...prestiges) - Math.min(...prestiges);
        if (spread > maxOddPrestigeSpread(ctx.difficulty.tier) + 2) return false;
      }
      return true;
    }
    case 'higher_lower':
      return question.presentation?.layout === 'two_up';
    case 'image_badge':
      return Boolean(question.presentation?.imageUrl) && (question.presentation?.imageBlur ?? 10) <= 12;
    default:
      return true;
  }
}
