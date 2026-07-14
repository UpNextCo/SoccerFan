import assert from 'node:assert/strict';
import test from 'node:test';
import {
  availableHigherLowerMetrics,
  formatHigherLowerValue,
  HIGHER_LOWER_METRICS,
  HIGHER_LOWER_SLOT_METRICS,
  higherLowerMetricFromPrompt,
  selectHigherLowerPair,
  type HigherLowerPairRow,
} from './higherLowerCatalog.js';
import { extractLMSUsedKeys } from './freshness.js';
import { metricFromPrompt } from './recognition.js';
import { hlPairUsedKey, metricUsedKey, playerUsedKey } from './recognitionKeys.js';
import type { LastManStandingAnswer, LastManStandingPuzzle } from './types.js';

test('expanded catalog has one canonical prompt mapping for every metric', () => {
  assert.equal(HIGHER_LOWER_METRICS.length, 13);
  assert.equal(new Set(HIGHER_LOWER_METRICS.map((metric) => metric.id)).size, 13);
  for (const metric of HIGHER_LOWER_METRICS) {
    assert.equal(higherLowerMetricFromPrompt(metric.prompt), metric.id);
    assert.equal(metricFromPrompt(metric.prompt), metric.id);
  }
  assert.equal(higherLowerMetricFromPrompt('Higher peak transfer value?'), 'peak_value');
});

test('history extraction preserves pair cooldowns for every expanded metric prompt', () => {
  for (const [index, metric] of HIGHER_LOWER_METRICS.entries()) {
    const questionId = `mapping-${index}`;
    const puzzle: LastManStandingPuzzle = {
      modeId: 'last_man_standing',
      puzzleId: `puzzle-${index}`,
      date: '2026-07-14',
      title: 'Last Man Standing',
      version: 10,
      questions: [{
        id: questionId,
        type: 'higher_lower',
        slot: 1,
        prompt: metric.prompt,
        options: [
          { id: `${questionId}-player-a`, label: 'Player A' },
          { id: `${questionId}-player-b`, label: 'Player B' },
        ],
      }],
    };
    const answer: LastManStandingAnswer = {
      questions: [{ questionId, correctOptionId: `${questionId}-player-a` }],
    };
    assert.ok(
      extractLMSUsedKeys(puzzle, answer).includes(hlPairUsedKey('player-a', 'player-b', metric.id)),
      `missing history key for ${metric.id}`
    );
  }
});

test('each higher/lower slot retains distinct metrics after earlier slots consume theirs', () => {
  const used = new Set<string>();
  const selected: string[] = [];

  for (const slot of [1, 6, 8]) {
    const available = availableHigherLowerMetrics(slot, used);
    assert.ok(available.length >= 4, `slot ${slot} should have multiple fallbacks`);
    const metric = available[0]!;
    selected.push(metric.id);
    used.add(metricUsedKey(metric.id));
  }

  assert.equal(new Set(selected).size, 3);
  const pools = [1, 6, 8].map((slot) => new Set(HIGHER_LOWER_SLOT_METRICS[slot]));
  assert.equal([...pools[0]!].some((id) => pools[1]!.has(id) || pools[2]!.has(id)), false);
  assert.equal([...pools[1]!].some((id) => pools[2]!.has(id)), false);
});

const PAIR_FIXTURES: HigherLowerPairRow[] = Array.from({ length: 30 }, (_, index) => ({
  id: `player-${index}`,
  name: `Player ${index}`,
  val: 200 - index * 5,
  mvt: index % 4 === 0 ? 5 : 4,
}));

test('banded pair selection produces seeded diversity without ties or giant gaps', () => {
  const pairKeys = new Set<string>();
  for (let seed = 0; seed < 60; seed += 1) {
    const pair = selectHigherLowerPair(PAIR_FIXTURES, {
      seed: `fixture:${seed}`,
      metricId: 'big5_goals',
      tier: 'medium',
      minGap: 0.12,
      usedKeys: new Set(),
    });
    assert.ok(pair);
    const gap = (pair.hi.val - pair.lo.val) / pair.hi.val;
    assert.ok(gap >= 0.12);
    assert.ok(gap <= 0.4);
    assert.notEqual(pair.hi.val, pair.lo.val);
    pairKeys.add(hlPairUsedKey(pair.hi.id, pair.lo.id, 'big5_goals'));
  }
  assert.ok(pairKeys.size >= 15, `expected broad diversity, got ${pairKeys.size} pairs`);
});

test('pair selection respects used players and pair cooldown keys', () => {
  const first = selectHigherLowerPair(PAIR_FIXTURES, {
    seed: 'cooldown',
    metricId: 'pl_goals',
    tier: 'easy',
    minGap: 0.18,
    usedKeys: new Set(),
  });
  assert.ok(first);

  const used = new Set([
    playerUsedKey(first.hi.id),
    hlPairUsedKey(first.hi.id, first.lo.id, 'pl_goals'),
  ]);
  const second = selectHigherLowerPair(PAIR_FIXTURES, {
    seed: 'cooldown',
    metricId: 'pl_goals',
    tier: 'easy',
    minGap: 0.18,
    usedKeys: used,
  });
  assert.ok(second);
  assert.notEqual(second.hi.id, first.hi.id);
  assert.notEqual(second.lo.id, first.hi.id);
  assert.notEqual(
    hlPairUsedKey(second.hi.id, second.lo.id, 'pl_goals'),
    hlPairUsedKey(first.hi.id, first.lo.id, 'pl_goals')
  );
});

test('money metrics format database euro values without rounding away precision', () => {
  const recordFee = HIGHER_LOWER_METRICS.find((metric) => metric.id === 'record_fee')!;
  assert.equal(formatHigherLowerValue(105_000_000, recordFee), '€105m');
  assert.equal(formatHigherLowerValue(72_500_000, recordFee), '€72.5m');
});
