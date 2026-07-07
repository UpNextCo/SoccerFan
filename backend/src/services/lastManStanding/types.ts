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

export interface LastManStandingPuzzle {
  modeId: 'last_man_standing';
  puzzleId: string;
  date: string;
  title: string;
  questions: LMSQuestionPublic[];
}

export interface LastManStandingAnswer {
  questions: LMSQuestionAnswer[];
}

export interface LMSBuilderResult {
  question: LMSQuestionPublic;
  answer: LMSQuestionAnswer;
  repeatKey: string;
}

export interface LMSBuildContext {
  date: string;
  slot: number;
  signature: boolean;
  seed: string;
  usedKeys: Set<string>;
  famousPool?: Awaited<ReturnType<typeof import('./shared.js').famousPlayers>>;
}
