import { sql } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import type { LMSBuildContext, LMSBuilderResult } from '../types.js';
import { isHouseholdIndexed, hlPairUsedKey, metricUsedKey, playerUsedKey } from '../recognition.js';
import { makeOptionId, seededIndex } from '../shared.js';
import {
  availableHigherLowerMetrics,
  formatHigherLowerValue,
  selectHigherLowerPair,
  type HigherLowerMetric,
  type HigherLowerPairRow,
} from '../higherLowerCatalog.js';

export {
  availableHigherLowerMetrics,
  formatHigherLowerValue,
  HIGHER_LOWER_METRICS,
  HIGHER_LOWER_SLOT_METRICS,
  selectHigherLowerPair,
} from '../higherLowerCatalog.js';

export async function buildHigherLower(ctx: LMSBuildContext): Promise<LMSBuilderResult | null> {
  const available = availableHigherLowerMetrics(ctx.slot, ctx.usedKeys);
  if (available.length === 0) return null;

  // Rotate which metric we try first, then walk the rest so a sparse metric can't kill the slot.
  const startMetric = seededIndex(`${ctx.seed}:metric`, available.length);
  for (let mi = 0; mi < available.length; mi += 1) {
    const metric = available[(startMetric + mi) % available.length]!;
    const built = await buildHigherLowerForMetric(ctx, metric);
    if (built) return built;
  }
  return null;
}

async function buildHigherLowerForMetric(
  ctx: LMSBuildContext,
  metric: HigherLowerMetric
): Promise<LMSBuilderResult | null> {
  const questionId = `${ctx.date}-lms-q${ctx.slot}`;
  const repeatKey = metricUsedKey(metric.id);
  const minGap = ctx.difficulty.hlMinGap;
  const index = ctx.clubIndex;
  const participationFilter = metric.participation
    ? sql`AND ${sql.raw(metric.participation.col)} >= ${metric.participation.min}`
    : sql``;

  const rows = (await db.execute(sql`
    WITH agg AS (
      SELECT p.id, p.name, p.market_value_tier AS mvt,
        COALESCE(SUM(s.goals)       FILTER (WHERE s.league_id = 39), 0)::int AS pl_goals,
        COALESCE(SUM(s.assists)     FILTER (WHERE s.league_id = 39), 0)::int AS pl_assists,
        COALESCE(SUM(s.appearances) FILTER (WHERE s.league_id = 39), 0)::int AS pl_apps,
        COALESCE(SUM(s.goals)       FILTER (WHERE s.league_id = 140), 0)::int AS laliga_goals,
        COALESCE(SUM(s.appearances) FILTER (WHERE s.league_id = 140), 0)::int AS laliga_apps,
        COALESCE(SUM(s.goals)       FILTER (WHERE s.league_id = 135), 0)::int AS seriea_goals,
        COALESCE(SUM(s.appearances) FILTER (WHERE s.league_id = 135), 0)::int AS seriea_apps,
        COALESCE(SUM(s.goals)       FILTER (WHERE s.league_id = 78), 0)::int AS bundesliga_goals,
        COALESCE(SUM(s.appearances) FILTER (WHERE s.league_id = 78), 0)::int AS bundesliga_apps,
        COALESCE(SUM(s.goals)       FILTER (WHERE s.league_id IN (39, 140, 135, 78, 61)), 0)::int AS big5_goals,
        COALESCE(SUM(s.appearances) FILTER (WHERE s.league_id IN (39, 140, 135, 78, 61)), 0)::int AS big5_apps,
        COALESCE(SUM(s.goals)       FILTER (WHERE s.league_id = 2), 0)::int AS cl_goals,
        COALESCE(SUM(s.appearances) FILTER (WHERE s.league_id = 2), 0)::int AS cl_apps,
        COALESCE(p.peak_market_value_eur, 0)::int AS peak_value,
        COALESCE(p.record_fee_eur, 0)::int AS record_fee,
        CASE WHEN COALESCE(es.intl_caps, 0) BETWEEN 30 AND 280 THEN es.intl_caps ELSE 0 END::int AS intl_caps,
        CASE WHEN COALESCE(es.intl_goals, 0) BETWEEN 1 AND 150 THEN es.intl_goals ELSE 0 END::int AS intl_goals
      FROM players p
      LEFT JOIN player_stats s ON s.player_id = p.id
      LEFT JOIN player_extra_stats es ON es.player_id = p.id
      WHERE p.market_value_tier >= 4
      GROUP BY p.id, p.name, p.market_value_tier, p.peak_market_value_eur,
        p.record_fee_eur, es.intl_caps, es.intl_goals
    )
    SELECT id, name, mvt, ${sql.raw(metric.col)} AS val
    FROM agg
    WHERE ${sql.raw(metric.col)} >= ${metric.min}
      ${participationFilter}
    ORDER BY val DESC, name
    LIMIT 120
  `)) as unknown as HigherLowerPairRow[];

  if (rows.length < 12) return null;

  const household = rows.filter((r) => !index || isHouseholdIndexed(index, r.id));
  if (household.length < 10) return null;

  for (let pass = 0; pass < 2; pass += 1) {
    const gapFloor = pass === 0 ? minGap : Math.max(0.05, minGap * 0.65);
    const pair = selectHigherLowerPair(household, {
      seed: `${ctx.seed}:pass:${pass}`,
      metricId: metric.id,
      tier: ctx.difficulty.tier,
      minGap: gapFloor,
      usedKeys: ctx.usedKeys,
    });
    if (pair) return buildPair(pair.hi, pair.lo, ctx, metric, questionId, repeatKey, pair.salt);
  }
  return null;
}

function buildPair(
  hi: HigherLowerPairRow,
  lo: HigherLowerPairRow,
  ctx: LMSBuildContext,
  metric: HigherLowerMetric,
  questionId: string,
  repeatKey: string,
  sideSalt: number
): LMSBuilderResult | null {
  const firstIsHi = seededIndex(`${ctx.seed}:side:${sideSalt}`, 2) === 0;
  const ordered = firstIsHi ? [hi, lo] : [lo, hi];
  const correctId = makeOptionId(questionId, hi.id);

  const options = [
    { id: makeOptionId(questionId, ordered[0]!.id), label: ordered[0]!.name },
    { id: makeOptionId(questionId, ordered[1]!.id), label: ordered[1]!.name },
  ];

  const reveal = `${hi.name} (${formatHigherLowerValue(hi.val, metric)}) vs ${lo.name} (${formatHigherLowerValue(lo.val, metric)})`;

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
