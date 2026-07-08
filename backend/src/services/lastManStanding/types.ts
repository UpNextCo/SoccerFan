export type LMSQuestionType =
  | 'higher_lower'
  | 'career_path'
  | 'odd_one_out'
  | 'which_club'
  | 'image_badge';

export interface LMSOptionPublic {
  id: string;
  label: string;
  headshotUrl?: string;
  teamLogoUrl?: string;
  nationality?: string;
  position?: string;
}

export interface LMSCareerClubPublic {
  name: string;
  logoUrl?: string;
}

export interface LMSPresentationPublic {
  layout?: 'two_up' | 'grid' | 'stack' | 'image_header';
  imageUrl?: string;
  imageBlur?: number;
  careerClubs?: LMSCareerClubPublic[];
}

export interface LMSQuestionPublic {
  id: string;
  type: LMSQuestionType;
  slot: number;
  signature?: boolean;
  prompt: string;
  subPrompt?: string;
  options: LMSOptionPublic[];
  presentation?: LMSPresentationPublic;
}

export interface LMSQuestionAnswer {
  questionId: string;
  correctOptionId: string;
  reveal?: string;
}

/** Bump when question shape / answer format changes so stored dailies regenerate. */
export const LMS_PUZZLE_VERSION = 9;

export interface LastManStandingPuzzle {
  modeId: 'last_man_standing';
  puzzleId: string;
  date: string;
  title: string;
  version: number;
  questions: LMSQuestionPublic[];
}

export interface LastManStandingAnswer {
  questions: LMSQuestionAnswer[];
}

export interface LMSBuilderResult {
  question: LMSQuestionPublic;
  answer: LMSQuestionAnswer;
  repeatKey: string;
  /** Extra dedupe keys reserved for this puzzle (clubs/players already used). */
  extraUsedKeys?: string[];
}

import type { LMSDifficulty } from './difficulty.js';
import type { PlayerClubIndex } from './plausibility.js';

export interface LMSBuildContext {
  date: string;
  slot: number;
  signature: boolean;
  seed: string;
  usedKeys: Set<string>;
  difficulty: LMSDifficulty;
  famousPool?: Awaited<ReturnType<typeof import('./shared.js').famousPlayers>>;
  clubIndex?: PlayerClubIndex;
}
