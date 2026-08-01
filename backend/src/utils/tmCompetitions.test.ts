import assert from 'node:assert/strict';
import test from 'node:test';
import { countsForClubCareer, isInternationalComp, isYouthOrReserveComp } from './tmCompetitions.js';

test('counts senior leagues, cups and continental football', () => {
  for (const comp of [
    'Premier League',
    'LaLiga',
    'Serie A',
    'Championship',
    'LaLiga2',
    'Serie B',
    'Ligue 2',
    '2. Bundesliga',
    'UEFA Champions League',
    'Champions League Qu.',
    'Europa League Qualifying',
    'UEFA Cup',
    'European Cup',
    'FA Cup',
    'EFL Cup',
    'EFL Trophy',
    'DFB-Pokal',
    'Coppa Italia',
    'Supercopa',
    'Community Shield',
    'Club World Cup',
    'Saudi Pro League',
    'AFC CL-Qualification',
  ]) {
    assert.equal(countsForClubCareer(comp), true, comp);
  }
});

test('drops academy and reserve competitions', () => {
  for (const comp of [
    'U19-Bundesliga West',
    'U17-BL N/NE',
    'U18 Premier League',
    'U21 PL Knockout',
    'Premier League Int. Cup U21',
    'Brasileiro U20 - Finals',
    'Play-Off U18 Eredivisie',
    'Premier League 2',
    'UEFA Youth League',
    'FA Youth Cup',
    'DFB-Pokal der Junioren',
    'Juniorska liga',
    'Prva HNL - Juniori',
    'ÖFB Jugendliga U18',
    'Reserve League South',
    'Süper Lig Reserves League',
    'Reserveligaen Spring',
    'Amateurmeisterschaft',
    'Revelação U23 - Championship',
  ]) {
    assert.equal(isYouthOrReserveComp(comp), true, comp);
    assert.equal(countsForClubCareer(comp), false, comp);
  }
});

test('an age marker only counts when it is a whole token', () => {
  // "Bundesliga" and "LaLiga2" must not trip the U-age or second-tier rules.
  assert.equal(isYouthOrReserveComp('Bundesliga'), false);
  assert.equal(isYouthOrReserveComp('LaLiga2'), false);
  assert.equal(isYouthOrReserveComp('Liga Portugal'), false);
});

test('guards against national-team rows leaking into a club total', () => {
  assert.equal(isInternationalComp('World Cup 2018'), true);
  assert.equal(isInternationalComp('European Championship'), true);
  assert.equal(isInternationalComp('Africa Cup of Nations'), true);
  assert.equal(isInternationalComp('UEFA Nations League'), true);
  assert.equal(countsForClubCareer('World Cup 2018'), false);
  assert.equal(isInternationalComp('Premier League'), false);
  // The club Champions League must survive the international guard.
  assert.equal(isInternationalComp('UEFA Champions League'), false);
});

test('blank competition names never count', () => {
  assert.equal(countsForClubCareer(''), false);
  assert.equal(countsForClubCareer('   '), false);
});
