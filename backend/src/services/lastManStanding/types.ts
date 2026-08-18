export type LMSQuestionType =
  | 'higher_lower'
  | 'career_path'
  | 'odd_one_out'
  | 'which_club'
  | 'image_badge'
  | 'custom_image'
  | 'custom_question'
  | 'missing_club'
  | 'custom_text';

export type LMSGeneratedQuestionType = Exclude<
  LMSQuestionType,
  'custom_image' | 'custom_question' | 'missing_club' | 'custom_text'
>;

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
  note?: 'loan';
  missing?: boolean;
}

export interface LMSCluePlayerPublic {
  id?: string;
  name: string;
  headshotUrl?: string;
  nationality?: string;
  position?: string;
}

export interface LMSPresentationPublic {
  layout?: 'two_up' | 'grid' | 'stack' | 'image_header';
  imageUrl?: string;
  imageBlur?: number;
  careerClubs?: LMSCareerClubPublic[];
  careerPathVersion?: 2;
  cluePlayers?: LMSCluePlayerPublic[];
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
export const LMS_PUZZLE_VERSION = 12;

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

/** Server-only generation facts; never persist or expose this alongside the public puzzle. */
export interface LMSGenerationMetadata {
  acceptedBankRowIds: string[];
}

export interface LMSGeneratedPuzzle {
  puzzle: LastManStandingPuzzle;
  answer: LastManStandingAnswer;
  metadata: LMSGenerationMetadata;
}

export interface LMSBuilderResult {
  question: LMSQuestionPublic;
  answer: LMSQuestionAnswer;
  repeatKey: string;
  /** Canonical semantic signature, populated once the finished card is available. */
  contentSignature?: string;
  /** Deferred usage metadata; callers mark rows only after daily_puzzles persistence succeeds. */
  bankRowId?: string;
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
