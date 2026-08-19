import assert from 'node:assert/strict';
import test from 'node:test';
import { DARTS501_START } from './darts501Scoring.js';
import { resolveDarts501ThrowLive } from './darts501Scoring.js';
import {
  applyThrow,
  applyTimeouts,
  dropUser,
  initDarts501,
  parseDarts501,
  usedPlayerIds,
  VS_DARTS501_TURN_MS,
  type VsDarts501ThrowRecord,
} from './vsLiveDarts501.js';

function throwRow(
  userId: string,
  playerId: string,
  kind: VsDarts501ThrowRecord['kind'],
  remainingAfter: number
): VsDarts501ThrowRecord {
  return {
    userId,
    playerId,
    playerName: playerId,
    headshotUrl: null,
    score: 60,
    kind,
    remainingAfter,
    thrownAt: new Date().toISOString(),
  };
}

test('parseDarts501 requires kind', () => {
  assert.equal(parseDarts501({ turnUserId: 'a', deadlineAt: 'x' }), null);
  assert.ok(parseDarts501(initDarts501(['a', 'b'])));
});

test('init starts everyone on 501 and first player on turn', () => {
  const live = initDarts501(['a', 'b']);
  assert.equal(live.turnUserId, 'a');
  assert.equal(live.players.a?.remaining, DARTS501_START);
  assert.equal(live.players.b?.remaining, DARTS501_START);
});

test('a score pass the turn and records the used player', () => {
  const now = Date.parse('2026-08-19T00:00:00.000Z');
  const live = initDarts501(['a', 'b'], now);
  const next = applyThrow(
    live,
    throwRow('a', 'kane', 'score', 441),
    { remaining: 441, inCheckout: false, checkoutBusts: 0 },
    now + 1_000
  );
  assert.equal(next.turnUserId, 'b');
  assert.equal(next.finished, false);
  assert.equal(usedPlayerIds(next).has('kane'), true);
  assert.equal(Date.parse(next.deadlineAt), now + 1_000 + VS_DARTS501_TURN_MS);
});

test('checkout finishes and names a winner', () => {
  const live = initDarts501(['a', 'b']);
  const next = applyThrow(
    live,
    throwRow('a', 'haaland', 'checkout', 0),
    { remaining: 0, inCheckout: true, checkoutBusts: 0 }
  );
  assert.equal(next.finished, true);
  assert.equal(next.winnerUserId, 'a');
});

test('timeout passes the turn without a bust', () => {
  const now = Date.parse('2026-08-19T00:00:00.000Z');
  const started = initDarts501(['a', 'b'], now);
  const later = applyTimeouts(started, now + VS_DARTS501_TURN_MS + 1);
  assert.equal(later.turnUserId, 'b');
  assert.equal(later.players.a?.checkoutBusts, 0);
  assert.equal(later.throws.length, 0);
});

test('dropUser removes them and continues', () => {
  const live = initDarts501(['a', 'b', 'c']);
  const next = dropUser(live, 'a');
  assert.deepEqual(next.order, ['b', 'c']);
  assert.equal(next.turnUserId, 'b');
  assert.equal(next.finished, false);
});

test('live resolver keeps lives but never ends on a third bust', () => {
  const third = resolveDarts501ThrowLive({
    remaining: 40,
    score: 200,
    inCheckout: true,
    checkoutBusts: 2,
  });
  assert.equal(third.kind, 'bust');
  assert.equal(third.checkoutBusts, 3);
  assert.equal(third.remaining, 40);
});
