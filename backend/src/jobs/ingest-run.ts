import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { ingestRuns } from '../db/schema.js';
import { getApiCallsUsed, resetApiCallsUsed } from './ingest-api.js';

export async function beginIngestRun(jobName: string): Promise<string> {
  resetApiCallsUsed();
  const [row] = await db
    .insert(ingestRuns)
    .values({ jobName, status: 'running' })
    .returning({ id: ingestRuns.id });
  return row!.id;
}

export async function finishIngestRun(
  runId: string,
  status: 'success' | 'failed',
  rowsUpserted: number,
  errorMessage?: string
): Promise<void> {
  await db
    .update(ingestRuns)
    .set({
      status,
      rowsUpserted,
      apiCallsUsed: getApiCallsUsed(),
      finishedAt: new Date(),
      errorMessage: errorMessage ?? null,
    })
    .where(eq(ingestRuns.id, runId));
}
