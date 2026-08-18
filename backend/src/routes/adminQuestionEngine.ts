import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../middleware/adminAuth.js';
import { sendError, sendSuccess } from '../middleware/auth.js';
import {
  generateOneMoreCandidatePairs,
  listOneMoreMetrics,
  lookupOneMorePlayerMetricValue,
  previewOneMoreMetric,
  verifyOneMoreCandidateValues,
} from '../services/oneMoreGenerator.js';
import {
  createQuestionTemplate,
  deleteQuestionTemplate,
  getQuestionTemplate,
  listQuestionTemplates,
  QUESTION_TEMPLATE_STATUSES,
  QuestionTemplateValidationError,
  updateQuestionTemplate,
} from '../services/questionTemplateService.js';

export const adminQuestionEngineRouter = Router();
adminQuestionEngineRouter.use(requireAdmin);

const metricIdSchema = z.string().min(1).max(80);
const thresholdSchema = z.number().int().min(0).max(100_000);
const statusSchema = z.enum(QUESTION_TEMPLATE_STATUSES);
const configSchema = z.record(z.unknown());
const templateCreateSchema = z.object({
  mode: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(160),
  prompt: z.string().trim().min(1).max(1_000),
  config: configSchema,
  status: statusSchema.optional(),
}).strict();
const templateUpdateSchema = templateCreateSchema.partial();

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isUnknownMetric(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('Unknown One More metric:');
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

adminQuestionEngineRouter.get('/metrics', (_req, res) => {
  sendSuccess(res, listOneMoreMetrics());
});

adminQuestionEngineRouter.post('/metrics/preview', async (req, res) => {
  const body = z.object({
    metricId: metricIdSchema,
    threshold: thresholdSchema.optional(),
  }).safeParse(req.body);
  if (!body.success) {
    sendError(res, 'Invalid body', 400, 'VALIDATION');
    return;
  }
  try {
    sendSuccess(res, await previewOneMoreMetric(body.data.metricId, body.data.threshold));
  } catch (error) {
    sendError(res, errorMessage(error), isUnknownMetric(error) ? 404 : 500);
  }
});

adminQuestionEngineRouter.post('/metrics/candidates', async (req, res) => {
  const body = z.object({
    metricId: metricIdSchema,
    threshold: thresholdSchema,
    compareMode: z.boolean().optional(),
    count: z.number().int().min(1).max(50).optional(),
    seed: z.string().min(1).max(200).optional(),
  }).safeParse(req.body);
  if (!body.success) {
    sendError(res, 'Invalid body', 400, 'VALIDATION');
    return;
  }
  try {
    sendSuccess(res, await generateOneMoreCandidatePairs(body.data));
  } catch (error) {
    sendError(res, errorMessage(error), isUnknownMetric(error) ? 404 : 500);
  }
});

adminQuestionEngineRouter.get('/metrics/:metricId/players/:playerId', async (req, res) => {
  const params = z.object({
    metricId: metricIdSchema,
    playerId: z.string().uuid(),
  }).safeParse(req.params);
  if (!params.success) {
    sendError(res, 'Invalid metric or player id', 400, 'VALIDATION');
    return;
  }
  try {
    const value = await lookupOneMorePlayerMetricValue(params.data.metricId, params.data.playerId);
    if (!value) {
      sendError(res, 'Player not found', 404);
      return;
    }
    sendSuccess(res, value);
  } catch (error) {
    sendError(res, errorMessage(error), isUnknownMetric(error) ? 404 : 500);
  }
});

adminQuestionEngineRouter.post('/metrics/verify', async (req, res) => {
  const option = z.object({
    playerId: z.string().uuid(),
    expectedValue: thresholdSchema.optional(),
  });
  const body = z.object({
    metricId: metricIdSchema,
    threshold: thresholdSchema,
    compareMode: z.boolean().optional(),
    pairs: z.array(z.tuple([option, option])).min(1).max(50),
  }).safeParse(req.body);
  if (!body.success) {
    sendError(res, 'Invalid body', 400, 'VALIDATION');
    return;
  }
  try {
    const pairs = await verifyOneMoreCandidateValues(
      body.data.metricId,
      body.data.threshold,
      body.data.pairs,
      { compareMode: body.data.compareMode }
    );
    sendSuccess(res, { valid: pairs.every((pair) => pair.valid), pairs });
  } catch (error) {
    sendError(res, errorMessage(error), isUnknownMetric(error) ? 404 : 500);
  }
});

adminQuestionEngineRouter.get('/templates', async (req, res) => {
  const query = z.object({
    mode: z.string().trim().min(1).max(80).optional(),
    status: statusSchema.optional(),
  }).safeParse(req.query);
  if (!query.success) {
    sendError(res, 'Invalid query', 400, 'VALIDATION');
    return;
  }
  try {
    sendSuccess(res, await listQuestionTemplates(query.data));
  } catch (error) {
    sendError(res, errorMessage(error), 500);
  }
});

adminQuestionEngineRouter.post('/templates', async (req, res) => {
  const body = templateCreateSchema.safeParse(req.body);
  if (!body.success) {
    sendError(res, 'Invalid body', 400, 'VALIDATION');
    return;
  }
  try {
    sendSuccess(res, await createQuestionTemplate(body.data), 201);
  } catch (error) {
    const validationError = error instanceof QuestionTemplateValidationError;
    sendError(
      res,
      isUniqueViolation(error) ? 'A template with this mode and name already exists' : errorMessage(error),
      isUniqueViolation(error) ? 409 : validationError ? 400 : 500,
      validationError ? 'VALIDATION' : undefined
    );
  }
});

adminQuestionEngineRouter.get('/templates/:id', async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) {
    sendError(res, 'Invalid template id', 400, 'VALIDATION');
    return;
  }
  try {
    const template = await getQuestionTemplate(id.data);
    if (!template) {
      sendError(res, 'Template not found', 404);
      return;
    }
    sendSuccess(res, template);
  } catch (error) {
    sendError(res, errorMessage(error), 500);
  }
});

adminQuestionEngineRouter.put('/templates/:id', async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  const body = templateUpdateSchema.refine((value) => Object.keys(value).length > 0).safeParse(req.body);
  if (!id.success || !body.success) {
    sendError(res, 'Invalid template update', 400, 'VALIDATION');
    return;
  }
  try {
    const template = await updateQuestionTemplate(id.data, body.data);
    if (!template) {
      sendError(res, 'Template not found', 404);
      return;
    }
    sendSuccess(res, template);
  } catch (error) {
    const validationError = error instanceof QuestionTemplateValidationError;
    sendError(
      res,
      isUniqueViolation(error) ? 'A template with this mode and name already exists' : errorMessage(error),
      isUniqueViolation(error) ? 409 : validationError ? 400 : 500,
      validationError ? 'VALIDATION' : undefined
    );
  }
});

adminQuestionEngineRouter.delete('/templates/:id', async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) {
    sendError(res, 'Invalid template id', 400, 'VALIDATION');
    return;
  }
  try {
    if (!(await deleteQuestionTemplate(id.data))) {
      sendError(res, 'Template not found', 404);
      return;
    }
    sendSuccess(res, { deleted: true });
  } catch (error) {
    sendError(res, errorMessage(error), 500);
  }
});
