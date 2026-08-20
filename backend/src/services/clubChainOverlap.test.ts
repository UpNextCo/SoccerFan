import assert from 'node:assert/strict';
import test from 'node:test';
import {
  datesOverlap,
  refineCareerSpells,
  spellsOverlap,
  type DatedClubSpell,
  type TransferMove,
} from './clubChainOverlap.js';

function spell(clubId: number, from: number, to: number, name = 'Coventry'): DatedClubSpell {
  return { clubId, clubName: name, startYear: from, endYear: to };
}

test('year-only spells still overlap when they share a season-start year', () => {
  const joe = refineCareerSpells([spell(49, 2003, 2009, 'Chelsea')], []);
  const lampard = refineCareerSpells([spell(49, 2001, 2014, 'Chelsea')], []);
  assert.equal(spellsOverlap(joe[0]!, lampard[0]!), true);
});

test('adjacent seasons do not overlap once encoded as Aug–Jun dates', () => {
  const left = refineCareerSpells([spell(1346, 2015, 2015)], []);
  const arrived = refineCareerSpells([spell(1346, 2016, 2016)], []);
  assert.equal(spellsOverlap(left[0]!, arrived[0]!), false);
});

test('Joe Cole / Yakubu at Coventry: calendar leave year is not a shared season', () => {
  // Stored 2015–2016 (leave May 2016) vs Yakubu's 2016/17 spell. They never played together.
  const joeMoves: TransferMove[] = [
    { date: '2015-10-19', fromTeamId: 66, toTeamId: 1346 },
    { date: '2016-01-07', fromTeamId: 66, toTeamId: 1346 },
    { date: '2016-05-11', fromTeamId: 1346, toTeamId: 4021 },
  ];
  const joe = refineCareerSpells([spell(1346, 2015, 2016)], joeMoves);
  const yakubu = refineCareerSpells([spell(1346, 2016, 2016)], []);
  assert.equal(joe.length, 1);
  assert.equal(joe[0]!.startDate, '2015-10-19');
  assert.equal(joe[0]!.endDate, '2016-05-11');
  assert.equal(joe[0]!.endYear, 2015);
  assert.equal(spellsOverlap(joe[0]!, yakubu[0]!), false);
});

test('a real mid-season overlap still counts', () => {
  const a = refineCareerSpells([spell(40, 2010, 2012, 'Liverpool')], [
    { date: '2010-07-20', fromTeamId: 49, toTeamId: 40 },
    { date: '2013-01-04', fromTeamId: 40, toTeamId: 48 },
  ]);
  const b = refineCareerSpells([spell(40, 2011, 2015, 'Liverpool')], [
    { date: '2011-08-01', fromTeamId: 1, toTeamId: 40 },
    { date: '2015-07-01', fromTeamId: 40, toTeamId: 2 },
  ]);
  assert.equal(spellsOverlap(a[0]!, b[0]!), true);
});

test('merged two-stint career does not invent teammates for the gap years', () => {
  const cristiano = refineCareerSpells([spell(33, 2003, 2021, 'Manchester United')], [
    { date: '2003-08-12', fromTeamId: 211, toTeamId: 33 },
    { date: '2009-07-01', fromTeamId: 33, toTeamId: 541 },
    { date: '2021-08-27', fromTeamId: 211, toTeamId: 33 },
    { date: '2022-11-22', fromTeamId: 33, toTeamId: 85 },
  ]);
  assert.equal(cristiano.length, 2);
  const mid = refineCareerSpells([spell(33, 2014, 2016, 'Manchester United')], [
    { date: '2014-07-01', fromTeamId: 50, toTeamId: 33 },
    { date: '2016-07-01', fromTeamId: 33, toTeamId: 50 },
  ]);
  assert.equal(spellsOverlap(cristiano[0]!, mid[0]!), false);
  assert.equal(spellsOverlap(cristiano[1]!, mid[0]!), false);
});

test('same-day leave and arrival do not count as teammates', () => {
  assert.equal(
    datesOverlap({ start: '2016-07-01', end: '2016-07-01' }, { start: '2016-07-01', end: '2018-06-30' }),
    false
  );
  assert.equal(
    datesOverlap({ start: '2010-08-01', end: '2016-07-01' }, { start: '2016-07-01', end: '2020-06-30' }),
    false
  );
});
