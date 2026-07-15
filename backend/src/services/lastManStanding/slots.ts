import type { LMSGeneratedQuestionType } from './types.js';

export interface LMSSlotDefinition {
  slot: number;
  type: LMSGeneratedQuestionType;
  signature?: boolean;
}

/** Fixed daily shape — content rotates, structure doesn't. */
export const LMS_DAILY_SLOTS: LMSSlotDefinition[] = [
  { slot: 1, type: 'higher_lower' },
  { slot: 2, type: 'image_badge' },
  { slot: 3, type: 'career_path' },
  { slot: 4, type: 'odd_one_out' },
  { slot: 5, type: 'career_path' },
  { slot: 6, type: 'higher_lower' },
  { slot: 7, type: 'which_club' },
  { slot: 8, type: 'higher_lower' },
  { slot: 9, type: 'odd_one_out' },
  { slot: 10, type: 'career_path', signature: true },
];
