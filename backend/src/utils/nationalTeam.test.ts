import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isDomesticClubLeague,
  isExcludedNationalSpell,
  isExcludedNationalStat,
  isInternationalCompetition,
  isNationalTeam,
  isYouthNationalOrOlympicSide,
  isYouthOrReserveSide,
} from './nationalTeam.js';

const NATIONS = new Set([
  'England',
  'Republic of Ireland',
  'Bosnia and Herzegovina',
  'Monaco',
  'Wales',
  'South Korea',
  'Nigeria',
  'Ghana',
  'Netherlands',
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

test('youth and Olympic country sides are never clubs', () => {
  assert.equal(isYouthNationalOrOlympicSide('Ghana U20', NATIONS), true);
  assert.equal(isYouthNationalOrOlympicSide('Netherlands U19', NATIONS), true);
  assert.equal(isYouthNationalOrOlympicSide('Nigeria Olympic', NATIONS), true);
  assert.equal(isYouthNationalOrOlympicSide('England', NATIONS), false);
  assert.equal(isYouthNationalOrOlympicSide('Chelsea U21', NATIONS), false);
});

test('Club Chain drops nationals but keeps Monaco and club youth sides', () => {
  const clubs = new Set([91, 49]); // Monaco, Chelsea
  assert.equal(isExcludedNationalSpell(10, 'England', NATIONS, clubs), true);
  assert.equal(isExcludedNationalSpell(11032, 'Ghana U20', NATIONS, new Set([11032])), true);
  assert.equal(isExcludedNationalSpell(91, 'Monaco', NATIONS, clubs), false);
  assert.equal(isExcludedNationalSpell(49, 'Chelsea U21', NATIONS, clubs), false);
});

test('World Cup / Euro ids are not domestic club leagues', () => {
  assert.equal(isDomesticClubLeague(1), false);
  assert.equal(isDomesticClubLeague(4), false);
  assert.equal(isDomesticClubLeague(39), true);
  assert.equal(isDomesticClubLeague(61), true);
  assert.equal(isDomesticClubLeague(null), false);
});

test('international tournaments and national sides are not club stats', () => {
  const clubs = new Set([55, 91]);
  assert.equal(isInternationalCompetition(9), true);
  assert.equal(isInternationalCompetition(2), false);
  assert.equal(isExcludedNationalStat(9, 2385, 'Jamaica', new Set(['Jamaica']), clubs), true);
  assert.equal(isExcludedNationalStat(1, 10, 'England', NATIONS, clubs), true);
  assert.equal(isExcludedNationalStat(39, 55, 'Brentford', NATIONS, clubs), false);
  assert.equal(isExcludedNationalStat(45, 55, 'Brentford', NATIONS, clubs), false);
  assert.equal(isExcludedNationalStat(2, 55, 'Brentford', NATIONS, clubs), false);
  assert.equal(isExcludedNationalStat(61, 91, 'Monaco', NATIONS, clubs), false);
});

test('club reserve and youth sides are still recognised as youth setups', () => {
  assert.equal(isYouthOrReserveSide('Southampton U21'), true);
  assert.equal(isYouthOrReserveSide('Real Madrid Castilla'), true);
  assert.equal(isYouthOrReserveSide('Juventus Next Gen'), true);
  assert.equal(isYouthOrReserveSide('Liverpool'), false);
});
