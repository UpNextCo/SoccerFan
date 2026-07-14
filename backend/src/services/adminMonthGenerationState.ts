export type GenerationRunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'completed_with_failures';

export type GenerationItemStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'skipped'
  | 'failed';

export interface GenerationCounters {
  completed: number;
  failed: number;
  skipped: number;
  succeeded: number;
}

export interface ActiveMonthRun {
  yearMonth: string;
  status: GenerationRunStatus;
}

export function countGenerationItems(statuses: readonly GenerationItemStatus[]): GenerationCounters {
  const failed = statuses.filter((status) => status === 'failed').length;
  const skipped = statuses.filter((status) => status === 'skipped').length;
  const succeeded = statuses.filter((status) => status === 'succeeded').length;
  return {
    completed: failed + skipped + succeeded,
    failed,
    skipped,
    succeeded,
  };
}

export function finalGenerationStatus(
  total: number,
  counters: Pick<GenerationCounters, 'completed' | 'failed'>
): GenerationRunStatus | null {
  if (counters.completed < total) return null;
  return counters.failed > 0 ? 'completed_with_failures' : 'completed';
}

export function deriveGenerationRunStatus(
  total: number,
  counters: Pick<GenerationCounters, 'completed' | 'failed'> & { running: number }
): GenerationRunStatus {
  return (
    finalGenerationStatus(total, counters) ??
    (counters.running > 0 ? 'running' : 'queued')
  );
}

export function shouldResumeActiveMonthRun(
  requestedYearMonth: string,
  run: ActiveMonthRun | null
): boolean {
  return (
    run !== null &&
    run.yearMonth === requestedYearMonth &&
    (run.status === 'queued' || run.status === 'running')
  );
}

export function attemptsAfterInterruptedClaim(attempts: number): number {
  return Math.max(0, attempts - 1);
}

export function attemptsAfterManualRetry(): number {
  return 0;
}

export function isGenerationRetryEligible(
  status: GenerationRunStatus,
  failedCount: number
): boolean {
  return status === 'completed_with_failures' && failedCount > 0;
}

/** Mirrors the durable claim policy: LMS is globally single-flight across all month runs. */
export function canClaimGenerationMode(
  candidateMode: string,
  runningModes: readonly string[]
): boolean {
  return candidateMode !== 'last_man_standing' ||
    !runningModes.includes('last_man_standing');
}
