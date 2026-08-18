import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ALL_STATS_COMPETITIONS,
  EFL_LEAGUES,
  ENGLISH_CUPS,
  INGEST_LEAGUES,
  LEAGUE_ID_BY_NAME,
  isEflLeagueId,
  resolveIngestLeagues,
  resolveStatsCompetitions,
} from './ingest-config.js';

function withLeagueIds<T>(ids: string | undefined, fn: () => T): T {
  const prev = process.env.INGEST_LEAGUE_IDS;
  try {
    if (ids === undefined) delete process.env.INGEST_LEAGUE_IDS;
    else process.env.INGEST_LEAGUE_IDS = ids;
    return fn();
  } finally {
    if (prev === undefined) delete process.env.INGEST_LEAGUE_IDS;
    else process.env.INGEST_LEAGUE_IDS = prev;
  }
}

test('default squad ingest stays big-5', () => {
  const leagues = withLeagueIds(undefined, resolveIngestLeagues);
  assert.deepEqual(
    leagues.map((l) => l.id),
    INGEST_LEAGUES.map((l) => l.id)
  );
});

test('INGEST_LEAGUE_IDS can target EFL squads without cups', () => {
  const leagues = withLeagueIds('40,41,42', resolveIngestLeagues);
  assert.deepEqual(
    leagues.map((l) => l.id).sort((a, b) => a - b),
    [40, 41, 42]
  );
});

test('squad ingest rejects cup-only INGEST_LEAGUE_IDS', () => {
  assert.throws(() => withLeagueIds('45,48', resolveIngestLeagues), /matched no leagues/);
});

test('stats ingest can target EFL plus English cups', () => {
  const comps = withLeagueIds('40,41,42,45,48', resolveStatsCompetitions);
  assert.deepEqual(
    comps.map((c) => c.id).sort((a, b) => a - b),
    [40, 41, 42, 45, 48]
  );
});

test('default stats ingest stays big-5', () => {
  const comps = withLeagueIds(undefined, resolveStatsCompetitions);
  assert.deepEqual(
    comps.map((c) => c.id),
    INGEST_LEAGUES.map((l) => l.id)
  );
});

test('isEflLeagueId covers only the three EFL divisions', () => {
  for (const league of EFL_LEAGUES) assert.equal(isEflLeagueId(league.id), true);
  assert.equal(isEflLeagueId(39), false);
  assert.equal(isEflLeagueId(45), false);
});

test('LEAGUE_ID_BY_NAME resolves EFL and English cup aliases', () => {
  assert.equal(LEAGUE_ID_BY_NAME.Championship, 40);
  assert.equal(LEAGUE_ID_BY_NAME['League One'], 41);
  assert.equal(LEAGUE_ID_BY_NAME['League Two'], 42);
  assert.equal(LEAGUE_ID_BY_NAME['FA Cup'], 45);
  assert.equal(LEAGUE_ID_BY_NAME['Carabao Cup'], 48);
  assert.equal(LEAGUE_ID_BY_NAME['Premier League'], 39);
});

test('ALL_STATS_COMPETITIONS includes English cups', () => {
  const ids = new Set(ALL_STATS_COMPETITIONS.map((c) => c.id));
  for (const cup of ENGLISH_CUPS) assert.ok(ids.has(cup.id));
});
