import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  opsGenerationItems,
  opsGenerationRuns,
  type OpsGenerationItem,
  type OpsGenerationRun,
} from '../db/schema.js';
import { daysInMonth, generateOnePuzzle, OPS_PLAYABLE_MODES } from './puzzleOps.js';
import {
  attemptsAfterInterruptedClaim,
  attemptsAfterManualRetry,
  deriveGenerationRunStatus,
  isGenerationRetryEligible,
  shouldResumeActiveMonthRun,
  type GenerationRunStatus,
} from './adminMonthGenerationState.js';

const MAX_ATTEMPTS = 3;
const WORKER_CONCURRENCY = 2;
const SWEEP_INTERVAL_MS = 30_000;
const STALE_ITEM_MS = 5 * 60_000;
const ITEM_HEARTBEAT_MS = 30_000;
const RETRY_BASE_DELAY_MS = 15_000;
const ACTIVE_STATUSES = ['queued', 'running'] as const;

let drainPromise: Promise<void> | null = null;
let sweepTimer: NodeJS.Timeout | null = null;
let stopping = false;
const activeClaims = new Map<string, ClaimedItem>();

export interface GenerationRunView extends OpsGenerationRun {
  succeededCount: number;
}

export interface GenerationRunDetail extends GenerationRunView {
  items: OpsGenerationItem[];
}

interface ClaimedItem {
  id: string;
  runId: string;
  date: string;
  modeId: string;
  attempts: number;
}

function runView(run: OpsGenerationRun): GenerationRunView {
  return {
    ...run,
    succeededCount: run.completedCount - run.failedCount - run.skippedCount,
  };
}

export function normalizeGenerationModes(requested?: readonly string[]): string[] {
  const selected = requested?.length ? new Set(requested) : new Set<string>(OPS_PLAYABLE_MODES);
  const unknown = [...selected].filter(
    (mode) => !(OPS_PLAYABLE_MODES as readonly string[]).includes(mode)
  );
  if (unknown.length > 0) throw new Error(`Unknown mode: ${unknown.join(', ')}`);
  return OPS_PLAYABLE_MODES.filter((mode) => selected.has(mode));
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  );
}

