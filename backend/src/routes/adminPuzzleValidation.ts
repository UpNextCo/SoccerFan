import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../middleware/adminAuth.js';
import { sendError, sendSuccess } from '../middleware/auth.js';
import { validateAdminPuzzleDraft } from '../services/adminDraftValidation.js';
import {
  clubChainLink,
  recomputeClubChainShortestPath,
} from '../services/clubChainGenerator.js';
import {
  generateAdminGolfHole,
  generateAdminGolfHoleFromTemplate,
  listAdminGolfTemplates,
  previewAdminGolfRule,
  validateAdminGolfHole,
} from '../services/adminGolfAuthoring.js';
import { towerRuleSchema } from '../services/towerRuleSchema.js';
import {
  adminTargetCategoryOptions,
  previewTargetManCategory,
} from '../services/targetManCategories.js';
import { listDraftCategories } from '../services/battleGenerator.js';
import {
  composeDarts501Formula,
  darts501AuthoringOptions,
  darts501FormulaById,
  parseDarts501Pool,
  previewDarts501Pool,
} from '../services/darts501Generator.js';

export const adminPuzzleValidationRouter = Router();
adminPuzzleValidationRouter.use(requireAdmin);

const uuid = z.string().uuid();
const golfPrompt = z.string().trim().min(1).max(240);
const golfHoleNumber = z.number().int().min(1).max(18);
const golfAnswer = z.object({
  id: uuid,
  name: z.string().trim().min(1).max(160),
  aliases: z.array(z.string().trim().min(1).max(160)).max(30),
  rarity: z.enum(['common', 'uncommon', 'rare', 'ultraRare']),
}).strict();
const authoredGolfHole = z.object({
  id: z.string().trim().min(1).max(160),
  holeNumber: golfHoleNumber,
  par: z.union([z.literal(2), z.literal(3), z.literal(4)]),
  target: z.number().int().min(1).max(4),
  prompt: golfPrompt,
  category: z.string().trim().min(1).max(80),
  answers: z.array(golfAnswer).max(500),
  hints: z.array(z.string().trim().min(1).max(240)).max(10),
  rule: towerRuleSchema.optional(),
  templateId: uuid.optional(),
}).passthrough();
const validateBody = z.object({
  modeId: z.string().min(1).max(80),
  puzzleJson: z.unknown(),
  answerJson: z.unknown().nullable().optional(),
});

adminPuzzleValidationRouter.post('/validate', async (req, res) => {
  const body = validateBody.safeParse(req.body);
  if (!body.success) {
    sendError(res, 'Invalid validation body', 400, 'VALIDATION');
    return;
  }
  try {
    sendSuccess(res, await validateAdminPuzzleDraft(
      body.data.modeId,
      body.data.puzzleJson,
      body.data.answerJson ?? null
    ));
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : String(error), 500);
  }
});

adminPuzzleValidationRouter.get('/target-man/categories', async (_req, res) => {
  try {
    sendSuccess(res, await adminTargetCategoryOptions());
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : String(error), 500);
  }
});

adminPuzzleValidationRouter.post('/target-man/preview', async (req, res) => {
  const body = z.object({
    categoryId: z.string().trim().min(1),
    pool: z.object({
      type: z.enum(['nationality', 'club']),
      nationality: z.string().trim().min(1).optional().nullable(),
      club: z.string().trim().min(1).optional().nullable(),
      teamId: z.number().int().positive().optional().nullable(),
    }).optional().nullable(),
  }).safeParse(req.body);
  if (!body.success) {
    sendError(res, 'Invalid Target Man preview', 400, 'VALIDATION');
    return;
  }
  try {
    const preview = await previewTargetManCategory(body.data.categoryId, body.data.pool);
    if (!preview) {
      sendError(res, 'Unknown Target Man category', 400, 'VALIDATION');
      return;
    }
    sendSuccess(res, preview);
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : String(error), 500);
  }
});

const darts501PoolSchema = z.object({
  kind: z.enum(['nationality', 'league', 'club', 'international']),
  nationality: z.string().trim().min(1).optional(),
  aliases: z.array(z.string().trim().min(1)).optional(),
  leagueId: z.number().int().positive().optional(),
  leagueName: z.string().trim().min(1).optional(),
  club: z.string().trim().min(1).optional(),
  teamId: z.number().int().positive().optional(),
});

adminPuzzleValidationRouter.get('/darts-501/options', async (_req, res) => {
  sendSuccess(res, darts501AuthoringOptions());
});

