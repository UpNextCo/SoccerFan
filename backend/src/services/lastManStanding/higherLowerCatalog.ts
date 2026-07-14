import type { LMSTier } from './difficulty.js';
import { hlPairUsedKey, metricUsedKey, playerUsedKey } from './recognitionKeys.js';

export type HigherLowerMetricId =
  | 'pl_goals'
  | 'pl_assists'
  | 'laliga_goals'
  | 'seriea_goals'
  | 'bundesliga_goals'
  | 'big5_goals'
  | 'big5_apps'
  | 'cl_goals'
  | 'cl_apps'
  | 'intl_caps'
  | 'intl_goals'
  | 'peak_value'
  | 'record_fee';

type AggregateColumn =
  | HigherLowerMetricId
  | 'pl_apps'
  | 'laliga_apps'
  | 'seriea_apps'
  | 'bundesliga_apps';

export interface HigherLowerMetric {
  id: HigherLowerMetricId;
  prompt: string;
  col: HigherLowerMetricId;
  min: number;
  participation?: { col: AggregateColumn; min: number };
  format: 'integer' | 'eur';
}

/**
 * All columns are fixed server-side aggregate aliases. Participation gates prevent a partial
 * season or a thin historical row from being presented as a complete career comparison.
 */
export const HIGHER_LOWER_METRICS: readonly HigherLowerMetric[] = [
  { id: 'pl_goals', prompt: 'More Premier League goals?', col: 'pl_goals', min: 40, participation: { col: 'pl_apps', min: 100 }, format: 'integer' },
  { id: 'pl_assists', prompt: 'More Premier League assists?', col: 'pl_assists', min: 20, participation: { col: 'pl_apps', min: 100 }, format: 'integer' },
  { id: 'laliga_goals', prompt: 'More La Liga goals?', col: 'laliga_goals', min: 35, participation: { col: 'laliga_apps', min: 90 }, format: 'integer' },
  { id: 'seriea_goals', prompt: 'More Serie A goals?', col: 'seriea_goals', min: 30, participation: { col: 'seriea_apps', min: 90 }, format: 'integer' },
  { id: 'bundesliga_goals', prompt: 'More Bundesliga goals?', col: 'bundesliga_goals', min: 30, participation: { col: 'bundesliga_apps', min: 80 }, format: 'integer' },
  { id: 'big5_goals', prompt: "More goals in Europe's top five leagues?", col: 'big5_goals', min: 70, participation: { col: 'big5_apps', min: 180 }, format: 'integer' },
  { id: 'big5_apps', prompt: "More appearances in Europe's top five leagues?", col: 'big5_apps', min: 180, format: 'integer' },
  { id: 'cl_goals', prompt: 'More Champions League goals?', col: 'cl_goals', min: 10, participation: { col: 'cl_apps', min: 30 }, format: 'integer' },
  { id: 'cl_apps', prompt: 'More Champions League appearances?', col: 'cl_apps', min: 30, format: 'integer' },
  { id: 'intl_caps', prompt: 'More international caps?', col: 'intl_caps', min: 50, format: 'integer' },
  { id: 'intl_goals', prompt: 'More senior international goals?', col: 'intl_goals', min: 20, participation: { col: 'intl_caps', min: 70 }, format: 'integer' },
  { id: 'peak_value', prompt: 'Higher peak market value?', col: 'peak_value', min: 30_000_000, format: 'eur' },
  { id: 'record_fee', prompt: 'Higher record transfer fee?', col: 'record_fee', min: 20_000_000, format: 'eur' },
] as const;

/** Disjoint pools mean earlier higher/lower slots cannot exhaust a later slot's metrics. */
export const HIGHER_LOWER_SLOT_METRICS: Readonly<Record<number, readonly HigherLowerMetricId[]>> = {
  1: ['pl_goals', 'cl_goals', 'laliga_goals', 'seriea_goals', 'bundesliga_goals'],
  6: ['pl_assists', 'big5_goals', 'cl_apps', 'peak_value'],
  8: ['intl_caps', 'intl_goals', 'big5_apps', 'record_fee'],
};

const METRIC_BY_PROMPT = new Map<string, HigherLowerMetricId>([
  ...HIGHER_LOWER_METRICS.map((metric) => [metric.prompt, metric.id] as const),
  // Preserve recognition of cards generated before the prompt was made more precise.
  ['Higher peak transfer value?', 'peak_value'],
]);

