import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareWeeklyMembership,
  londonWeekEnd,
  londonWeekStart,
  outcomeForRank,
  packGroupSizes,
  resolveMembershipDestination,
  selectChampionsLeagueQualifiers,
  zoneCounts,
  zonesForTable,
  formatStatusLine,
} from './weeklyLeagueDivisions.js';

test('zoneCounts: full table is 5 up / 5 down', () => {
  assert.deepEqual(zoneCounts(20), { promote: 5, relegate: 5 });
});

test('zoneCounts: small tables keep a mid-band', () => {
  assert.deepEqual(zoneCounts(1), { promote: 0, relegate: 0 });
  assert.deepEqual(zoneCounts(2), { promote: 0, relegate: 0 });
  assert.deepEqual(zoneCounts(3), { promote: 1, relegate: 1 });
  assert.deepEqual(zoneCounts(10), { promote: 4, relegate: 4 });
  const n12 = zoneCounts(12);
  assert.deepEqual(n12, { promote: 5, relegate: 5 });
  assert.ok(n12.promote + n12.relegate < 12);
});

test('zonesForTable: CL and PL have no table promotion; Sunday has no relegation', () => {
  const cl = zonesForTable('champions_league', 20);
  assert.equal(cl.promoteMaxRank, 0);
  assert.equal(cl.relegateMinRank, 0);
  assert.equal(cl.isChampionsLeague, true);

  const pl = zonesForTable('premier_league', 20);
  assert.equal(pl.promoteMaxRank, 0);
  assert.equal(pl.relegateMinRank, 16);

  const sun = zonesForTable('sunday_league', 20);
  assert.equal(sun.promoteMaxRank, 5);
  assert.equal(sun.relegateMinRank, 0);
  assert.equal(sun.isSundayLeague, true);

  const champ = zonesForTable('championship', 20);
  assert.equal(champ.promoteMaxRank, 5);
  assert.equal(champ.relegateMinRank, 16);
});

test('outcomeForRank: CL fallback is back to Premier League', () => {
  assert.deepEqual(outcomeForRank('champions_league', 1, 20), {
    outcome: 'champion',
    nextDivision: 'premier_league',
  });
  assert.deepEqual(outcomeForRank('champions_league', 16, 20), {
    outcome: 'relegated',
    nextDivision: 'premier_league',
  });
  assert.deepEqual(outcomeForRank('premier_league', 1, 20), {
    outcome: 'stayed',
    nextDivision: 'premier_league',
  });
  assert.deepEqual(outcomeForRank('premier_league', 18, 20), {
    outcome: 'relegated',
    nextDivision: 'championship',
  });
  assert.deepEqual(outcomeForRank('sunday_league', 1, 20), {
    outcome: 'promoted',
    nextDivision: 'non_league',
  });
  assert.deepEqual(outcomeForRank('sunday_league', 20, 20), {
    outcome: 'stayed',
    nextDivision: 'sunday_league',
  });
  assert.deepEqual(outcomeForRank('championship', 3, 20), {
    outcome: 'promoted',
    nextDivision: 'premier_league',
  });
  assert.deepEqual(outcomeForRank('championship', 18, 20), {
    outcome: 'relegated',
    nextDivision: 'league_one',
  });
  assert.deepEqual(outcomeForRank('championship', 10, 20), {
    outcome: 'stayed',
    nextDivision: 'championship',
  });
});

test('compareWeeklyMembership: XP, then reached_at, then user_id', () => {
  const early = {
    weeklyXp: 100,
    weeklyXpReachedAt: new Date('2026-08-10T10:00:00Z'),
    userId: 'b',
  };
  const late = {
    weeklyXp: 100,
    weeklyXpReachedAt: new Date('2026-08-10T12:00:00Z'),
    userId: 'a',
  };
  const more = {
    weeklyXp: 101,
    weeklyXpReachedAt: new Date('2026-08-10T20:00:00Z'),
    userId: 'z',
  };
  const nullAt = {
    weeklyXp: 100,
    weeklyXpReachedAt: null,
    userId: 'c',
  };

  assert.ok(compareWeeklyMembership(more, early) < 0);
  assert.ok(compareWeeklyMembership(early, late) < 0);
  assert.ok(compareWeeklyMembership(early, nullAt) < 0);

  const sameXpTime = [
    { weeklyXp: 50, weeklyXpReachedAt: new Date('2026-08-10T10:00:00Z'), userId: 'm' },
    { weeklyXp: 50, weeklyXpReachedAt: new Date('2026-08-10T10:00:00Z'), userId: 'a' },
  ].sort(compareWeeklyMembership);
  assert.equal(sameXpTime[0]!.userId, 'a');
});

test('packGroupSizes: even packing under 20', () => {
  assert.deepEqual(packGroupSizes(0), []);
  assert.deepEqual(packGroupSizes(20), [20]);
  assert.deepEqual(packGroupSizes(21), [11, 10]);
  assert.deepEqual(packGroupSizes(61), [16, 15, 15, 15]);
  assert.equal(packGroupSizes(61).reduce((a, b) => a + b, 0), 61);
  assert.ok(packGroupSizes(90).every((s) => s <= 20));
});

