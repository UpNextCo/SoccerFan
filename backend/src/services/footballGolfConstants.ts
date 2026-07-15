/** Canonical Football Golf course shape shared by generation, validation, and Ops. */
export const FOOTBALL_GOLF_HOLE_COUNT = 5;

/** Balanced five-hole course: total par 16 before per-prompt safety clamping. */
export const FOOTBALL_GOLF_PAR_SEQUENCE = [2, 3, 3, 4, 4] as const;

export const FOOTBALL_GOLF_MAX_XP = 800;

export const FOOTBALL_GOLF_RULE_COOLDOWN_DAYS = 28;

/**
 * Five rules today plus five for each of the preceding 28 days. A bank of 145
 * semantically distinct rules can therefore sustain the fixed cooldown.
 */
export const FOOTBALL_GOLF_REQUIRED_RULE_INVENTORY =
  FOOTBALL_GOLF_HOLE_COUNT * (FOOTBALL_GOLF_RULE_COOLDOWN_DAYS + 1);
