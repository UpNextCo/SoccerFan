import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BINGO_TYPE_CAPS,
  selectBingoCategories,
  type BingoCandidates,
  type BingoCategory,
  type CatType,
} from './footballBingoGenerator.js';
import type { BingoTileUsage } from './puzzleHistory.js';

const types: CatType[] = [
  'nationality',
  'playedForClub',
  'nationClub',
  'clubCombo',
  'wonCompetition',
  'award',
  'statThreshold',
];

function category(type: CatType, suffix: string): BingoCategory {
  return {
    id: `${type}-${suffix}`,
    title: `${type} ${suffix}`,
    type,
    iconType: type === 'award' ? 'award' : 'custom',
    iconValue: suffix,
    matchingRule: suffix,
  };
}

function candidates(count = 8): BingoCandidates {
  return Object.fromEntries(
    types.map((type) => [type, Array.from({ length: count }, (_, i) => category(type, String(i)))])
  ) as BingoCandidates;
}

function used(frequency: number, daysSinceLastUse = 20): BingoTileUsage {
  return {
    frequency,
    lastUsedDate: '2026-06-01',
    daysSinceLastUse,
    usedDates: Array.from({ length: frequency }, (_, i) => `2026-05-${String(i + 1).padStart(2, '0')}`),
  };
}

test('Bingo tie-breaking is seeded and deterministic', () => {
  const pool = candidates();
  const first = selectBingoCategories(pool, new Map(), 1234).map((c) => c.id);
  const second = selectBingoCategories(pool, new Map(), 1234).map((c) => c.id);
  const anotherSeed = selectBingoCategories(pool, new Map(), 5678).map((c) => c.id);
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, anotherSeed);
});

test('Bingo selection penalizes frequency before seeded ties', () => {
  const pool = candidates();
  const usage = new Map<string, BingoTileUsage>([['nationality-0', used(8)]]);
  const selected = selectBingoCategories(pool, usage, 42);
  assert.equal(selected.some((c) => c.id === 'nationality-0'), false);
});

test('a recent award leaves its preferred slot open for another fresh type', () => {
  const pool = candidates();
  const usage = new Map<string, BingoTileUsage>(
    pool.award.map((c) => [c.id, used(1, 2)])
  );
  const selected = selectBingoCategories(pool, usage, 42);
  assert.equal(selected.length, 16);
  assert.equal(selected.some((c) => c.type === 'award'), false);
  assert.equal(selected.some((c) => usage.has(c.id)), false);
});

test('normal top-up respects per-type concentration caps', () => {
  const selected = selectBingoCategories(candidates(), new Map(), 42);
  const counts = new Map<CatType, number>();
  for (const tile of selected) counts.set(tile.type, (counts.get(tile.type) ?? 0) + 1);
  for (const type of types) {
    assert.ok((counts.get(type) ?? 0) <= BINGO_TYPE_CAPS[type], `${type} exceeded its cap`);
  }
});

test('balanced recent tiles are preferred over fresh tiles that exceed a type cap', () => {
  const pool = candidates(20);
  const usage = new Map<string, BingoTileUsage>();
  for (const type of types) {
    if (type === 'clubCombo') continue;
    for (const tile of pool[type]) usage.set(tile.id, used(1, 2));
  }
  const selected = selectBingoCategories(pool, usage, 42);
  const counts = new Map<CatType, number>();
  for (const tile of selected) counts.set(tile.type, (counts.get(tile.type) ?? 0) + 1);
  assert.equal(selected.length, 16);
  for (const type of types) {
    assert.ok((counts.get(type) ?? 0) <= BINGO_TYPE_CAPS[type], `${type} exceeded its cap`);
  }
});

test('selection completes a 16-tile board from a pathological thin mix', () => {
  const pool: BingoCandidates = {
    nationality: Array.from({ length: 16 }, (_, i) => category('nationality', String(i))),
    playedForClub: [],
    nationClub: [],
    clubCombo: [],
    wonCompetition: [],
    award: [],
    statThreshold: [],
  };
  const selected = selectBingoCategories(pool, new Map(), 42);
  assert.equal(selected.length, 16);
  assert.equal(new Set(selected.map((c) => c.id)).size, 16);
});
