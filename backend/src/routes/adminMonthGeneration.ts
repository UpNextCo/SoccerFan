import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../middleware/adminAuth.js';
import { sendError, sendSuccess } from '../middleware/auth.js';
import {
  getGenerationRun,
  listGenerationRuns,
  retryFailedGenerationItems,
  startGenerationRun,
} from '../services/adminMonthGeneration.js';
import { OPS_PLAYABLE_MODES } from '../services/puzzleOps.js';

const yearMonthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'yearMonth must be YYYY-MM');
const runIdSchema = z.string().uuid();
const modeSchema = z.enum(OPS_PLAYABLE_MODES);

export const adminMonthGenerationRouter = Router();
adminMonthGenerationRouter.use(requireAdmin);

adminMonthGenerationRouter.post('/runs', async (req, res) => {
  const body = z
    .object({
      yearMonth: yearMonthSchema,
      modes: z.array(modeSchema).min(1).optional(),
    })
    .safeParse(req.body);
  if (!body.success) {
    sendError(res, 'Invalid month generation request', 400, 'VALIDATION', body.error.flatten());
    return;
  }

  try {
    const result = await startGenerationRun({
      yearMonth: body.data.yearMonth,
      modes: body.data.modes,
      requestedBy: req.adminName || 'ops',
    });
    sendSuccess(res, { ...result.run, created: result.created }, result.created ? 202 : 200);
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : String(error), 500);
  }
});

adminMonthGenerationRouter.get('/runs', async (req, res) => {
  const parsed = z
    .object({ yearMonth: yearMonthSchema.optional() })
    .safeParse({ yearMonth: req.query.yearMonth || undefined });
  if (!parsed.success) {
    sendError(res, 'Invalid yearMonth', 400, 'VALIDATION', parsed.error.flatten());
    return;
  }

  try {
    sendSuccess(res, await listGenerationRuns(parsed.data.yearMonth));
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : String(error), 500);
  }
});

adminMonthGenerationRouter.get('/runs/:id', async (req, res) => {
  const id = runIdSchema.safeParse(req.params.id);
  if (!id.success) {
    sendError(res, 'Invalid run id', 400, 'VALIDATION');
    return;
  }
  try {
    const run = await getGenerationRun(id.data);
    if (!run) {
      sendError(res, 'Generation run not found', 404, 'NOT_FOUND');
      return;
    }
    sendSuccess(res, run);
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : String(error), 500);
  }
});

adminMonthGenerationRouter.post('/runs/:id/retry-failed', async (req, res) => {
  const id = runIdSchema.safeParse(req.params.id);
  if (!id.success) {
    sendError(res, 'Invalid run id', 400, 'VALIDATION');
    return;
  }
  try {
    const existing = await getGenerationRun(id.data);
    if (!existing) {
      sendError(res, 'Generation run not found', 404, 'NOT_FOUND');
      return;
    }
    sendSuccess(res, await retryFailedGenerationItems(id.data), 202);
  } catch (error) {
    sendError(
      res,
      error instanceof Error ? error.message : String(error),
      409,
      'NOT_RETRYABLE'
    );
  }
});
