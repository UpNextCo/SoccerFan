import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, sendError, sendSuccess } from '../middleware/auth.js';
import { completeDaily, getDailyBundle, getDailyPuzzle, guessWhoHint, revealGuessWhoAnswer, validateGuess, validateOneMoreAnswer } from '../services/dailyService.js';

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

// Battle Mode: players who played for `club` at `position`, with their category total.
const battlePlayersSchema = z.object({
  categoryId: z.string(),
  club: z.string(),
  position: z.string(),
  q: z.string().default(''),
});
dailyRouter.post('/battle/players', requireAuth, async (req, res) => {
  const parsed = battlePlayersSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 'Invalid request body', 400);
    return;
  }
  try {
    const { battlePlayers } = await import('../services/battleGenerator.js');
    const { categoryId, club, position, q } = parsed.data;
    sendSuccess(res, await battlePlayers(categoryId, club, position, q));
  } catch (err) {
    sendError(res, err instanceof Error ? err.message : 'Failed to load players', 400);
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

// Reveal the answer player after a lost Guess Who game.
dailyRouter.get('/guesswho/answer', requireAuth, async (req, res) => {
  try {
    const date = typeof req.query.date === 'string' ? req.query.date : new Date().toISOString().slice(0, 10);
    sendSuccess(res, await revealGuessWhoAnswer(date));
  } catch (err) {
    sendError(res, err instanceof Error ? err.message : 'Failed to reveal answer', 404);
  }
});

// Reveal one not-yet-known attribute as a Guess Who hint.
const hintSchema = z.object({ date: z.string(), known: z.array(z.string()).default([]) });
dailyRouter.post('/guesswho/hint', requireAuth, async (req, res) => {
  const parsed = hintSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 'Invalid request body', 400);
    return;
  }
  try {
    sendSuccess(res, await guessWhoHint(parsed.data.date, parsed.data.known));
  } catch (err) {
    sendError(res, err instanceof Error ? err.message : 'Hint failed', 400);
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