export function higherLowerMetricFromPrompt(prompt: string): HigherLowerMetricId | null {
  return METRIC_BY_PROMPT.get(prompt.trim()) ?? null;
}

export function availableHigherLowerMetrics(
  slot: number,
  usedKeys: ReadonlySet<string>
): HigherLowerMetric[] {
  const allowed = HIGHER_LOWER_SLOT_METRICS[slot];
  if (!allowed) return [];
  return HIGHER_LOWER_METRICS.filter(
    (metric) => allowed.includes(metric.id) && !usedKeys.has(metricUsedKey(metric.id))
  );
}

export interface HigherLowerPairRow {
  id: string;
  name: string;
  val: number;
  mvt: number;
}

export interface HigherLowerPair {
  hi: HigherLowerPairRow;
  lo: HigherLowerPairRow;
  salt: number;
}

interface PairSelectionArgs {
  seed: string;
  metricId: HigherLowerMetricId;
  tier: LMSTier;
  minGap: number;
  usedKeys: ReadonlySet<string>;
}

const MAX_ROWS = 120;
const MAX_PER_BAND = 24;

function stableHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function deterministicIndex(seed: string, length: number): number {
  return length > 0 ? stableHash(seed) % length : 0;
}

function maxGapForTier(tier: LMSTier): number {
  if (tier === 'easy') return 0.5;
  if (tier === 'medium') return 0.4;
  if (tier === 'hard') return 0.32;
  return 0.28;
}

/**
 * Builds a bounded, stratified candidate pool instead of repeatedly comparing adjacent rows.
 * Rank bands spread cards through the leaderboard; gap bands avoid both ties and giant giveaways.
 */
export function selectHigherLowerPair(
  inputRows: readonly HigherLowerPairRow[],
  args: PairSelectionArgs
): HigherLowerPair | null {
  const rows = [...inputRows]
    .filter((row) => Number.isFinite(row.val) && row.val > 0)
    .sort((a, b) => b.val - a.val || a.name.localeCompare(b.name))
    .slice(0, MAX_ROWS);
  if (rows.length < 2) return null;

  const maxGap = maxGapForTier(args.tier);
  const bands = new Map<string, Array<HigherLowerPair & { order: number }>>();

  for (let i = 0; i < rows.length - 1; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const hi = rows[i]!;
      const lo = rows[j]!;
      if (hi.val === lo.val) continue;
      if (args.usedKeys.has(playerUsedKey(hi.id)) || args.usedKeys.has(playerUsedKey(lo.id))) continue;
      if (args.usedKeys.has(hlPairUsedKey(hi.id, lo.id, args.metricId))) continue;

      const gap = (hi.val - lo.val) / Math.max(hi.val, 1);
      if (gap < args.minGap || gap > maxGap) continue;
      if (args.tier === 'hard' && hi.mvt < 5 && lo.mvt < 5) continue;

      const rankBand = Math.min(2, Math.floor((i / rows.length) * 3));
      const gapProgress = (gap - args.minGap) / Math.max(maxGap - args.minGap, 0.001);
      const gapBand = Math.min(2, Math.floor(gapProgress * 3));
      const key = `${rankBand}:${gapBand}`;
      const group = bands.get(key) ?? [];
      group.push({
        hi,
        lo,
        salt: stableHash(`${hi.id}:${lo.id}`),
        order: stableHash(`${args.metricId}:${hi.id}:${lo.id}`),
      });
      bands.set(key, group);
    }
  }

  const candidates = [...bands.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([, group]) => group.sort((a, b) => a.order - b.order).slice(0, MAX_PER_BAND));
  if (candidates.length === 0) return null;

  const selected = candidates[deterministicIndex(`${args.seed}:banded-pair`, candidates.length)]!;
  return { hi: selected.hi, lo: selected.lo, salt: selected.salt };
}

export function formatHigherLowerValue(value: number, metric: HigherLowerMetric): string {
  if (metric.format !== 'eur') return String(value);
  const millions = value / 1_000_000;
  return `€${Number.isInteger(millions) ? millions.toFixed(0) : millions.toFixed(1)}m`;
}
