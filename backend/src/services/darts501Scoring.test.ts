import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bustReasonForScore,
  darts501Xp,
  isSuccessfulCheckout,
  isValidDartsScore,
  resolveDarts501Throw,
} from './darts501Scoring.js';

test('valid darts scores include 0, 180 and reject impossible totals', () => {
  assert.equal(isValidDartsScore(0), true);
  assert.equal(isValidDartsScore(180), true);
  assert.equal(isValidDartsScore(142), true);
  for (const score of [163, 166, 169, 172, 173, 175, 176, 178, 179]) {
    assert.equal(isValidDartsScore(score), false);
    assert.equal(bustReasonForScore(score), 'impossible');
  }
  assert.equal(isValidDartsScore(181), false);
  assert.equal(bustReasonForScore(181), 'over_180');
});

test('checkout window is 0 through -10', () => {
  assert.equal(isSuccessfulCheckout(0), true);
  assert.equal(isSuccessfulCheckout(-5), true);
  assert.equal(isSuccessfulCheckout(-10), true);
  assert.equal(isSuccessfulCheckout(1), false);
  assert.equal(isSuccessfulCheckout(-11), false);
});

test('normal throw deducts a valid score', () => {
  const result = resolveDarts501Throw({
    remaining: 501,
    score: 142,
    inCheckout: false,
    checkoutBusts: 0,
  });
  assert.equal(result.kind, 'score');
  assert.equal(result.remaining, 359);
  assert.equal(result.inCheckout, false);
});

test('impossible score busts without changing remaining', () => {
  const result = resolveDarts501Throw({
    remaining: 327,
    score: 169,
    inCheckout: false,
    checkoutBusts: 0,
  });
  assert.equal(result.kind, 'bust');
  assert.equal(result.remaining, 327);
  assert.equal(result.bustReason, 'impossible');
  assert.equal(result.checkoutBusts, 0);
});

test('entering checkout at 180 remaining', () => {
  const result = resolveDarts501Throw({
    remaining: 200,
    score: 20,
    inCheckout: false,
    checkoutBusts: 0,
  });
  assert.equal(result.kind, 'score');
  assert.equal(result.remaining, 180);
  assert.equal(result.inCheckout, true);
});

test('perfect checkout lands on 0', () => {
  const result = resolveDarts501Throw({
    remaining: 84,
    score: 84,
    inCheckout: true,
    checkoutBusts: 0,
  });
  assert.equal(result.kind, 'perfect');
  assert.equal(result.remaining, 0);
});

test('checkout within the -10 window still finishes', () => {
  const five = resolveDarts501Throw({
    remaining: 84,
    score: 89,
    inCheckout: true,
    checkoutBusts: 0,
  });
  assert.equal(five.kind, 'checkout');
  assert.equal(five.remaining, -5);

  const ten = resolveDarts501Throw({
    remaining: 84,
    score: 94,
    inCheckout: true,
    checkoutBusts: 0,
  });
  assert.equal(ten.kind, 'checkout');
  assert.equal(ten.remaining, -10);
});

test('checkout overshoot busts and keeps remaining', () => {
  const result = resolveDarts501Throw({
    remaining: 84,
    score: 95,
    inCheckout: true,
    checkoutBusts: 0,
  });
  assert.equal(result.kind, 'bust');
  assert.equal(result.remaining, 84);
  assert.equal(result.checkoutBusts, 1);
  assert.equal(result.bustReason, 'checkout_overshoot');
});

test('third checkout bust is game over', () => {
  const result = resolveDarts501Throw({
    remaining: 84,
    score: 97,
    inCheckout: true,
    checkoutBusts: 2,
  });
  assert.equal(result.kind, 'game_over');
  assert.equal(result.remaining, 84);
  assert.equal(result.checkoutBusts, 3);
});

test('zero score is legal and changes nothing', () => {
  const result = resolveDarts501Throw({
    remaining: 501,
    score: 0,
    inCheckout: false,
    checkoutBusts: 0,
  });
  assert.equal(result.kind, 'score');
  assert.equal(result.remaining, 501);
});

test('XP: loss is 0, perfect checkout is the ceiling, regular checkout is lower', () => {
  assert.equal(darts501Xp({ won: false, perfect: false, throws: 6, busts: 1 }), 0);
  assert.equal(darts501Xp({ won: true, perfect: true, throws: 4, busts: 0 }), 1000);
  const regular = darts501Xp({ won: true, perfect: false, throws: 5, busts: 1 });
  assert.equal(regular, 750);
  assert.ok(regular < 1000);
  assert.ok(darts501Xp({ won: true, perfect: false, throws: 20, busts: 8 }) >= 280);
});
