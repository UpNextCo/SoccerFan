import assert from 'node:assert/strict';
import test from 'node:test';
import { isSyntheticTeamId } from '../constants/footballMedia.js';
import { pickHomeLeagueId } from './teamService.js';

test('pickHomeLeagueId prefers Premier League over cups for Fulham-style mixes', () => {
  const home = pickHomeLeagueId([
    { leagueId: 3, appearances: 2 },
    { leagueId: 39, appearances: 382 },
    { leagueId: 40, appearances: 79 },
    { leagueId: 45, appearances: 224 },
    { leagueId: 48, appearances: 218 },
  ]);
  assert.equal(home, 39);
});

test('pickHomeLeagueId prefers Championship over FA Cup', () => {
  const home = pickHomeLeagueId([
    { leagueId: 40, appearances: 40 },
    { leagueId: 45, appearances: 80 },
    { leagueId: 48, appearances: 20 },
  ]);
  assert.equal(home, 40);
});

test('pickHomeLeagueId falls back to a cup only when that is all we have', () => {
  const home = pickHomeLeagueId([
    { leagueId: 45, appearances: 12 },
    { leagueId: 2, appearances: 4 },
  ]);
  assert.equal(home, 45);
});

test('isSyntheticTeamId detects FBref hashed ids', () => {
  assert.equal(isSyntheticTeamId(36), false);
  assert.equal(isSyntheticTeamId(899_999_999), false);
  assert.equal(isSyntheticTeamId(900_000_000), true);
  assert.equal(isSyntheticTeamId(903_421_449), true);
});
