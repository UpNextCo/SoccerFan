import type { LMSBuildContext, LMSBuilderResult } from './types.js';

const PLACEHOLDER_RE = /placeholder|option [a-d]/i;
const GK_TELEGRAPH_RE = /goalkeeper|three outfield/i;

/** Reject obviously broken or deprecated question shapes before they ship. */
export function validateLMSQuestion(built: LMSBuilderResult, ctx: LMSBuildContext): boolean {
  const { question } = built;
  if (!question.prompt?.trim()) return false;
  if (PLACEHOLDER_RE.test(question.prompt)) return false;
  if (question.subPrompt && GK_TELEGRAPH_RE.test(question.subPrompt)) return false;

  const optionCount = question.options.length;
  if (question.type === 'higher_lower') {
    if (optionCount !== 2) return false;
  } else if (optionCount !== 4) {
    return false;
  }

  const labels = new Set(question.options.map((o) => o.label));
  if (labels.size !== optionCount) return false;

  switch (question.type) {
    case 'career_path': {
      const clubs = question.presentation?.careerClubs ?? [];
      return clubs.length >= 3;
    }
    case 'higher_lower':
      return question.presentation?.layout === 'two_up';
    case 'image_badge':
      return Boolean(question.presentation?.imageUrl) && (question.presentation?.imageBlur ?? 10) <= 12;
    case 'odd_one_out':
      return question.presentation?.layout === 'grid';
    case 'which_club':
      return Boolean(question.subPrompt?.includes('·'));
    default:
      return true;
  }
}
