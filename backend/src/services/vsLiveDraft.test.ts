import assert from 'node:assert/strict';
import test from 'node:test';
import {
  afterSuccessfulPick,
  advanceIfNeeded,
  initLiveState,
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

test('turnUserId is the first player who has not locked the slot', () => {
  const live = initLiveState(['a', 'b']);
  assert.equal(turnUserId(live, ['a', 'b'], 'gk'), 'a');
  live.picksByUser.a = [namedPick('gk', 'p1')];
  assert.equal(turnUserId(live, ['a', 'b'], 'gk'), 'b');
});

test('usedPlayerIds are shared across the table', () => {
  const live = initLiveState(['a', 'b']);
  live.picksByUser.a = [namedPick('gk', 'reina')];
  assert.equal(usedPlayerIds(live).has('reina'), true);
  assert.equal(usedPlayerIds(live, 'b').has('reina'), true);
});

test('a successful pick passes the turn and resets the clock', () => {
  const now = Date.parse('2026-08-19T00:00:00.000Z');
  const live = initLiveState(['a', 'b'], now);
  const afterA: VsLiveState = {
    ...live,
    picksByUser: { ...live.picksByUser, a: [namedPick('gk', 'p1')] },
  };
  const next = afterSuccessfulPick(puzzle, afterA, ['a', 'b'], now + 1_000);
  assert.equal(next.slotIndex, 0);
  assert.equal(turnUserId(next, ['a', 'b'], 'gk'), 'b');
  assert.equal(Date.parse(next.deadlineAt), now + 1_000 + VS_SLOT_TIMEOUT_MS);
});

test('when everyone has locked a slot, the next position opens', () => {
  const now = Date.parse('2026-08-19T00:00:00.000Z');
  const live: VsLiveState = {
    ...initLiveState(['a', 'b'], now),
    picksByUser: {
      a: [namedPick('gk', 'p1')],
      b: [namedPick('gk', 'p2')],
    },
  };
  const next = afterSuccessfulPick(puzzle, live, ['a', 'b'], now + 500);
  assert.equal(next.slotIndex, 1);
  assert.equal(turnUserId(next, ['a', 'b'], 'st'), 'a');
});

test('timeout only skips the person whose turn it is', () => {
  const now = Date.parse('2026-08-19T00:00:00.000Z');
  const started = initLiveState(['a', 'b'], now);
  const later = advanceIfNeeded(puzzle, started, ['a', 'b'], now + VS_SLOT_TIMEOUT_MS + 1);
  assert.equal(later.slotIndex, 0);
  assert.equal(turnUserId(later, ['a', 'b'], 'gk'), 'b');
  assert.equal(later.picksByUser.a?.[0]?.playerId, '');
  assert.equal(later.picksByUser.b?.length, 0);
});
