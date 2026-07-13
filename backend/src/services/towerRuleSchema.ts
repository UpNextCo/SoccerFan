import { z } from 'zod';

const boundedText = z.string().trim().min(1).max(160);
const nonNegativeInt = (max: number) => z.number().int().nonnegative().max(max);

/**
 * The complete executable surface of the Tower rule engine.
 *
 * `.strict()` is intentional: admin-authored rules may only select from these
 * declarative fields. SQL fragments, arbitrary predicates, and unknown config
 * are rejected before the database evaluator is called.
 */
export const towerRuleSchema = z.object({
  validIds: z.array(z.string().uuid()).min(1).max(500).optional(),
  label: boundedText.optional(),
  nationality: boundedText.optional(),
  nonEuropean: z.literal(true).optional(),
  position: z.enum(['Goalkeeper', 'Defender']).optional(),
  leaguePlayed: boundedText.optional(),
  playedFor: z.array(boundedText).min(1).max(4).optional(),
  minPlApps: nonNegativeInt(1_000).optional(),
  minPlAssists: nonNegativeInt(1_000).optional(),
  minPlGoals: nonNegativeInt(1_000).optional(),
  minPlYellowCards: nonNegativeInt(1_000).optional(),
  minPlCleanSheets: nonNegativeInt(1_000).optional(),
  uclWinner: z.literal(true).optional(),
  minUclGoals: nonNegativeInt(500).optional(),
  minUclApps: nonNegativeInt(500).optional(),
  minPeakValueEur: nonNegativeInt(2_000_000_000).optional(),
  minRecordFeeEur: nonNegativeInt(2_000_000_000).optional(),
}).strict().superRefine((rule, ctx) => {
  const selectorKeys = Object.keys(rule).filter((key) => key !== 'label');
  if (selectorKeys.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'A rule must contain at least one player selector.',
    });
  }
  if (rule.validIds && selectorKeys.some((key) => key !== 'validIds')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['validIds'],
      message: 'validIds is a closed set and cannot be combined with dynamic selectors.',
    });
  }
  if (rule.nationality && rule.nonEuropean) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['nonEuropean'],
      message: 'nationality and nonEuropean cannot be combined.',
    });
  }
  if (rule.playedFor && new Set(rule.playedFor.map((club) => club.toLowerCase())).size !== rule.playedFor.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['playedFor'],
      message: 'playedFor clubs must be unique.',
    });
  }
  if (rule.validIds && new Set(rule.validIds).size !== rule.validIds.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['validIds'],
      message: 'validIds must be unique.',
    });
  }
});

export type TowerRule = z.infer<typeof towerRuleSchema>;
