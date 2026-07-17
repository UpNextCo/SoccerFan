import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFallbackCareerPath,
  buildTransferCareerPath,
  fitCareerPath,
  type CareerTransferRow,
} from './builders/careerPath.js';

const salibaTransfers: CareerTransferRow[] = [
  transfer('2019-07-25', 'Saint-Étienne', 'Arsenal', 'permanent'),
  transfer('2019-07-26', 'Arsenal', 'Saint-Étienne', 'loan'),
  transfer('2020-07-01', 'Saint-Étienne', 'Arsenal', 'unknown'),
  transfer('2021-01-04', 'Arsenal', 'Nice', 'loan'),
  transfer('2021-07-15', 'Arsenal', 'Marseille', 'loan'),
  transfer('2022-07-01', 'Marseille', 'Arsenal', 'unknown'),
];

function transfer(
  date: string,
  from: string,
  to: string,
  type: string
): CareerTransferRow {
  return {
    player_id: 'player',
    transfer_date: date,
    transfer_type: type,
    from_team_name: from,
    from_logo_url: null,
    to_team_name: to,
    to_logo_url: null,
  };
}

test('career timeline preserves loans and the meaningful final parent-club return', () => {
  assert.deepEqual(buildTransferCareerPath(salibaTransfers, 'Arsenal', new Set()), [
    { name: 'Saint-Étienne', logoUrl: undefined },
    { name: 'Arsenal', logoUrl: undefined },
    { name: 'Saint-Étienne', logoUrl: undefined, note: 'loan' },
    { name: 'Nice', logoUrl: undefined, note: 'loan' },
    { name: 'Marseille', logoUrl: undefined, note: 'loan' },
    { name: 'Arsenal', logoUrl: undefined },
  ]);
});

test('fallback path appends the current club when career rows only show its first arrival', () => {
  assert.deepEqual(
    buildFallbackCareerPath(
      ['Saint-Étienne', 'Arsenal', 'Nice', 'Marseille'],
      'Arsenal',
      new Set()
    ).map((club) => club.name),
    ['Saint-Étienne', 'Arsenal', 'Nice', 'Marseille', 'Arsenal']
  );
});

test('transfer path does not append a stale current-club field or duplicate FC aliases', () => {
  const path = buildTransferCareerPath(
    [
      transfer('2020-01-01', 'Club A', 'Melbourne Victory', 'permanent'),
      transfer('2021-01-01', 'Melbourne Victory', 'Melbourne Victory FC', 'permanent'),
    ],
    'Unrelated stale club',
    new Set()
  );
  assert.deepEqual(path.map((club) => club.name), ['Club A', 'Melbourne Victory']);
});

test('long paths fit six badges while preserving both ends and chronology', () => {
  const path = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((name) => ({ name }));
  const fitted = fitCareerPath(path, 6);
  assert.equal(fitted.length, 6);
  assert.equal(fitted[0]?.name, 'A');
  assert.equal(fitted.at(-1)?.name, 'H');
  assert.deepEqual(
    fitted.map((club) => path.findIndex((candidate) => candidate.name === club.name)),
    [...fitted.map((club) => path.findIndex((candidate) => candidate.name === club.name))].sort(
      (a, b) => a - b
    )
  );
});
