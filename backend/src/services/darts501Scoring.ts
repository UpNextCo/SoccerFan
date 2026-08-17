/**
 * Darts 501 rules + XP. Mirrored in ios/BallKnowledge/Domain/Darts501Models.swift.
 * Keep the two in lockstep — the number the client shows IS the XP the server persists.
 */

export const DARTS501_MAX_XP = 1000;
export const DARTS501_START = 501;
export const DARTS501_CHECKOUT_THRESHOLD = 180;
export const DARTS501_CHECKOUT_WINDOW = 10;
export const DARTS501_CHECKOUT_LIVES = 3;

/** Impossible three-dart totals. Also bust above 180. 0 is a legal score. */
export const DARTS501_IMPOSSIBLE_SCORES = new Set([
  163, 166, 169, 172, 173, 175, 176, 178, 179,
]);

export type Darts501BustReason = 'impossible' | 'over_180' | 'checkout_overshoot';

export type Darts501ThrowKind = 'score' | 'bust' | 'checkout' | 'perfect' | 'game_over';

export interface Darts501ThrowResolution {
  kind: Darts501ThrowKind;
  remaining: number;
  inCheckout: boolean;
  checkoutBusts: number;
  bustReason?: Darts501BustReason;
}

export function clampPlayerValue(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.round(raw));
}

export function isValidDartsScore(score: number): boolean {
  return score >= 0 && score <= 180 && !DARTS501_IMPOSSIBLE_SCORES.has(score);
}

export function bustReasonForScore(score: number): Darts501BustReason | null {
  if (score > 180) return 'over_180';
  if (DARTS501_IMPOSSIBLE_SCORES.has(score)) return 'impossible';
  return null;
}

export function isCheckoutRemaining(remaining: number): boolean {
  return remaining <= DARTS501_CHECKOUT_THRESHOLD;
}

export function isSuccessfulCheckout(nextRemaining: number): boolean {
  return nextRemaining <= 0 && nextRemaining >= -DARTS501_CHECKOUT_WINDOW;
}

export function isPerfectCheckout(nextRemaining: number): boolean {
  return nextRemaining === 0;
}

/**
 * Apply one legal-or-bust dart to the current remaining total.
 * `score` is the footballer's calculated value (already clamped ≥ 0).
 */
export function resolveDarts501Throw(input: {
  remaining: number;
  score: number;
  inCheckout: boolean;
  checkoutBusts: number;
}): Darts501ThrowResolution {
  const remaining = input.remaining;
  const inCheckout = input.inCheckout || isCheckoutRemaining(remaining);
  const checkoutBusts = input.checkoutBusts;
  const scoreBust = bustReasonForScore(input.score);

  if (scoreBust) {
    const nextBusts = inCheckout ? checkoutBusts + 1 : checkoutBusts;
    if (inCheckout && nextBusts >= DARTS501_CHECKOUT_LIVES) {
      return {
        kind: 'game_over',
        remaining,
        inCheckout: true,
        checkoutBusts: nextBusts,
        bustReason: scoreBust,
      };
    }
    return {
      kind: 'bust',
      remaining,
      inCheckout,
      checkoutBusts: nextBusts,
      bustReason: scoreBust,
    };
  }

  const nextRemaining = remaining - input.score;

  if (isSuccessfulCheckout(nextRemaining)) {
    return {
      kind: isPerfectCheckout(nextRemaining) ? 'perfect' : 'checkout',
      remaining: nextRemaining,
      inCheckout: true,
      checkoutBusts,
    };
  }

  if (inCheckout && nextRemaining < -DARTS501_CHECKOUT_WINDOW) {
    const nextBusts = checkoutBusts + 1;
    if (nextBusts >= DARTS501_CHECKOUT_LIVES) {
      return {
        kind: 'game_over',
        remaining,
        inCheckout: true,
        checkoutBusts: nextBusts,
        bustReason: 'checkout_overshoot',
      };
    }
    return {
      kind: 'bust',
      remaining,
      inCheckout: true,
      checkoutBusts: nextBusts,
      bustReason: 'checkout_overshoot',
    };
  }

  return {
    kind: 'score',
    remaining: nextRemaining,
    inCheckout: isCheckoutRemaining(nextRemaining),
    checkoutBusts,
  };
}

export function darts501Xp(input: {
  won: boolean;
  perfect: boolean;
  throws: number;
  busts: number;
}): number {
  if (!input.won) return 0;
  const base = input.perfect ? 1000 : 820;
  const throwPenalty = Math.max(0, input.throws - 4) * 40;
  const bustPenalty = Math.max(0, input.busts) * 30;
  return Math.max(280, Math.min(DARTS501_MAX_XP, base - throwPenalty - bustPenalty));
}