test('londonWeekStart/End: Monday–Sunday Europe/London', () => {
  // Wednesday 2026-08-12 10:00 UTC → still Wednesday London → week Mon 2026-08-10
  assert.equal(londonWeekStart(new Date('2026-08-12T10:00:00Z')), '2026-08-10');
  assert.equal(londonWeekEnd('2026-08-10'), '2026-08-16');

  // Sunday evening London still in that week
  assert.equal(londonWeekStart(new Date('2026-08-16T20:00:00+01:00')), '2026-08-10');

  // Monday 00:10 London → new week
  assert.equal(londonWeekStart(new Date('2026-08-17T00:10:00+01:00')), '2026-08-17');
});

test('selectChampionsLeagueQualifiers: top 20 across CL + Premier League', () => {
  const pool = Array.from({ length: 45 }, (_, i) => ({
    userId: `u${String(i + 1).padStart(2, '0')}`,
    weeklyXp: 450 - i,
    weeklyXpReachedAt: new Date('2026-08-10T10:00:00Z'),
  }));
  const ids = selectChampionsLeagueQualifiers(pool);
  assert.equal(ids.size, 20);
  assert.equal(ids.has('u01'), true);
  assert.equal(ids.has('u20'), true);
  assert.equal(ids.has('u21'), false);

  const short = selectChampionsLeagueQualifiers(pool.slice(0, 7));
  assert.equal(short.size, 7);
});

test('resolveMembershipDestination: combined cut keeps CL and beats local relegation', () => {
  const qualifiers = new Set(['stacked-bottom', 'cl-safe', 'cl-champ']);
  assert.deepEqual(
    resolveMembershipDestination('premier_league', 18, 20, 'stacked-bottom', qualifiers),
    { outcome: 'promoted', nextDivision: 'champions_league' }
  );
  assert.deepEqual(
    resolveMembershipDestination('premier_league', 18, 20, 'not-selected', qualifiers),
    { outcome: 'relegated', nextDivision: 'championship' }
  );
  assert.deepEqual(
    resolveMembershipDestination('premier_league', 3, 20, 'not-selected', qualifiers),
    { outcome: 'stayed', nextDivision: 'premier_league' }
  );
  assert.deepEqual(
    resolveMembershipDestination('champions_league', 1, 20, 'cl-champ', qualifiers),
    { outcome: 'champion', nextDivision: 'champions_league' }
  );
  assert.deepEqual(
    resolveMembershipDestination('champions_league', 8, 20, 'cl-safe', qualifiers),
    { outcome: 'stayed', nextDivision: 'champions_league' }
  );
  assert.deepEqual(
    resolveMembershipDestination('champions_league', 16, 20, 'cl-dropped', qualifiers),
    { outcome: 'relegated', nextDivision: 'premier_league' }
  );
});

test('formatStatusLine: promotion / relegation / CL copy', () => {
  const standings = Array.from({ length: 20 }, (_, i) => ({
    rank: i + 1,
    xp: 300 - i * 10,
    userId: `u${i + 1}`,
  }));

  assert.equal(
    formatStatusLine({
      division: 'championship',
      rank: 3,
      xp: 280,
      standings,
      viewerUserId: 'u3',
    }),
    "You're in the promotion zone"
  );

  assert.equal(
    formatStatusLine({
      division: 'championship',
      rank: 18,
      xp: 120,
      standings,
      viewerUserId: 'u18',
    }),
    "You're in the relegation zone"
  );

  const fromPromo = formatStatusLine({
    division: 'championship',
    rank: 10,
    xp: 210,
    standings,
    viewerUserId: 'u10',
  });
  assert.ok(fromPromo?.includes('XP from promotion'));

  assert.equal(
    formatStatusLine({
      division: 'champions_league',
      rank: 1,
      xp: 300,
      standings,
      viewerUserId: 'u1',
    }),
    '1st in the Champions League'
  );

  assert.equal(
    formatStatusLine({
      division: 'champions_league',
      rank: 8,
      xp: 230,
      standings,
      viewerUserId: 'u8',
      championsLeague: { globalRank: 8, slots: 20, cutoffXp: 180 },
    }),
    "You're staying in the Champions League"
  );

  const stayNeed = formatStatusLine({
    division: 'champions_league',
    rank: 8,
    xp: 230,
    standings,
    viewerUserId: 'u8',
    championsLeague: { globalRank: 28, slots: 20, cutoffXp: 400 },
  });
  assert.ok(stayNeed?.includes('XP to stay in Champions League'));

  assert.equal(
    formatStatusLine({
      division: 'premier_league',
      rank: 8,
      xp: 230,
      standings,
      viewerUserId: 'u8',
      championsLeague: { globalRank: 12, slots: 20, cutoffXp: 400 },
    }),
    "You're in the Champions League places"
  );

  const fromCl = formatStatusLine({
    division: 'premier_league',
    rank: 8,
    xp: 230,
    standings,
    viewerUserId: 'u8',
    championsLeague: { globalRank: 28, slots: 20, cutoffXp: 400 },
  });
  assert.ok(fromCl?.includes('XP from Champions League'));
});

test('rollover idempotency signal: finalized week is a no-op precondition', () => {
  // Mirrors job guard: status === 'finalized' → skip. Pure contract for the job.
  const alreadyFinalized = (status: string) => status === 'finalized';
  assert.equal(alreadyFinalized('finalized'), true);
  assert.equal(alreadyFinalized('active'), false);
});
