import assert from 'node:assert/strict';
import test from 'node:test';
import { isNationalTeam, isYouthOrReserveSide } from './nationalTeam.js';

const NATIONS = new Set([
  'England',
  'Republic of Ireland',
  'Bosnia and Herzegovina',
  'Monaco',
  'Wales',
  'South Korea',
  'Nigeria',
]);

test('matches a country named exactly', () => {
  assert.equal(isNationalTeam('England', NATIONS), true);
  assert.equal(isNationalTeam('Republic of Ireland', NATIONS), true);
});

test('matches national youth and Olympic sides', () => {
  assert.equal(isNationalTeam('England U19', NATIONS), true);
  assert.equal(isNationalTeam('England U17 W', NATIONS), true);
  assert.equal(isNationalTeam('Nigeria Olympic', NATIONS), true);
});

test('matches abbreviated and punctuated spellings of the same country', () => {
  // These reached Club Chain as "clubs", letting two international teammates link.
  assert.equal(isNationalTeam('Rep. Of Ireland', NATIONS), true);
  assert.equal(isNationalTeam('Bosnia & Herzegovina', NATIONS), true);
  assert.equal(isNationalTeam('Bosnia-Herzegovina', NATIONS), true);
  assert.equal(isNationalTeam('Bosnia-Herzegovina U21', NATIONS), true);
});

test('does not match ordinary club sides', () => {
  for (const club of ['Liverpool', 'Real Madrid Castilla', 'Southampton', 'Sacramento Republic', 'New England Revolution']) {
    assert.equal(isNationalTeam(club, NATIONS), false, club);
  }
});

test('club reserve and youth sides are still recognised as youth setups', () => {
  assert.equal(isYouthOrReserveSide('Southampton U21'), true);
  assert.equal(isYouthOrReserveSide('Real Madrid Castilla'), true);
  assert.equal(isYouthOrReserveSide('Juventus Next Gen'), true);
  assert.equal(isYouthOrReserveSide('Liverpool'), false);
});
