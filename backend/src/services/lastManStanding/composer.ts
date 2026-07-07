import type { LMSBuildContext, LMSBuilderResult, LMSQuestionType } from './types.js';
import { LMS_DAILY_SLOTS } from './slots.js';
import { buildCareerPath } from './builders/careerPath.js';
import { buildHigherLower } from './builders/higherLower.js';
import { buildImageBadge } from './builders/imageBadge.js';
import { buildOddOneOut } from './builders/oddOneOut.js';
import { buildWhichClub } from './builders/whichClub.js';
import type { LastManStandingAnswer, LastManStandingPuzzle } from './types.js';
import { LMS_PUZZLE_VERSION } from './types.js';
import { difficultyForSlot } from './difficulty.js';
import { famousPlayers } from './shared.js';
import { validateLMSQuestion } from './validate.js';
import { buildPlayerClubIndex, resetPlayerClubIndex } from './plausibility.js';

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

export async function composeLastManStandingPuzzle(date: string): Promise<{
  puzzle: LastManStandingPuzzle;
  answer: LastManStandingAnswer;
} | null> {
  const questions: LastManStandingPuzzle['questions'] = [];
  const answers: LastManStandingAnswer['questions'] = [];
  const usedKeys = new Set<string>();
  const pool = await famousPlayers(4, 250);
  resetPlayerClubIndex();
  const clubIndex = await buildPlayerClubIndex(pool);

  for (const slotDef of LMS_DAILY_SLOTS) {
    const builder = BUILDERS[slotDef.type];
    let built: LMSBuilderResult | null = null;

    for (let attempt = 0; attempt < 16 && !built; attempt += 1) {
      const ctx: LMSBuildContext = {
        date,
        slot: slotDef.slot,
        signature: slotDef.signature ?? false,
        seed: `${date}:lms:q${slotDef.slot}:a${attempt}`,
        usedKeys,
        difficulty: difficultyForSlot(slotDef.slot, slotDef.signature ?? false),
        famousPool: pool,
        clubIndex,
      };
      const candidate = await builder(ctx);
      if (!candidate || usedKeys.has(candidate.repeatKey)) continue;
      if (!validateLMSQuestion(candidate, ctx)) continue;
      built = candidate;
      usedKeys.add(candidate.repeatKey);
    }

    if (!built) {
      console.warn(`LMS compose failed at slot ${slotDef.slot} (${slotDef.type}) after 16 attempts`);
      return null;
    }
    questions.push(built.question);
    answers.push(built.answer);
  }

  if (questions.length !== 10) return null;

  return {
    puzzle: {
      modeId: 'last_man_standing',
      puzzleId: `${date}-last_man_standing`,
      date,
      title: 'Last Man Standing',
      version: LMS_PUZZLE_VERSION,
      questions,
    },
    answer: { questions: answers },
  };
}
