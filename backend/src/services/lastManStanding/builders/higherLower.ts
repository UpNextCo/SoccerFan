import { sql } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import type { LMSBuildContext, LMSBuilderResult } from '../types.js';
import { isHouseholdIndexed, hlPairUsedKey, metricUsedKey, playerUsedKey } from '../recognition.js';
import { hashStr, makeOptionId, seededIndex } from '../shared.js';

interface StatPairRow {
  id: string;
  name: string;
  val: number;
  mvt: number;
}

const COMPARISONS = [
  { id: 'pl_goals', prompt: 'More Premier League goals?', col: 'pl_goals', min: 40 },
  { id: 'cl_goals', prompt: 'More Champions League goals?', col: 'cl_goals', min: 10 },
  { id: 'cl_apps', prompt: 'More Champions League appearances?', col: 'cl_apps', min: 30 },
  { id: 'intl_caps', prompt: 'More international caps?', col: 'intl_caps', min: 40 },
  { id: 'peak_value', prompt: 'Higher peak transfer value?', col: 'peak_value', min: 30_000_000 },
] as const;

/** One metric per daily puzzle; slot picks from its pool only. */
const SLOT_METRICS: Record<number, readonly string[]> = {
  1: ['pl_goals', 'cl_goals'],
  6: ['cl_apps', 'peak_value'],
  8: ['intl_caps', 'cl_apps'],
};

export async function buildHigherLower(ctx: LMSBuildContext): Promise<LMSBuilderResult | null> {
  const allowedIds = SLOT_METRICS[ctx.slot];
  if (!allowedIds) return null;

  const available = COMPARISONS.filter(
    (m) => allowedIds.includes(m.id) && !ctx.usedKeys.has(metricUsedKey(m.id))
  );
  if (available.length === 0) return null;

  const metric = available[seededIndex(`${ctx.seed}:metric`, available.length)]!;
  const questionId = `${ctx.date}-lms-q${ctx.slot}`;
  const repeatKey = metricUsedKey(metric.id);
  const minGap = ctx.difficulty.hlMinGap;
  const index = ctx.clubIndex;

  const rows = (await db.execute(sql`
    WITH agg AS (
      SELECT p.id, p.name, p.market_value_tier AS mvt,
        COALESCE(SUM(s.goals)       FILTER (WHERE s.league_id = 39), 0)::int AS pl_goals,
        COALESCE(SUM(s.goals)       FILTER (WHERE s.league_id = 2), 0)::int AS cl_goals,
        COALESCE(SUM(s.appearances) FILTER (WHERE s.league_id = 2), 0)::int AS cl_apps,
        COALESCE(p.peak_market_value_eur, 0)::bigint AS peak_value,
        CASE WHEN COALESCE(es.intl_caps, 0) BETWEEN 30 AND 280 THEN es.intl_caps ELSE 0 END::int AS intl_caps
      FROM players p
      LEFT JOIN player_stats s ON s.player_id = p.id
      LEFT JOIN player_extra_stats es ON es.player_id = p.id
      WHERE p.market_value_tier >= 4
      GROUP BY p.id, p.name, p.market_value_tier, p.peak_market_value_eur, es.intl_caps
    )
    SELECT id, name, mvt, ${sql.raw(metric.col)} AS val
    FROM agg
    WHERE ${sql.raw(metric.col)} >= ${metric.min}
    ORDER BY val DESC, name
    LIMIT 120
  `)) as unknown as StatPairRow[];

  if (rows.length < 12) return null;

  const household = rows.filter((r) => !index || isHouseholdIndexed(index, r.id));
  if (household.length < 10) return null;

  const minOffset = ctx.difficulty.tier === 'easy' ? 4 : ctx.difficulty.tier === 'medium' ? 2 : 1;
  const start = seededIndex(`${ctx.seed}:pair`, Math.max(1, household.length - 1));

  for (let pass = 0; pass < 2; pass += 1) {
    const gapFloor = pass === 0 ? minGap : Math.max(0.05, minGap * 0.65);
    for (let offset = minOffset; offset < Math.min(50, household.length - 1); offset += 1) {
      const i = (start + offset) % (household.length - 1);
      const a = household[i]!;
      const b = household[i + 1]!;
      if (a.val === b.val) continue;
      if (ctx.usedKeys.has(playerUsedKey(a.id)) || ctx.usedKeys.has(playerUsedKey(b.id))) continue;
      if (ctx.usedKeys.has(hlPairUsedKey(a.id, b.id, metric.id))) continue;

      const hi = a.val > b.val ? a : b;
      const lo = a.val > b.val ? b : a;
      const gap = (hi.val - lo.val) / Math.max(hi.val, 1);
      if (gap < gapFloor) continue;

      // Hard slots: both must be tier 5 or both household megastars with tight gap.
      if (ctx.difficulty.tier === 'hard' && hi.mvt < 5 && lo.mvt < 5) continue;

      const built = buildPair(hi, lo, ctx, metric, questionId, repeatKey, offset);
      if (built) return built;
    }
  }
  return null;
}

function buildPair(
  hi: StatPairRow,
  lo: StatPairRow,
  ctx: LMSBuildContext,
  metric: (typeof COMPARISONS)[number],
  questionId: string,
  repeatKey: string,
  sideSalt: number
): LMSBuilderResult | null {
  const firstIsHi = (hashStr(`${ctx.seed}:side:${sideSalt}`) & 1) === 0;
  const ordered = firstIsHi ? [hi, lo] : [lo, hi];
  const correctId = makeOptionId(questionId, hi.id);

  const options = [
    { id: makeOptionId(questionId, ordered[0]!.id), label: ordered[0]!.name },
    { id: makeOptionId(questionId, ordered[1]!.id), label: ordered[1]!.name },
  ];

  const reveal = `${hi.name} (${formatVal(hi.val, metric.id)}) vs ${lo.name} (${formatVal(lo.val, metric.id)})`;

  return {
    repeatKey,
    extraUsedKeys: [playerUsedKey(hi.id), playerUsedKey(lo.id), hlPairUsedKey(hi.id, lo.id, metric.id)],
    question: {
      id: questionId,
      type: 'higher_lower',
      slot: ctx.slot,
      signature: ctx.signature,
      prompt: metric.prompt,
      options,
      presentation: { layout: 'two_up' },
    },
    answer: {
      questionId,
      correctOptionId: correctId,
      reveal,
    },
  };
}

function formatVal(v: number, metricId: string): string {
  if (metricId === 'peak_value') return `€${Math.round(v / 1_000_000)}m`;
  return String(v);
}
