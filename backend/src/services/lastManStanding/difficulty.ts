export type LMSTier = 'easy' | 'medium' | 'hard' | 'signature';

export interface LMSDifficulty {
  tier: LMSTier;
  /** Minimum relative stat gap for higher/lower (0–1). */
  hlMinGap: number;
  /** Badge blur radius — lower = more legible. */
  imageBlur: number;
}

export function difficultyForSlot(slot: number, signature: boolean): LMSDifficulty {
  if (signature) {
    return { tier: 'signature', hlMinGap: 0.08, imageBlur: 5 };
  }
  if (slot <= 2) return { tier: 'easy', hlMinGap: 0.18, imageBlur: 8 };
  if (slot <= 5) return { tier: 'medium', hlMinGap: 0.12, imageBlur: 7 };
  if (slot <= 8) return { tier: 'hard', hlMinGap: 0.08, imageBlur: 6 };
  return { tier: 'hard', hlMinGap: 0.06, imageBlur: 5 };
}
