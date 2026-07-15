import type { LMSBuildContext, LMSBuilderResult } from './types.js';
import {
  maxClueAssociation,
  maxOddPrestigeSpread,
  minCareerOverlapClubs,
  pathOverlapCount,
} from './plausibility.js';
import { isHouseholdIndexed } from './recognition.js';
import { MIN_NAME_PRESTIGE } from './fame.js';
import { isConfiguredOpsMediaUrl } from '../opsMediaValidation.js';

const PLACEHOLDER_RE = /placeholder|option [a-d]/i;
const GK_TELEGRAPH_RE = /goalkeeper|three outfield/i;
const TELEGRAPH_SUBPROMPT_RE = /three outfield|big six/i;
const LEAGUE_GEOGRAPHY_ODD_RE = /^three .+ clubs$/i;

function isGiveawayClubOddOneOut(built: LMSBuilderResult): boolean {
  const sub = built.question.subPrompt?.trim() ?? '';
  if (LEAGUE_GEOGRAPHY_ODD_RE.test(sub)) return true;
  return false;
}

function playerIdFromOption(questionId: string, optionId: string): string | null {
  if (!optionId.startsWith(`${questionId}-`)) return null;
  const rest = optionId.slice(questionId.length + 1);
  if (rest === 'correct' || rest === 'odd' || rest.startsWith('w') || rest.startsWith('m')) return null;
  if (/^\d+$/.test(rest)) return null;
  return rest;
}

function optionsHousehold(built: LMSBuilderResult, ctx: LMSBuildContext): boolean {
  const index = ctx.clubIndex;
  if (!index) return true;
  if (built.question.type === 'image_badge') return true;
  for (const opt of built.question.options) {
    const pid = playerIdFromOption(built.question.id, opt.id);
    if (!pid) continue;
    if (!isHouseholdIndexed(index, pid)) return false;
  }
  return true;
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

  if (question.options.some((option) => !option.label.trim())) return false;
  const labels = new Set(question.options.map((o) => o.label.trim().toLocaleLowerCase()));
  if (labels.size !== optionCount) return false;
  if (!question.options.some((option) => option.id === built.answer.correctOptionId)) return false;

  if (question.type === 'custom_image') {
    return (
      question.presentation?.layout === 'image_header' &&
      isConfiguredOpsMediaUrl(question.presentation.imageUrl) &&
      (question.presentation.imageBlur === undefined || question.presentation.imageBlur === 0)
    );
  }

  if (!optionsHousehold(built, ctx)) return false;

  if (!index) return question.type === 'higher_lower' || question.type === 'image_badge';

  switch (question.type) {
    case 'career_path': {
      const clubs = question.presentation?.careerClubs?.map((c) => c.name) ?? [];
      if (clubs.length < 3) return false;
      const minOverlap = minCareerOverlapClubs(ctx.difficulty.tier);
      for (const opt of question.options) {
        const pid = playerIdFromOption(question.id, opt.id);
        if (!pid) continue;
        if (opt.id === built.answer.correctOptionId) continue;
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
        if (!playerId || !isHouseholdIndexed(index, playerId)) return false;
        const assoc = index.associationByPlayer.get(playerId)?.get(answerClub) ?? 0;
        if (assoc > maxAssoc) return false;
        if (index.primaryClubByPlayer.get(playerId) === answerClub) return false;
      }
      return true;
    }
    case 'odd_one_out': {
      if (question.presentation?.layout !== 'grid') return false;
      if (!question.subPrompt?.trim()) return false;
      if (isGiveawayClubOddOneOut(built)) return false;
      if (ctx.slot >= 6 && question.subPrompt.startsWith('All played in the ')) return false;
      const ids = question.options
        .map((o) => playerIdFromOption(question.id, o.id))
        .filter((id): id is string => id != null);
      if (ids.length >= 4) {
        const prestiges = ids
          .map((id) => index.prestigeByPlayer.get(id))
          .filter((v): v is number => v != null);
        if (prestiges.length >= 4) {
          const spread = Math.max(...prestiges) - Math.min(...prestiges);
          if (spread > maxOddPrestigeSpread(ctx.difficulty.tier) + 2) return false;
          if (Math.min(...prestiges) < MIN_NAME_PRESTIGE - 6) return false;
        }
        if (ids.some((id) => !isHouseholdIndexed(index, id))) return false;
      }
      return true;
    }
    case 'higher_lower':
      return question.presentation?.layout === 'two_up';
    case 'image_badge':
      return Boolean(question.presentation?.imageUrl) && (question.presentation?.imageBlur ?? 5) >= 4;
    default:
      return true;
  }
}
