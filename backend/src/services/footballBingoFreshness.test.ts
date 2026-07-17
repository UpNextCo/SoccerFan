import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BINGO_TYPE_CAPS,
  bingoCategoryClubKeys,
  selectBingoCategories,
  selectBingoPlayers,
  type BingoCandidates,
  type BingoCategory,
  type BingoPlayer,
  type CatType,
} from './footballBingoGenerator.js';
import type { BingoResourceUsage, BingoTileUsage } from './puzzleHistory.js';

const types: CatType[] = [
  'nationality',
  'playedForClub',
  'nationClub',
  'clubCombo',
  'wonCompetition',
  'award',
  'statThreshold',
];

function category(type: CatType, suffix: string): BingoCategory {
  return {
    id: `${type}-${suffix}`,
    title: `${type} ${suffix}`,
    type,
    iconType: type === 'award' ? 'award' : 'custom',
    iconValue: suffix,
    matchingRule: suffix,
  };
}

function candidates(count = 8): BingoCandidates {
  return Object.fromEntries(
    types.map((type) => [type, Array.from({ length: count }, (_, i) => category(type, String(i)))])
  ) as BingoCandidates;
}

function used(frequency: number, daysSinceLastUse = 20): BingoTileUsage {
  return {
    frequency,
    lastUsedDate: '2026-06-01',
    daysSinceLastUse,
    usedDates: Array.from({ length: frequency }, (_, i) => `2026-05-${String(i + 1).padStart(2, '0')}`),
  };
}

test('Bingo tie-breaking is seeded and deterministic', () => {
  const pool = candidates();
  const first = selectBingoCategories(pool, new Map(), 1234).map((c) => c.id);
  const second = selectBingoCategories(pool, new Map(), 1234).map((c) => c.id);
  const anotherSeed = selectBingoCategories(pool, new Map(), 5678).map((c) => c.id);
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, anotherSeed);
});

test('Bingo selection penalizes frequency before seeded ties', () => {
  const pool = candidates();
  const usage = new Map<string, BingoTileUsage>([['nationality-0', used(8)]]);
  const selected = selectBingoCategories(pool, usage, 42);
  assert.equal(selected.some((c) => c.id === 'nationality-0'), false);
});

test('a recent award leaves its preferred slot open for another fresh type', () => {
  const pool = candidates();
  const usage = new Map<string, BingoTileUsage>(
    pool.award.map((c) => [c.id, used(1, 2)])
  );
  const selected = selectBingoCategories(pool, usage, 42);
  assert.equal(selected.length, 16);
  assert.equal(selected.some((c) => c.type === 'award'), false);
  assert.equal(selected.some((c) => usage.has(c.id)), false);
});

test('normal top-up respects per-type concentration caps', () => {
  const selected = selectBingoCategories(candidates(), new Map(), 42);
  const counts = new Map<CatType, number>();
  for (const tile of selected) counts.set(tile.type, (counts.get(tile.type) ?? 0) + 1);
  for (const type of types) {
    assert.ok((counts.get(type) ?? 0) <= BINGO_TYPE_CAPS[type], `${type} exceeded its cap`);
  }
});

test('balanced recent tiles are preferred over fresh tiles that exceed a type cap', () => {
  const pool = candidates(20);
  const usage = new Map<string, BingoTileUsage>();
  for (const type of types) {
    if (type === 'clubCombo') continue;
    for (const tile of pool[type]) usage.set(tile.id, used(1, 2));
  }
  const selected = selectBingoCategories(pool, usage, 42);
  const counts = new Map<CatType, number>();
  for (const tile of selected) counts.set(tile.type, (counts.get(tile.type) ?? 0) + 1);
  assert.equal(selected.length, 16);
  for (const type of types) {
    assert.ok((counts.get(type) ?? 0) <= BINGO_TYPE_CAPS[type], `${type} exceeded its cap`);
  }
});

