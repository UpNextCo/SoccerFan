import assert from 'node:assert/strict';
import test from 'node:test';
import { computeLevel, xpRequiredForLevel } from './authService.js';

test('level curve uses long-term 1,500 XP quadratic progression', () => {
  assert.equal(computeLevel(0), 1);
  assert.equal(computeLevel(5_999), 1);
  assert.equal(computeLevel(6_000), 2);
  assert.equal(computeLevel(13_499), 2);
  assert.equal(computeLevel(13_500), 3);
  assert.equal(computeLevel(37_500), 5);
  assert.equal(computeLevel(96_000), 8);
  assert.equal(computeLevel(216_000), 12);
  assert.equal(computeLevel(486_000), 18);
});

test('level thresholds match the values returned to clients', () => {
  assert.equal(xpRequiredForLevel(1), 0);
  assert.equal(xpRequiredForLevel(2), 6_000);
  assert.equal(xpRequiredForLevel(3), 13_500);
  assert.equal(xpRequiredForLevel(8), 96_000);
  assert.equal(xpRequiredForLevel(18), 486_000);
});
