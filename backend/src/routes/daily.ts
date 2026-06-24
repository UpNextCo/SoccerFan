import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, sendError, sendSuccess } from '../middleware/auth.js';
import { completeDaily, getDailyBundle, getDailyPuzzle, validateGuess, validateTowerAnswer, validateOneMoreAnswer } from '../services/dailyService.js';

export const dailyRouter = Router();

dailyRouter.get('/today', requireAuth, async (req, res) => {
  try {
    const bundle = await getDailyBundle(req.auth!.userId);
    sendSuccess(res, bundle);
  } catch (err) {
    sendError(res, err instanceof Error ? err.message : 'Failed to load daily', 500);
  }
});

dailyRouter.get('/puzzle/:modeId', requireAuth, async (req, res) => {
  try {
    const date = typeof req.query.date === 'string' ? req.query.date : new Date().toISOString().slice(0, 10);
    const puzzle = await getDailyPuzzle(date, String(req.params.modeId));
    sendSuccess(res, puzzle);
  } catch (err) {
    sendError(res, err instanceof Error ? err.message : 'Failed to load puzzle', 404);
  }
});

const completeSchema = z.object({
  modeId: z.string(),
  date: z.string(),
  score: z.number(),
  guesses: z.number(),
  won: z.boolean(),
  shareGrid: z.string(),
});

dailyRouter.post('/complete', requireAuth, async (req, res) => {
  const parsed = completeSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 'Invalid request body', 400);
    return;
  }

  try {
    const result = await completeDaily(req.auth!.userId, parsed.data);
    sendSuccess(res, result);
  } catch (err) {
    sendError(res, err instanceof Error ? err.message : 'Failed to complete', 500);
  }
});

const guessSchema = z.object({
  date: z.string(),
  modeId: z.string(),
  playerId: z.string().uuid(),
});

dailyRouter.post('/guess', requireAuth, async (req, res) => {
  const parsed = guessSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 'Invalid request body', 400);
    return;
  }

  try {
    const result = await validateGuess(
      parsed.data.date,
      parsed.data.modeId,
      parsed.data.playerId
    );
    sendSuccess(res, result);
  } catch (err) {
    sendError(res, err instanceof Error ? err.message : 'Guess failed', 400);
  }
});

const towerSchema = z.object({
  date: z.string(),
  floor: z.number().int().min(1),
  answerType: z.enum(['player', 'club', 'country']),
  value: z.string().min(1),
});

dailyRouter.post('/tower/validate', requireAuth, async (req, res) => {
  const parsed = towerSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 'Invalid request body', 400);
    return;
  }

  try {
    const correct = await validateTowerAnswer(
      parsed.data.date,
      parsed.data.floor,
      parsed.data.answerType,
      parsed.data.value
    );
    sendSuccess(res, { correct });
  } catch (err) {
    sendError(res, err instanceof Error ? err.message : 'Tower validation failed', 400);
  }
});

const oneMoreSchema = z.object({
  date: z.string(),
  playerId: z.string().uuid(),
});

dailyRouter.post('/onemore/validate', requireAuth, async (req, res) => {
  const parsed = oneMoreSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 'Invalid request body', 400);
    return;
  }

  try {
    const result = await validateOneMoreAnswer(parsed.data.date, parsed.data.playerId);
    sendSuccess(res, result);
  } catch (err) {
    sendError(res, err instanceof Error ? err.message : 'One More validation failed', 400);
  }
});