test('selection completes a 16-tile board from a pathological thin mix', () => {
  const pool: BingoCandidates = {
    nationality: Array.from({ length: 16 }, (_, i) => category('nationality', String(i))),
    playedForClub: [],
    nationClub: [],
    clubCombo: [],
    wonCompetition: [],
    award: [],
    statThreshold: [],
  };
  const selected = selectBingoCategories(pool, new Map(), 42);
  assert.equal(selected.length, 16);
  assert.equal(new Set(selected.map((c) => c.id)).size, 16);
});

test('underlying clubs are capped across every tile type', () => {
  const pool = candidates(20);
  const clubs = Array.from({ length: 12 }, (_, index) => `Club ${index}`);
  pool.playedForClub.forEach((tile, index) => {
    tile.matchingRule = clubs[index % clubs.length]!;
  });
  pool.nationClub.forEach((tile, index) => {
    tile.matchingRule = `Nation ${index}|${clubs[index % clubs.length]}`;
  });
  pool.clubCombo.forEach((tile, index) => {
    tile.matchingRule = `${clubs[index % clubs.length]}|${clubs[(index + 1) % clubs.length]}`;
  });
  const selected = selectBingoCategories(pool, new Map(), 42);
  const clubCounts = new Map<string, number>();
  for (const tile of selected) {
    for (const club of bingoCategoryClubKeys(tile)) {
      clubCounts.set(club, (clubCounts.get(club) ?? 0) + 1);
    }
  }
  assert.equal(selected.length, 16);
  assert.ok([...clubCounts.values()].every((count) => count <= 2));
});

test('shared club history penalizes differently-worded tiles for the same club', () => {
  const pool: BingoCandidates = {
    nationality: [],
    playedForClub: [
      {
        ...category('playedForClub', 'inter'),
        matchingRule: 'Inter',
      },
      {
        ...category('playedForClub', 'arsenal'),
        matchingRule: 'Arsenal',
      },
    ],
    nationClub: [],
    clubCombo: [],
    wonCompetition: [],
    award: [],
    statThreshold: [],
  };
  const clubUsage = new Map<string, BingoResourceUsage>([['inter', used(12, 1)]]);
  const selected = selectBingoCategories(pool, new Map(), 42, 1, clubUsage);
  assert.equal(selected[0]?.matchingRule, 'Arsenal');
});

function bingoPlayer(index: number): BingoPlayer {
  return {
    id: `player-${index}`,
    name: `Player ${index}`,
    nationality: 'England',
    position: 'Midfielder',
    clubs: [],
    leagues: [],
    trophies: [],
    teammates: [],
    managers: [],
    awards: [],
    stats: { top_apps: 200 + index, intl_caps: 20 },
    topLeagueApps: 200 + index,
    topLeagueGoals: index % 30,
    premierLeagueApps: 200 + index,
    headshotUrl: null,
  };
}

test('player queues cap previous-day overlap and remain unique', () => {
  const players = Array.from({ length: 120 }, (_, index) => bingoPlayer(index));
  const usage = new Map<string, BingoResourceUsage>();
  players.slice(0, 30).forEach((player) => usage.set(player.id, used(1, 1)));
  const nationality = category('nationality', 'england');
  nationality.matchingRule = 'England';
  const selected = selectBingoPlayers([nationality], players, usage, 42);
  const previousDayPlayers = selected.filter(
    (player) => usage.get(player.id)?.daysSinceLastUse === 1
  );
  assert.equal(selected.length, 55);
  assert.equal(new Set(selected.map((player) => player.id)).size, 55);
  assert.ok(previousDayPlayers.length <= 9);
});

test('frequently shipped players lose ties to equally recognizable fresh players', () => {
  const players = Array.from({ length: 80 }, (_, index) => bingoPlayer(index));
  const usage = new Map<string, BingoResourceUsage>([
    [players[79]!.id, used(12, 8)],
  ]);
  const nationality = category('nationality', 'england');
  nationality.matchingRule = 'England';
  const selected = selectBingoPlayers([nationality], players, usage, 42, 20);
  assert.equal(selected.some((player) => player.id === players[79]!.id), false);
});
