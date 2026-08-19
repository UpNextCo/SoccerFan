import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyHotseatTimeouts,
  eliminatePlayer,
  initHotseat,
  namedPlayerIds,
  passTurn,
  VS_HOTSEAT_TURN_MS,
} from './vsLiveHotseat.js';

test('initHotseat starts on the first player with a 30s clock', () => {
  const now = Date.parse('2026-08-19T00:00:00.000Z');
  const state = initHotseat(['a', 'b', 'c'], now);
  assert.equal(state.kind, 'back_yourself');
  assert.equal(state.turnUserId, 'a');
  assert.equal(state.finished, false);
  assert.equal(state.winnerUserId, null);
  assert.deepEqual(state.remaining, ['a', 'b', 'c']);
  assert.equal(Date.parse(state.deadlineAt), now + VS_HOTSEAT_TURN_MS);
});

test('passTurn moves to the next remaining player and resets the clock', () => {
  const now = Date.parse('2026-08-19T00:00:00.000Z');
  const named = passTurn(initHotseat(['a', 'b', 'c'], now), 'a', now + 1_000);
  assert.equal(named.turnUserId, 'b');
  assert.equal(Date.parse(named.deadlineAt), now + 1_000 + VS_HOTSEAT_TURN_MS);
  assert.equal(named.finished, false);
});

test('eliminatePlayer with two players ends the game', () => {
  const now = Date.parse('2026-08-19T00:00:00.000Z');
  const afterA = eliminatePlayer(initHotseat(['a', 'b'], now), 'a', now);
  assert.equal(afterA.finished, true);
  assert.equal(afterA.winnerUserId, 'b');
  assert.deepEqual(afterA.remaining, ['b']);
  assert.deepEqual(afterA.eliminated, ['a']);
});

test('eliminatePlayer skips the next remaining player and last one wins', () => {
  const now = Date.parse('2026-08-19T00:00:00.000Z');
  const afterA = eliminatePlayer(initHotseat(['a', 'b', 'c'], now), 'a', now);
  assert.deepEqual(afterA.remaining, ['b', 'c']);
  assert.equal(afterA.turnUserId, 'b');
  assert.equal(afterA.finished, false);

  const afterB = eliminatePlayer(afterA, 'b', now + 500);
  assert.equal(afterB.finished, true);
  assert.equal(afterB.winnerUserId, 'c');
  assert.deepEqual(afterB.remaining, ['c']);
});

test('applyHotseatTimeouts chains AFK eliminations', () => {
  const now = Date.parse('2026-08-19T00:00:00.000Z');
  const started = initHotseat(['a', 'b', 'c'], now);
  const later = applyHotseatTimeouts(started, now + VS_HOTSEAT_TURN_MS + 1);
  assert.equal(later.finished, false);
  assert.deepEqual(later.remaining, ['b', 'c']);
  assert.equal(later.turnUserId, 'b');

  const muchLater = applyHotseatTimeouts(started, now + VS_HOTSEAT_TURN_MS * 3);
  assert.equal(muchLater.finished, true);
  assert.equal(muchLater.winnerUserId, 'c');
});

test('namedPlayerIds tracks shared names', () => {
  const state = {
    ...initHotseat(['a', 'b']),
    named: [
      {
        userId: 'a',
        playerId: 'p1',
        playerName: 'Player',
        headshotUrl: null,
        namedAt: new Date().toISOString(),
      },
    ],
  };
  assert.equal(namedPlayerIds(state).has('p1'), true);
  assert.equal(namedPlayerIds(state).has('p2'), false);
});