async function findActiveRun(yearMonth: string): Promise<OpsGenerationRun | null> {
  const rows = await db
    .select()
    .from(opsGenerationRuns)
    .where(
      and(
        eq(opsGenerationRuns.yearMonth, yearMonth),
        inArray(opsGenerationRuns.status, [...ACTIVE_STATUSES])
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function getGenerationRun(runId: string): Promise<GenerationRunDetail | null> {
  const runs = await db
    .select()
    .from(opsGenerationRuns)
    .where(eq(opsGenerationRuns.id, runId))
    .limit(1);
  const run = runs[0];
  if (!run) return null;
  const items = await db
    .select()
    .from(opsGenerationItems)
    .where(eq(opsGenerationItems.runId, runId))
    .orderBy(asc(opsGenerationItems.date), asc(opsGenerationItems.modeId));
  return { ...runView(run), items };
}

export async function listGenerationRuns(yearMonth?: string): Promise<GenerationRunView[]> {
  const query = db.select().from(opsGenerationRuns);
  const rows = yearMonth
    ? await query
        .where(eq(opsGenerationRuns.yearMonth, yearMonth))
        .orderBy(desc(opsGenerationRuns.createdAt))
    : await query.orderBy(desc(opsGenerationRuns.createdAt)).limit(50);
  return rows.map(runView);
}

export async function startGenerationRun(args: {
  yearMonth: string;
  modes?: readonly string[];
  requestedBy: string;
}): Promise<{ run: GenerationRunDetail; created: boolean }> {
  const dates = daysInMonth(args.yearMonth);
  const modes = normalizeGenerationModes(args.modes);
  const modeScope = modes.join(',');
  const active = await findActiveRun(args.yearMonth);
  if (
    shouldResumeActiveMonthRun(
      args.yearMonth,
      active ? { yearMonth: active.yearMonth, status: active.status as GenerationRunStatus } : null
    )
  ) {
    if (!active) throw new Error('Active generation run disappeared');
    const detail = await getGenerationRun(active.id);
    if (!detail) throw new Error('Active generation run disappeared');
    return { run: detail, created: false };
  }

  let runId: string;
  try {
    runId = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(opsGenerationRuns)
        .values({
          yearMonth: args.yearMonth,
          requestedModes: modes,
          modeScope,
          status: 'queued',
          totalCount: dates.length * modes.length,
          requestedBy: args.requestedBy.slice(0, 128) || 'ops',
        })
        .returning({ id: opsGenerationRuns.id });
      const id = inserted[0]?.id;
      if (!id) throw new Error('Failed to create generation run');
      await tx.insert(opsGenerationItems).values(
        dates.flatMap((date) =>
          modes.map((modeId) => ({
            runId: id,
            date,
            modeId,
          }))
        )
      );
      return id;
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const raced = await findActiveRun(args.yearMonth);
    if (!raced) throw error;
    const detail = await getGenerationRun(raced.id);
    if (!detail) throw new Error('Concurrent generation run disappeared');
    return { run: detail, created: false };
  }

  const run = await getGenerationRun(runId);
  if (!run) throw new Error('Created generation run not found');
  void resumeMonthGenerationWorker();
  return { run, created: true };
}

async function refreshRunProgress(runId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${runId}, 0))`);
    await tx.execute(sql`
      WITH counts AS (
        SELECT
          count(*) FILTER (WHERE status IN ('succeeded', 'skipped', 'failed'))::int AS completed,
          count(*) FILTER (WHERE status = 'failed')::int AS failed,
          count(*) FILTER (WHERE status = 'skipped')::int AS skipped,
          count(*) FILTER (WHERE status = 'running')::int AS running
        FROM ops_generation_items
        WHERE run_id = ${runId}
      )
      UPDATE ops_generation_runs AS run
      SET
        completed_count = counts.completed,
        failed_count = counts.failed,
        skipped_count = counts.skipped,
        status = CASE
          WHEN counts.completed >= run.total_count AND counts.failed > 0
            THEN 'completed_with_failures'
          WHEN counts.completed >= run.total_count
            THEN 'completed'
          WHEN counts.running > 0
            THEN 'running'
          ELSE 'queued'
        END,
        started_at = CASE
          WHEN counts.completed > 0 OR counts.running > 0 THEN COALESCE(run.started_at, now())
          ELSE run.started_at
        END,
        finished_at = CASE
          WHEN counts.completed >= run.total_count THEN COALESCE(run.finished_at, now())
          ELSE NULL
        END,
        updated_at = now()
      FROM counts
      WHERE run.id = ${runId}
    `);
  });
}

async function recoverStaleItems(): Promise<void> {
  const staleBefore = new Date(Date.now() - STALE_ITEM_MS).toISOString();
  const rows = (await db.execute(sql`
    UPDATE ops_generation_items
    SET
      status = 'queued',
      attempts = GREATEST(attempts - 1, 0),
      next_attempt_at = now(),
      finished_at = NULL,
      updated_at = now()
    WHERE status = 'running' AND updated_at < ${staleBefore}::timestamptz
    RETURNING run_id
  `)) as unknown as Array<{ run_id: string }>;
  for (const runId of new Set(rows.map((row) => row.run_id))) {
    await refreshRunProgress(runId);
  }
}

async function reconcileActiveRuns(): Promise<void> {
  const runs = await db
    .select({ id: opsGenerationRuns.id })
    .from(opsGenerationRuns)
    .where(inArray(opsGenerationRuns.status, [...ACTIVE_STATUSES]));
  for (const run of runs) {
    await refreshRunProgress(run.id);
  }
}

async function claimNextItem(): Promise<ClaimedItem | null> {
  if (stopping) return null;
  const rows = await db.transaction(async (tx) => {
    // Serialize durable claims so two workers cannot both observe "no LMS running".
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('ops-generation-claim', 0))`);
    return (await tx.execute(sql`
      WITH candidate AS (
      SELECT item.id
      FROM ops_generation_items AS item
      INNER JOIN ops_generation_runs AS run ON run.id = item.run_id
      WHERE
        item.status = 'queued'
        AND item.attempts < ${MAX_ATTEMPTS}
        AND item.next_attempt_at <= now()
        AND run.status IN ('queued', 'running')
        AND (
          item.mode_id NOT IN ('last_man_standing', 'football_golf')
          OR NOT EXISTS (
            SELECT 1
            FROM ops_generation_items AS active_serial
            WHERE active_serial.mode_id = item.mode_id
              AND active_serial.status = 'running'
          )
        )
      ORDER BY
        run.created_at,
        CASE WHEN item.mode_id IN ('last_man_standing', 'football_golf') THEN 1 ELSE 0 END,
        item.date,
        item.mode_id
      FOR UPDATE OF item SKIP LOCKED
      LIMIT 1
    ),
    claimed AS (
      UPDATE ops_generation_items AS item
      SET
        status = 'running',
        attempts = item.attempts + 1,
        started_at = COALESCE(item.started_at, now()),
        updated_at = now()
      FROM candidate
      WHERE item.id = candidate.id
      RETURNING item.id, item.run_id, item.date, item.mode_id, item.attempts
    ),
    touched AS (
      UPDATE ops_generation_runs AS run
      SET status = 'running', started_at = COALESCE(run.started_at, now()), updated_at = now()
      WHERE run.id IN (SELECT run_id FROM claimed)
      RETURNING run.id
    )
      SELECT claimed.* FROM claimed LEFT JOIN touched ON touched.id = claimed.run_id
    `)) as unknown as Array<{
      id: string;
      run_id: string;
      date: string;
      mode_id: string;
      attempts: number;
    }>;
  });
  const typedRows = rows as Array<{
    id: string;
    run_id: string;
    date: string;
    mode_id: string;
    attempts: number;
  }>;
  const row = typedRows[0];
  return row
    ? {
        id: row.id,
        runId: row.run_id,
        date: row.date,
        modeId: row.mode_id,
        attempts: row.attempts,
      }
    : null;
}