adminPuzzleValidationRouter.post('/darts-501/preview', async (req, res) => {
  const body = z.object({
    formulaId: z.string().trim().min(1).optional(),
    left: z.string().trim().min(1).optional(),
    op: z.enum(['+', '-']).optional(),
    right: z.string().trim().min(1).optional(),
    pool: darts501PoolSchema.optional(),
  }).safeParse(req.body);
  if (!body.success) {
    sendError(res, 'Invalid Football 501 preview', 400, 'VALIDATION');
    return;
  }
  try {
    const catalog = body.data.formulaId ? darts501FormulaById(body.data.formulaId) : undefined;
    const pool = parseDarts501Pool(body.data.pool);
    const composed =
      body.data.left && body.data.op && body.data.right && pool
        ? composeDarts501Formula({
            left: body.data.left,
            op: body.data.op,
            right: body.data.right,
            pool,
          })
        : null;
    const formula = composed ?? catalog;
    if (!formula) {
      sendError(res, 'Set a main constraint and both formula stats', 400, 'VALIDATION');
      return;
    }
    sendSuccess(res, await previewDarts501Pool(formula));
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : String(error), 500);
  }
});

adminPuzzleValidationRouter.get('/draft/categories', async (_req, res) => {
  try {
    sendSuccess(res, listDraftCategories());
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : String(error), 500);
  }
});

adminPuzzleValidationRouter.post('/club-chain/recompute', async (req, res) => {
  const body = z.object({
    startPlayerId: uuid,
    targetPlayerId: uuid,
  }).refine((value) => value.startPlayerId !== value.targetPlayerId, {
    message: 'Endpoints must be distinct',
  }).safeParse(req.body);
  if (!body.success) {
    sendError(res, 'Invalid Club Chain endpoints', 400, 'VALIDATION');
    return;
  }
  try {
    const path = await recomputeClubChainShortestPath(
      body.data.startPlayerId,
      body.data.targetPlayerId
    );
    if (!path) {
      sendError(res, 'No path found in the Club Chain generator graph', 404, 'NO_PATH');
      return;
    }
    sendSuccess(res, path);
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : String(error), 500);
  }
});

adminPuzzleValidationRouter.post('/club-chain/validate-path', async (req, res) => {
  const body = z.object({
    playerIds: z.array(uuid).min(2).max(20),
  }).safeParse(req.body);
  if (!body.success) {
    sendError(res, 'Invalid Club Chain path', 400, 'VALIDATION');
    return;
  }
  try {
    const links = await Promise.all(body.data.playerIds.slice(0, -1).map(
      (playerId, index) => clubChainLink(playerId, body.data.playerIds[index + 1]!)
    ));
    sendSuccess(res, {
      valid: links.every((link) => link !== null),
      links: links.map((link, index) => ({
        fromPlayerId: body.data.playerIds[index]!,
        toPlayerId: body.data.playerIds[index + 1]!,
        link,
      })),
    });
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : String(error), 500);
  }
});

adminPuzzleValidationRouter.get('/golf/templates', async (req, res) => {
  const query = z.object({
    q: z.string().trim().max(120).optional().default(''),
    limit: z.coerce.number().int().min(1).max(100).optional().default(80),
  }).safeParse(req.query);
  if (!query.success) {
    sendError(res, 'Invalid Golf template query', 400, 'VALIDATION');
    return;
  }
  try {
    sendSuccess(res, await listAdminGolfTemplates(query.data.q, query.data.limit));
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : String(error), 500);
  }
});

adminPuzzleValidationRouter.post('/golf/preview', async (req, res) => {
  const body = z.object({ prompt: golfPrompt, rule: towerRuleSchema }).strict().safeParse(req.body);
  if (!body.success) {
    sendError(res, 'Invalid structured Golf rule', 400, 'VALIDATION');
    return;
  }
  try {
    sendSuccess(res, await previewAdminGolfRule(body.data.prompt, body.data.rule));
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : String(error), 500);
  }
});

adminPuzzleValidationRouter.post('/golf/generate', async (req, res) => {
  const body = z.object({
    prompt: golfPrompt,
    rule: towerRuleSchema,
    holeNumber: golfHoleNumber,
    holeId: z.string().trim().min(1).max(160).optional(),
  }).strict().safeParse(req.body);
  if (!body.success) {
    sendError(res, 'Invalid structured Golf generation body', 400, 'VALIDATION');
    return;
  }
  try {
    sendSuccess(res, await generateAdminGolfHole(body.data));
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : String(error), 500);
  }
});

adminPuzzleValidationRouter.post('/golf/from-template', async (req, res) => {
  const body = z.object({
    templateId: uuid,
    holeNumber: golfHoleNumber,
    promptOverride: golfPrompt.optional(),
  }).strict().safeParse(req.body);
  if (!body.success) {
    sendError(res, 'Invalid Golf template generation body', 400, 'VALIDATION');
    return;
  }
  try {
    sendSuccess(res, await generateAdminGolfHoleFromTemplate(body.data));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendError(res, message, message === 'Golf template not found.' ? 404 : 500);
  }
});

adminPuzzleValidationRouter.post('/golf/validate-hole', async (req, res) => {
  const body = z.object({ hole: authoredGolfHole }).strict().safeParse(req.body);
  if (!body.success) {
    sendError(res, 'Invalid Golf hole', 400, 'VALIDATION');
    return;
  }
  try {
    sendSuccess(res, await validateAdminGolfHole(body.data.hole));
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : String(error), 500);
  }
});
