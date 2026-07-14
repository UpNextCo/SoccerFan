import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attemptsAfterInterruptedClaim,
  attemptsAfterManualRetry,
  canClaimGenerationMode,
  countGenerationItems,
  deriveGenerationRunStatus,
  finalGenerationStatus,
  isGenerationRetryEligible,
  shouldResumeActiveMonthRun,
} from './adminMonthGenerationState.js';

test('counts terminal generation item outcomes', () => {
  assert.deepEqual(
    countGenerationItems([
      'queued',
      'running',
      'succeeded',
      'succeeded',
      'skipped',
      'failed',
    ]),
    {
      completed: 4,
      succeeded: 2,
      skipped: 1,
      failed: 1,
    }
  );
});

test('does not finalize while generation items remain active', () => {
  assert.equal(
    finalGenerationStatus(4, { completed: 3, failed: 0 }),
    null
  );
});

test('finalizes clean and failed runs distinctly', () => {
  assert.equal(
    finalGenerationStatus(4, { completed: 4, failed: 0 }),
    'completed'
  );
  assert.equal(
    finalGenerationStatus(4, { completed: 4, failed: 1 }),
    'completed_with_failures'
  );
});

test('only completed runs with failures are retry eligible', () => {
  assert.equal(isGenerationRetryEligible('completed_with_failures', 2), true);
  assert.equal(isGenerationRetryEligible('completed_with_failures', 0), false);
  assert.equal(isGenerationRetryEligible('running', 2), false);
  assert.equal(isGenerationRetryEligible('completed', 2), false);
});

test('resumes any active run for the requested month regardless of mode scope', () => {
  assert.equal(
    shouldResumeActiveMonthRun('2026-07', { yearMonth: '2026-07', status: 'running' }),
    true
  );
  assert.equal(
    shouldResumeActiveMonthRun('2026-07', { yearMonth: '2026-07', status: 'queued' }),
    true
  );
  assert.equal(
    shouldResumeActiveMonthRun('2026-07', { yearMonth: '2026-08', status: 'running' }),
    false
  );
  assert.equal(
    shouldResumeActiveMonthRun('2026-07', {
      yearMonth: '2026-07',
      status: 'completed_with_failures',
    }),
    false
  );
});

test('derives queued status after failed items are requeued', () => {
  assert.equal(
    deriveGenerationRunStatus(4, { completed: 3, failed: 0, running: 0 }),
    'queued'
  );
  assert.equal(
    deriveGenerationRunStatus(4, { completed: 3, failed: 0, running: 1 }),
    'running'
  );
  assert.equal(
    deriveGenerationRunStatus(4, { completed: 4, failed: 1, running: 0 }),
    'completed_with_failures'
  );
});

test('deployment interruption restores the consumed attempt', () => {
  assert.equal(attemptsAfterInterruptedClaim(3), 2);
  assert.equal(attemptsAfterInterruptedClaim(1), 0);
  assert.equal(attemptsAfterInterruptedClaim(0), 0);
});

test('manual retry resets the item attempt budget', () => {
  assert.equal(attemptsAfterManualRetry(), 0);
});

test('queue policy allows only one globally running LMS item', () => {
  assert.equal(canClaimGenerationMode('last_man_standing', []), true);
  assert.equal(canClaimGenerationMode('last_man_standing', ['football_bingo']), true);
  assert.equal(
    canClaimGenerationMode('last_man_standing', ['last_man_standing']),
    false
  );
  assert.equal(
    canClaimGenerationMode('football_bingo', ['last_man_standing']),
    true
  );
});
