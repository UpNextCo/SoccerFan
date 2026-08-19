import assert from 'node:assert/strict';
import test from 'node:test';
import {
  afterSuccessfulPick,
  advanceIfNeeded,
  initTargetMan,
  parseTargetMan,
  turnUserId,
  usedPlayerIds,
  VS_TARGET_MAN_TURN_MS,
  type VsTargetManPick,
  type VsTargetManState,
} from './vsLiveTargetMan.js';

function namedPick(slotIndex: number, playerId: string): VsTargetManPick {
  return {
    slotIndex,
    playerId,
    playerName: playerId,
    headshotUrl: null,
    statValue: 12,
    lockedAt: new Date().toISOString(),
  };
}

test('parseTargetMan requires kind', () => {
  assert.equal(parseTargetMan({ slotIndex: 0, deadlineAt: 'x' }), null);
  assert.ok(parseTargetMan(initTargetMan(['a'])));
});

test('turnUserId is the first player who has not locked the row', () => {
  const live = initTargetMan(['a', 'b']);
  assert.equal(turnUserId(live, ['a', 'b'], 0), 'a');
  live.picksByUser.a = [namedPick(0, 'p1')];
  assert.equal(turnUserId(live, ['a', 'b'], 0), 'b');
});

test('usedPlayerIds are shared across the table', () => {
  const live = initTargetMan(['a', 'b']);
  live.picksByUser.a = [namedPick(0, 'haaland')];
  assert.equal(usedPlayerIds(live).has('haaland'), true);
});

test('a successful pick passes the turn and resets the clock', () => {
  const now = Date.parse('2026-08-19T00:00:00.000Z');
  const live = initTargetMan(['a', 'b'], now);
  const afterA: VsTargetManState = {
    ...live,
    picksByUser: { ...live.picksByUser, a: [namedPick(0, 'p1')] },
  };
  const next = afterSuccessfulPick(afterA, ['a', 'b'], now + 1_000);
  assert.equal(next.slotIndex, 0);
  assert.equal(turnUserId(next, ['a', 'b'], 0), 'b');
  assert.equal(Date.parse(next.deadlineAt), now + 1_000 + VS_TARGET_MAN_TURN_MS);
});

test('when everyone has locked a row, the next row opens', () => {
  const now = Date.parse('2026-08-19T00:00:00.000Z');
  const live: VsTargetManState = {
    ...initTargetMan(['a', 'b'], now),
    picksByUser: {
      a: [namedPick(0, 'p1')],
      b: [namedPick(0, 'p2')],
    },
  };
  const next = afterSuccessfulPick(live, ['a', 'b'], now + 500);
  assert.equal(next.slotIndex, 1);
  assert.equal(turnUserId(next, ['a', 'b'], 1), 'a');
});

test('timeout only skips the person whose turn it is', () => {
  const now = Date.parse('2026-08-19T00:00:00.000Z');
  const started = initTargetMan(['a', 'b'], now);
  const later = advanceIfNeeded(started, ['a', 'b'], now + VS_TARGET_MAN_TURN_MS + 1);
  assert.equal(later.slotIndex, 0);
  assert.equal(turnUserId(later, ['a', 'b'], 0), 'b');
  assert.equal(later.picksByUser.a?.[0]?.playerId, '');
});
