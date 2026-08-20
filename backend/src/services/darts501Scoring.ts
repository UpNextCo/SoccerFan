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

export type Darts501BustReason =
  | 'impossible'
  | 'over_180'
  | 'checkout_overshoot'
  | 'wrong_category';

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

/** How many unused valid scores would finish from this remaining. */
export function countCheckoutOptions(
  players: Array<{ id: string; score: number }>,
  remaining: number,
  usedIds: Iterable<string> = [],
  window = DARTS501_CHECKOUT_WINDOW
): number {
  const used = usedIds instanceof Set ? usedIds : new Set(usedIds);
  let count = 0;
  for (const player of players) {
    if (used.has(player.id)) continue;
    if (!isValidDartsScore(player.score) || player.score === 0) continue;
    const next = remaining - player.score;
    if (next <= 0 && next >= -window) count += 1;
  }
  return count;
}

export function isPerfectCheckout(nextRemaining: number): boolean {
  return nextRemaining === 0;
}

/**
 * Apply one legal-or-bust dart to the current remaining total.
 * `score` is the footballer's calculated value (already clamped ≥ 0).
 */
function applyBust(
  remaining: number,
  inCheckout: boolean,
  checkoutBusts: number,
  reason: Darts501BustReason
): Darts501ThrowResolution {
  const nextBusts = checkoutBusts + 1;
  return {
    kind: nextBusts >= DARTS501_CHECKOUT_LIVES ? 'game_over' : 'bust',
    remaining,
    inCheckout,
    checkoutBusts: nextBusts,
    bustReason: reason,
  };
}

/** Live VS: same busts/lives, but a third bust is never game over. */
export function resolveDarts501ThrowLive(input: {
  remaining: number;
  score: number;
  inCheckout: boolean;
  checkoutBusts: number;
  wrongCategory?: boolean;
}): Darts501ThrowResolution {
  const result = resolveDarts501Throw(input);
  if (result.kind === 'game_over') {
    return { ...result, kind: 'bust' };
  }
  return result;
}

export function resolveDarts501Throw(input: {
  remaining: number;
  score: number;
  inCheckout: boolean;
  checkoutBusts: number;
  wrongCategory?: boolean;
}): Darts501ThrowResolution {
  const remaining = input.remaining;
  const inCheckout = input.inCheckout || isCheckoutRemaining(remaining);
  const checkoutBusts = input.checkoutBusts;

  if (input.wrongCategory) {
    return applyBust(remaining, inCheckout, checkoutBusts, 'wrong_category');
  }

  const scoreBust = bustReasonForScore(input.score);
  if (scoreBust) {
    return applyBust(remaining, inCheckout, checkoutBusts, scoreBust);
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
    return applyBust(remaining, true, checkoutBusts, 'checkout_overshoot');
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