async function releaseInterruptedClaim(item: ClaimedItem): Promise<void> {
  const released = await db
    .update(opsGenerationItems)
    .set({
      status: 'queued',
      attempts: attemptsAfterInterruptedClaim(item.attempts),
      nextAttemptAt: new Date(),
      finishedAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(opsGenerationItems.id, item.id),
        eq(opsGenerationItems.status, 'running'),
        eq(opsGenerationItems.attempts, item.attempts)
      )
    )
    .returning({ runId: opsGenerationItems.runId });
  if (released[0]) await refreshRunProgress(released[0].runId);
}

async function processClaimedItem(item: ClaimedItem): Promise<void> {
  activeClaims.set(item.id, item);
  if (stopping) {
    try {
      await releaseInterruptedClaim(item);
    } finally {
      activeClaims.delete(item.id);
    }
    return;
  }
  const heartbeat = setInterval(() => {
    void db
      .update(opsGenerationItems)
      .set({ updatedAt: new Date() })
      .where(
        and(
          eq(opsGenerationItems.id, item.id),
          eq(opsGenerationItems.status, 'running'),
          eq(opsGenerationItems.attempts, item.attempts)
        )
      )
      .catch((error) => {
        console.warn(`Month generation heartbeat failed for item ${item.id}:`, error);
      });
  }, ITEM_HEARTBEAT_MS);
  heartbeat.unref();

  let result: Awaited<ReturnType<typeof generateOnePuzzle>>;
  try {
    result = await generateOnePuzzle(item.date, item.modeId, { force: false });
  } catch (error) {
    result = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearInterval(heartbeat);
  }
  const now = new Date();
  let status: 'queued' | 'succeeded' | 'skipped' | 'failed';
  let nextAttemptAt = now;
  let error: string | null = null;

  if (result.ok) {
    status = 'succeeded';
  } else if (result.skipped) {
    status = 'skipped';
    error = result.skipped;
  } else {
    error = (result.error || 'Generation failed').slice(0, 4_000);
    if (item.attempts < MAX_ATTEMPTS) {
      status = 'queued';
      nextAttemptAt = new Date(Date.now() + RETRY_BASE_DELAY_MS * item.attempts);
    } else {
      status = 'failed';
    }
  }

  try {
    const changed = await db
      .update(opsGenerationItems)
      .set({
        status,
        error,
        nextAttemptAt,
        finishedAt: status === 'queued' ? null : now,
        updatedAt: now,
      })
      .where(
        and(
          eq(opsGenerationItems.id, item.id),
          eq(opsGenerationItems.status, 'running'),
          eq(opsGenerationItems.attempts, item.attempts)
        )
      )
      .returning({ id: opsGenerationItems.id });
    if (changed.length > 0) await refreshRunProgress(item.runId);
  } finally {
    activeClaims.delete(item.id);
  }
}

