import { loadRecentLMSUsedKeys } from './history.js';
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
import { enrichLMSBuilderResult, resetLMSEnrichCache } from './enrich.js';
import { drawLMSFromBank } from './bank.js';

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
  const recentKeys = await loadRecentLMSUsedKeys(date);
  const usedKeys = new Set<string>(recentKeys);
  const pool = await famousPlayers(4, 250);
  resetPlayerClubIndex();
  resetLMSEnrichCache();
  const clubIndex = await buildPlayerClubIndex(pool);

  let fromBank = 0;
  let fromLive = 0;

  for (const slotDef of LMS_DAILY_SLOTS) {
    const builder = BUILDERS[slotDef.type];
    const difficulty = difficultyForSlot(slotDef.slot, slotDef.signature ?? false);
    let built: LMSBuilderResult | null = null;

    // Prefer Claude-reviewed bank rows when available.
    try {
      const bankHit = await drawLMSFromBank({
        type: slotDef.type,
        difficulty,
        usedKeys,
        date,
        slot: slotDef.slot,
      });
      if (bankHit) {
        built = bankHit;
        fromBank += 1;
      }
    } catch (err) {
      // Bank table may not exist yet — fall through to live builders.
      if (fromBank + fromLive === 0) {
        console.warn(
          `LMS bank draw unavailable (${err instanceof Error ? err.message : String(err)}); using live builders`
        );
      }
    }

    for (let attempt = 0; attempt < 16 && !built; attempt += 1) {
      const ctx: LMSBuildContext = {
        date,
        slot: slotDef.slot,
        signature: slotDef.signature ?? false,
        seed: `${date}:lms:q${slotDef.slot}:a${attempt}`,
        usedKeys,
        difficulty,
        famousPool: pool,
        clubIndex,
      };
      let candidate = await builder(ctx);
      if (!candidate || usedKeys.has(candidate.repeatKey)) continue;
      candidate = await enrichLMSBuilderResult(candidate);
      if (candidate.extraUsedKeys?.some((k) => usedKeys.has(k))) continue;
      if (!validateLMSQuestion(candidate, ctx)) continue;
      built = candidate;
      fromLive += 1;
    }

    if (!built) {
      console.warn(`LMS compose failed at slot ${slotDef.slot} (${slotDef.type}) after bank+16 attempts`);
      return null;
    }
    usedKeys.add(built.repeatKey);
    built.extraUsedKeys?.forEach((k) => usedKeys.add(k));
    questions.push(built.question);
    answers.push(built.answer);
  }

  if (questions.length !== 10) return null;
  console.log(`LMS compose ${date}: ${fromBank} from bank · ${fromLive} live`);

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
