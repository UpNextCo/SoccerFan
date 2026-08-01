import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  attributeRow,
  buildSpells,
  isSeniorClub,
  seasonOf,
  type AttributionEvidence,
  type Spell,
} from './statsClubAttribution.js';

const key = (c: string) => c.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Evidence stub: `leagues` maps "leagueId:season" to the clubs known to be there. */
function evidence(opts: {
  leagues?: Record<string, string[]>;
  playedFor?: Record<number, string[]>;
} = {}): AttributionEvidence {
  return {
    clubsInLeagueSeason: (leagueId, season) =>
      new Set((opts.leagues?.[`${leagueId}:${season}`] ?? []).map(key)),
    clubsPlayedForBySeason: (season) => new Set((opts.playedFor?.[season] ?? []).map(key)),
    isDomestic: (leagueId) => leagueId !== 2 && leagueId !== 3,
    key,
  };
}

test('a season starts in July, so a winter move belongs to the season already under way', () => {
  assert.equal(seasonOf('2013-02-21'), 2012); // Kane joins Leicester mid-2012/13
  assert.equal(seasonOf('2013-05-14'), 2012); // and returns before it ends
  assert.equal(seasonOf('2023-08-12'), 2023); // a pre-season move opens the new season
  assert.equal(seasonOf('2012-06-30'), 2011); // June still belongs to the old season
});

test("Kane's Championship rows resolve to the loan clubs, not to Tottenham", () => {
  // His real Transfermarkt history. Both loans are here; player_career has neither.
  const spells = buildSpells(
    [
      { date: '2011-01-07', toClub: 'Leyton Orient' },
      { date: '2011-05-31', toClub: 'Tottenham' },
      { date: '2012-01-01', toClub: 'Millwall' },
      { date: '2012-05-31', toClub: 'Tottenham' },
      { date: '2012-08-31', toClub: 'Norwich' },
      { date: '2013-02-01', toClub: 'Tottenham' },
      { date: '2013-02-21', toClub: 'Leicester' },
      { date: '2013-05-14', toClub: 'Tottenham' },
      { date: '2023-08-12', toClub: 'Bayern München' },
    ],
    2025
  );

  // We hold Premier League rows naming Tottenham and Norwich in 2012, and none for the Championship.
  const ev = evidence({
    leagues: { '39:2011': ['Tottenham'], '39:2012': ['Tottenham', 'Norwich'] },
    playedFor: { 2011: ['Tottenham'], 2012: ['Tottenham', 'Norwich'] },
  });

  assert.deepEqual(attributeRow({ leagueId: 40, season: 2012 }, spells, ev), {
    kind: 'resolved',
    club: 'Leicester',
  });
  assert.deepEqual(attributeRow({ leagueId: 40, season: 2011 }, spells, ev), {
    kind: 'resolved',
    club: 'Millwall',
  });
});

test('a single overlapping club needs no evidence at all', () => {
  const spells: Spell[] = [{ club: 'Al-Nassr', fromSeason: 2022, toSeason: 2025 }];
  assert.deepEqual(attributeRow({ leagueId: 307, season: 2023 }, spells, evidence()), {
    kind: 'resolved',
    club: 'Al-Nassr',
  });
});

test('a club seen in this league and season wins outright', () => {
  const spells: Spell[] = [
    { club: 'Sporting CP', fromSeason: 2002, toSeason: 2003 },
    { club: 'Manchester United', fromSeason: 2003, toSeason: 2009 },
  ];
  const ev = evidence({ leagues: { '94:2003': ['Sporting CP'] } });
  assert.deepEqual(attributeRow({ leagueId: 94, season: 2003 }, spells, ev), {
    kind: 'resolved',
    club: 'Sporting CP',
  });
});

test('two plausible clubs with nothing to separate them are left alone', () => {
  const spells: Spell[] = [
    { club: 'Watford', fromSeason: 2012, toSeason: 2013 },
    { club: 'Bolton', fromSeason: 2012, toSeason: 2013 },
  ];
  const result = attributeRow({ leagueId: 40, season: 2012 }, spells, evidence());
  assert.equal(result.kind, 'ambiguous');
});

test('European rows are not narrowed by the domestic-league rule', () => {
  // A club plays its league and the Champions League in the same season, so "seen elsewhere" proves
  // nothing here. Two candidates must stay ambiguous rather than pick the wrong one.
  const spells: Spell[] = [
    { club: 'Chelsea', fromSeason: 2011, toSeason: 2012 },
    { club: 'Benfica', fromSeason: 2011, toSeason: 2012 },
  ];
  const ev = evidence({ leagues: { '39:2011': ['Chelsea'], '94:2011': ['Benfica'] } });
  assert.equal(attributeRow({ leagueId: 2, season: 2011 }, spells, ev).kind, 'ambiguous');
});

test('a European row goes to the club the player turned out for that season', () => {
  // Ajax and Atlético Nacional both overlap 2016 for Davinson Sánchez. His named league row says Ajax,
  // and the club that plays the European tie is the one he was actually at.
  const spells: Spell[] = [
    { club: 'Atl. Nacional', fromSeason: 2014, toSeason: 2016 },
    { club: 'Ajax', fromSeason: 2016, toSeason: 2017 },
  ];
  const ev = evidence({ playedFor: { 2016: ['Ajax'] } });
  assert.deepEqual(attributeRow({ leagueId: 2, season: 2016 }, spells, ev), {
    kind: 'resolved',
    club: 'Ajax',
  });
});

test('a club already named in another competition still owns its league row', () => {
  // The same club appears twice in one season (league + Europe). Having a Champions League row for
  // Ajax must not rule Ajax out of the Eredivisie row — that mistake credited the season to the club
  // he had just left.
  const spells: Spell[] = [
    { club: 'Atl. Nacional', fromSeason: 2014, toSeason: 2016 },
    { club: 'Ajax', fromSeason: 2016, toSeason: 2017 },
  ];
  const ev = evidence({ playedFor: { 2016: ['Ajax'] }, leagues: { '88:2016': ['Ajax'] } });
  assert.deepEqual(attributeRow({ leagueId: 88, season: 2016 }, spells, ev), {
    kind: 'resolved',
    club: 'Ajax',
  });
});

test('reserve sides and contract placeholders are never candidates', () => {
  for (const name of ['Without Club', 'Retired', 'Unknown', 'Spurs U18', 'Wolfsburg II', 'Tottenham Yth.']) {
    assert.equal(isSeniorClub(name), false, name);
  }
  for (const name of ['Leicester', 'Millwall', 'Bayern München', 'Al-Nassr', 'Brighton']) {
    assert.equal(isSeniorClub(name), true, name);
  }
});

test('spells skip non-clubs but still bound the spell before them', () => {
  // Retiring ends the last club's spell; it must not become a candidate itself.
  const spells = buildSpells(
    [
      { date: '2018-07-01', toClub: 'Brighton' },
      { date: '2021-06-30', toClub: 'Retired' },
    ],
    2025
  );
  assert.deepEqual(spells, [{ club: 'Brighton', fromSeason: 2018, toSeason: 2020 }]);
});