async function drainGenerationQueue(): Promise<void> {
  await recoverStaleItems();
  await reconcileActiveRuns();
  const worker = async () => {
    while (!stopping) {
      const item = await claimNextItem();
      if (!item) return;
      await processClaimedItem(item);
    }
  };
  await Promise.all(Array.from({ length: WORKER_CONCURRENCY }, () => worker()));
}

export function resumeMonthGenerationWorker(): Promise<void> {
  if (stopping) return Promise.resolve();
  if (drainPromise) return drainPromise;
  drainPromise = drainGenerationQueue()
    .catch((error) => {
      console.error('Month generation worker failed:', error);
    })
    .finally(() => {
      drainPromise = null;
    });
  return drainPromise;
}

export function startMonthGenerationWorker(): void {
  stopping = false;
  void resumeMonthGenerationWorker();
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    void resumeMonthGenerationWorker();
  }, SWEEP_INTERVAL_MS);
  sweepTimer.unref();
}

export async function stopMonthGenerationWorker(): Promise<void> {
  stopping = true;
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }

  const claims = [...activeClaims.values()];
  if (claims.length === 0) return;
  await Promise.all(claims.map((claim) => releaseInterruptedClaim(claim)));
}

export async function retryFailedGenerationItems(runId: string): Promise<GenerationRunDetail> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${runId}, 0))`);
    const rows = await tx
      .select()
      .from(opsGenerationRuns)
      .where(eq(opsGenerationRuns.id, runId))
      .limit(1);
    const run = rows[0];
    if (!run) throw new Error('Generation run not found');

    const before = (await tx.execute(sql`
      SELECT
        count(*) FILTER (WHERE status IN ('succeeded', 'skipped', 'failed'))::int AS completed,
        count(*) FILTER (WHERE status = 'failed')::int AS failed,
        count(*) FILTER (WHERE status = 'skipped')::int AS skipped,
        count(*) FILTER (WHERE status = 'running')::int AS running
      FROM ops_generation_items
      WHERE run_id = ${runId}
    `)) as unknown as Array<{
      completed: number;
      failed: number;
      skipped: number;
      running: number;
    }>;
    const current = before[0] ?? { completed: 0, failed: 0, skipped: 0, running: 0 };
    const currentStatus = deriveGenerationRunStatus(run.totalCount, current);
    if (!isGenerationRetryEligible(currentStatus, current.failed)) {
      throw new Error('Generation run has no retryable failed items');
    }

    const retried = await tx
      .update(opsGenerationItems)
      .set({
        status: 'queued',
        attempts: attemptsAfterManualRetry(),
        error: null,
        nextAttemptAt: new Date(),
        startedAt: null,
        finishedAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(opsGenerationItems.runId, runId),
          eq(opsGenerationItems.status, 'failed')
        )
      )
      .returning({ id: opsGenerationItems.id });
    if (retried.length === 0) throw new Error('Generation run has no retryable failed items');

    const after = (await tx.execute(sql`
      SELECT
        count(*) FILTER (WHERE status IN ('succeeded', 'skipped', 'failed'))::int AS completed,
        count(*) FILTER (WHERE status = 'failed')::int AS failed,
        count(*) FILTER (WHERE status = 'skipped')::int AS skipped,
        count(*) FILTER (WHERE status = 'running')::int AS running
      FROM ops_generation_items
      WHERE run_id = ${runId}
    `)) as unknown as Array<{
      completed: number;
      failed: number;
      skipped: number;
      running: number;
    }>;
    const counters = after[0] ?? { completed: 0, failed: 0, skipped: 0, running: 0 };
    await tx
      .update(opsGenerationRuns)
      .set({
        status: deriveGenerationRunStatus(run.totalCount, counters),
        completedCount: counters.completed,
        failedCount: counters.failed,
        skippedCount: counters.skipped,
        finishedAt:
          counters.completed >= run.totalCount ? run.finishedAt ?? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(opsGenerationRuns.id, runId));
  });

  const run = await getGenerationRun(runId);
  if (!run) throw new Error('Generation run not found after retry');
  void resumeMonthGenerationWorker();
  return run;
}
