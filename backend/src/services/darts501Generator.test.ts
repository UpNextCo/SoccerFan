import assert from 'node:assert/strict';
import test from 'node:test';
import { composeDarts501Formula, DARTS501_FORMULAS, presentDarts501Formula } from './darts501Generator.js';

test('every Football 501 formula has a real pool, never Any player', () => {
  for (const formula of DARTS501_FORMULAS) {
    const presented = presentDarts501Formula(formula);
    assert.notEqual(presented.audience, 'Any player');
    assert.ok(presented.audience.length > 0);
    const hasConstraint =
      presented.nationality != null ||
      presented.leagueName != null ||
      presented.club != null ||
      presented.audience === 'International Players';
    assert.equal(hasConstraint, true, formula.id);
  }
});

test('Chelsea PL apps − yellows is locked to Chelsea players', () => {
  const formula = DARTS501_FORMULAS.find((row) => row.id === 'pl_apps_minus_yellows_chelsea');
  assert.ok(formula);
  assert.deepEqual(formula.pool, {
    kind: 'club',
    club: 'Chelsea',
    teamId: 49,
    leagueName: 'Premier League',
  });
  const presented = presentDarts501Formula(formula);
  assert.equal(presented.audience, 'Chelsea Players');
  assert.equal(presented.club, 'Chelsea');
  assert.match(presented.formulaDetail, /yellow cards/i);
});

test('compose matches the Chelsea catalog recipe', () => {
  const formula = composeDarts501Formula({
    left: 'pl_apps',
    op: '-',
    right: 'pl_yellows',
    pool: { kind: 'club', club: 'Chelsea', teamId: 49, leagueName: 'Premier League' },
  });
  assert.equal(formula?.id, 'pl_apps_minus_yellows_chelsea');
});

test('Serie A goals + CL goals is locked to Serie A players', () => {
  const formula = DARTS501_FORMULAS.find((row) => row.id === 'seriea_goals_plus_cl_goals');
  assert.ok(formula);
  assert.deepEqual(formula.pool, { kind: 'league', leagueId: 135, leagueName: 'Serie A' });
  const presented = presentDarts501Formula(formula);
  assert.equal(presented.audience, 'Serie A Players');
  assert.match(presented.formulaDetail, /Serie A goals/i);
});
