import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareWeeklyMembership,
  divisionForLifetimePercentile,
  londonWeekEnd,
  londonWeekStart,
  outcomeForRank,
  packGroupSizes,
  zoneCounts,
  zonesForTable,
  formatStatusLine,
} from './weeklyLeagueDivisions.js';

test('zoneCounts: full table is 5 up / 5 down', () => {
  assert.deepEqual(zoneCounts(30), { promote: 5, relegate: 5 });
});

test('zoneCounts: small tables keep a mid-band', () => {
  assert.deepEqual(zoneCounts(1), { promote: 0, relegate: 0 });
  assert.deepEqual(zoneCounts(2), { promote: 0, relegate: 0 });
  assert.deepEqual(zoneCounts(3), { promote: 1, relegate: 1 });
  assert.deepEqual(zoneCounts(10), { promote: 2, relegate: 2 });
  const n12 = zoneCounts(12);
  assert.ok(n12.promote + n12.relegate < 12);
  assert.ok(n12.promote >= 1 && n12.relegate >= 1);
});

test('zonesForTable: Champions League has no promotion; Sunday has no relegation', () => {
  const cl = zonesForTable('champions_league', 30);
  assert.equal(cl.promoteMaxRank, 0);
  assert.equal(cl.relegateMinRank, 26);
  assert.equal(cl.isChampionsLeague, true);

  const sun = zonesForTable('sunday_league', 30);
  assert.equal(sun.promoteMaxRank, 5);
  assert.equal(sun.relegateMinRank, 0);
  assert.equal(sun.isSundayLeague, true);

  const champ = zonesForTable('championship', 30);
  assert.equal(champ.promoteMaxRank, 5);
  assert.equal(champ.relegateMinRank, 26);
});

test('outcomeForRank: CL #1 is champion; edges promote/relegate', () => {
  assert.deepEqual(outcomeForRank('champions_league', 1, 30), {
    outcome: 'champion',
    nextDivision: 'champions_league',
  });
  assert.deepEqual(outcomeForRank('champions_league', 26, 30), {
    outcome: 'relegated',
    nextDivision: 'premier_league',
  });
  assert.deepEqual(outcomeForRank('sunday_league', 1, 30), {
    outcome: 'promoted',
    nextDivision: 'non_league',
  });
  assert.deepEqual(outcomeForRank('sunday_league', 30, 30), {
    outcome: 'stayed',
    nextDivision: 'sunday_league',
  });
  assert.deepEqual(outcomeForRank('championship', 3, 30), {
    outcome: 'promoted',
    nextDivision: 'premier_league',
  });
  assert.deepEqual(outcomeForRank('championship', 28, 30), {
    outcome: 'relegated',
    nextDivision: 'league_one',
  });
  assert.deepEqual(outcomeForRank('championship', 15, 30), {
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

test('packGroupSizes: even packing under 30', () => {
  assert.deepEqual(packGroupSizes(0), []);
  assert.deepEqual(packGroupSizes(30), [30]);
  assert.deepEqual(packGroupSizes(31), [16, 15]);
  assert.deepEqual(packGroupSizes(61), [21, 20, 20]);
  assert.equal(packGroupSizes(61).reduce((a, b) => a + b, 0), 61);
  assert.ok(packGroupSizes(90).every((s) => s <= 30));
});

test('divisionForLifetimePercentile bands', () => {
  const total = 100;
  assert.equal(divisionForLifetimePercentile(0, total), 'champions_league');
  assert.equal(divisionForLifetimePercentile(4, total), 'champions_league');
  assert.equal(divisionForLifetimePercentile(5, total), 'premier_league');
  assert.equal(divisionForLifetimePercentile(14, total), 'premier_league');
  assert.equal(divisionForLifetimePercentile(15, total), 'championship');
  assert.equal(divisionForLifetimePercentile(80, total), 'sunday_league');
  assert.equal(divisionForLifetimePercentile(0, 0), 'sunday_league');
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

test('formatStatusLine: promotion / relegation / CL copy', () => {
  const standings = Array.from({ length: 30 }, (_, i) => ({
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
      rank: 28,
      xp: 20,
      standings,
      viewerUserId: 'u28',
    }),
    "You're in the relegation zone"
  );

  const fromPromo = formatStatusLine({
    division: 'championship',
    rank: 10,
    xp: 200,
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
});

test('rollover idempotency signal: finalized week is a no-op precondition', () => {
  // Mirrors job guard: status === 'finalized' → skip. Pure contract for the job.
  const alreadyFinalized = (status: string) => status === 'finalized';
  assert.equal(alreadyFinalized('finalized'), true);
  assert.equal(alreadyFinalized('active'), false);
});
