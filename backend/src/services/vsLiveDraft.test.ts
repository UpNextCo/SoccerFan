import assert from 'node:assert/strict';
import test from 'node:test';
import {
  afterSuccessfulPick,
  advanceIfNeeded,
  draftTurnOrder,
  initLiveState,
  snakePicker,
  turnUserId,
  usedPlayerIds,
  VS_SLOT_TIMEOUT_MS,
  type VsLivePickRecord,
  type VsLiveState,
} from './vsLiveDraft.js';

const puzzle = {
  slots: [
    { id: 'gk', position: 'Goalkeeper' },
    { id: 'st', position: 'Centre-Forward' },
  ],
} as unknown as import('./battleGenerator.js').BattlePuzzleJson;

function namedPick(slotId: string, playerId: string): VsLivePickRecord {
  return {
    slotId,
    constraintId: 'c1',
    playerId,
    playerName: playerId,
    headshotUrl: null,
    constraintLabel: 'Spain',
    statValue: 9,
    lockedAt: new Date().toISOString(),
  };
}

test('two players snake: A B, then B A, then A B', () => {
  assert.equal(snakePicker(['a', 'b'], 0), 'a');
  assert.equal(snakePicker(['a', 'b'], 1), 'b');
  assert.equal(snakePicker(['a', 'b'], 2), 'b');
  assert.equal(snakePicker(['a', 'b'], 3), 'a');
  assert.equal(snakePicker(['a', 'b'], 4), 'a');
  assert.deepEqual(draftTurnOrder(['a', 'b'], 0), ['a', 'b']);
  assert.deepEqual(draftTurnOrder(['a', 'b'], 1), ['b', 'a']);
});

test('three and four players snake back after a full round', () => {
  assert.deepEqual(draftTurnOrder(['a', 'b', 'c'], 0), ['a', 'b', 'c']);
  assert.deepEqual(draftTurnOrder(['a', 'b', 'c'], 1), ['c', 'b', 'a']);
  assert.equal(snakePicker(['a', 'b', 'c'], 3), 'c');
  assert.deepEqual(draftTurnOrder(['a', 'b', 'c', 'd'], 0), ['a', 'b', 'c', 'd']);
  assert.deepEqual(draftTurnOrder(['a', 'b', 'c', 'd'], 1), ['d', 'c', 'b', 'a']);
});

test('usedPlayerIds are shared across the table', () => {
  const live = initLiveState(['a', 'b']);
  live.picksByUser.a = [namedPick('gk', 'reina')];
  assert.equal(usedPlayerIds(live).has('reina'), true);
  assert.equal(usedPlayerIds(live, 'b').has('reina'), true);
});

test('a successful pick can be any empty slot and then snakes', () => {
  const now = Date.parse('2026-08-19T00:00:00.000Z');
  const live = initLiveState(['a', 'b'], now);
  assert.equal(turnUserId(live, ['a', 'b'], 2), 'a');
  const afterA: VsLiveState = {
    ...live,
    picksByUser: { ...live.picksByUser, a: [namedPick('st', 'p1')] },
  };
  const next = afterSuccessfulPick(puzzle, afterA, ['a', 'b'], now + 1_000);
  assert.equal(turnUserId(next, ['a', 'b'], 2), 'b');
  assert.equal(Date.parse(next.deadlineAt), now + 1_000 + VS_SLOT_TIMEOUT_MS);
});

test('second pick stays with B, then A can fill a different slot', () => {
  const now = Date.parse('2026-08-19T00:00:00.000Z');
  const live: VsLiveState = {
    ...initLiveState(['a', 'b'], now),
    slotIndex: 1,
    picksByUser: {
      a: [namedPick('st', 'p1')],
      b: [namedPick('gk', 'p2')],
    },
  };
  const next = afterSuccessfulPick(puzzle, live, ['a', 'b'], now + 500);
  assert.equal(turnUserId(next, ['a', 'b'], 2), 'b');
});

test('game finishes when every player has filled every slot', () => {
  const now = Date.parse('2026-08-19T00:00:00.000Z');
  const live: VsLiveState = {
    ...initLiveState(['a', 'b'], now),
    slotIndex: 3,
    picksByUser: {
      a: [namedPick('gk', 'p1'), namedPick('st', 'p3')],
      b: [namedPick('gk', 'p2'), namedPick('st', 'p4')],
    },
  };
  const next = afterSuccessfulPick(puzzle, live, ['a', 'b'], now + 500);
  assert.equal(next.finished, true);
});

test('timeout passes the turn without filling a slot', () => {
  const now = Date.parse('2026-08-19T00:00:00.000Z');
  const started = initLiveState(['a', 'b'], now);
  const later = advanceIfNeeded(puzzle, started, ['a', 'b'], now + VS_SLOT_TIMEOUT_MS + 1);
  assert.equal(turnUserId(later, ['a', 'b'], 2), 'b');
  assert.equal(later.picksByUser.a?.length, 0);
  assert.equal(later.picksByUser.b?.length, 0);
});
