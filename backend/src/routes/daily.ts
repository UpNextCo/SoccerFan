import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, sendError, sendSuccess } from '../middleware/auth.js';
import {
  completeDaily,
  getDailyBundle,
  getDailyPuzzle,
  guessWhoHint,
  revealGuessWhoAnswer,
  startLastManStanding,
  validateBackYourselfGuess,
  validateClubChainLink,
  validateGuess,
  validateLastManStandingCheck,
} from '../services/dailyService.js';
import { InvalidCompletionAnswerError } from '../services/dailyScoring.js';

export const dailyRouter = Router();

dailyRouter.get('/today', requireAuth, async (req, res) => {
  try {
    const clientDate = typeof req.query.date === 'string' ? req.query.date : undefined;
    const bundle = await getDailyBundle(req.auth!.userId, clientDate);
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

// Battle Mode: players at `position` with their category total, flagged by whether they satisfy the
// slot's constraint chip (club / league / nationality / nat×league / nat×club).
const battlePlayersSchema = z.object({
  categoryId: z.string(),
  constraint: z.object({
    type: z.enum(['club', 'league', 'nationality', 'nat_league', 'nat_club']),
    club: z.string().nullable().optional(),
    leagueId: z.number().int().nullable().optional(),
    nationality: z.string().nullable().optional(),
  }),
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
    const { categoryId, constraint, position, q } = parsed.data;
    sendSuccess(res, await battlePlayers(categoryId, constraint, position, q));
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
  // Optional per-mode answer inputs (ranking order, picks, slot fills…) so the server can recompute
  // the authoritative score. Shape is validated per-mode in dailyScoring; unknown here on purpose.
  answer: z.unknown().optional(),
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
    sendError(
      res,
      err instanceof Error ? err.message : 'Failed to complete',
      err instanceof InvalidCompletionAnswerError ? 400 : 500
    );
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

// Club Chain: validate a teammate link between two players (shared club + overlapping seasons).
// `targetId` optionally also returns whether the candidate connects to the puzzle's target, so a
// winning move is detected in one round-trip.
const clubChainLinkSchema = z.object({
  fromId: z.string().uuid(),
  toId: z.string().uuid(),
  targetId: z.string().uuid().optional(),
});
dailyRouter.post('/clubchain/link', requireAuth, async (req, res) => {
  const parsed = clubChainLinkSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 'Invalid request body', 400);
    return;
  }
  try {
    const result = await validateClubChainLink(parsed.data.fromId, parsed.data.toId, parsed.data.targetId);
    sendSuccess(res, result);
  } catch (err) {
    sendError(res, err instanceof Error ? err.message : 'Club Chain validation failed', 400);
  }
});

const darts501ThrowSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  playerId: z.string().uuid(),
  alreadyUsedIds: z.array(z.string().uuid()).optional(),
});
dailyRouter.post('/darts501/throw', requireAuth, async (req, res) => {
  const parsed = darts501ThrowSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 'Invalid request body', 400);
    return;
  }
  try {
    const { evaluateDarts501Throw } = await import('../services/darts501Generator.js');
    sendSuccess(res, await evaluateDarts501Throw(parsed.data));
  } catch (err) {
    sendError(res, err instanceof Error ? err.message : 'Football 501 throw failed', 400);
  }
});

const darts501CheckoutsSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  remaining: z.number().int(),
  alreadyUsedIds: z.array(z.string().uuid()).optional(),
});
dailyRouter.post('/darts501/checkouts', requireAuth, async (req, res) => {
  const parsed = darts501CheckoutsSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 'Invalid request body', 400);
    return;
  }
  try {
    const { countDarts501Checkouts } = await import('../services/darts501Generator.js');
    sendSuccess(res, await countDarts501Checkouts(parsed.data));
  } catch (err) {
    sendError(res, err instanceof Error ? err.message : 'Football 501 checkouts failed', 400);
  }
});

const backYourselfGuessSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  playerId: z.string().uuid(),
  alreadyNamedIds: z.array(z.string().uuid()).optional(),
});
dailyRouter.post('/backyourself/guess', requireAuth, async (req, res) => {
  const parsed = backYourselfGuessSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 'Invalid request body', 400);
    return;
  }
  try {
    const result = await validateBackYourselfGuess(parsed.data);
    sendSuccess(res, result);
  } catch (err) {
    sendError(res, err instanceof Error ? err.message : 'Back Yourself validation failed', 400);
  }
});

const oneMoreStartSchema = z.object({
  date: z.string(),
  resumePicks: z.array(z.string()).optional(),
});
dailyRouter.post('/onemore/start', requireAuth, async (req, res) => {
  const parsed = oneMoreStartSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 'Invalid request body', 400);
    return;
  }
  try {
    const { startOneMoreRun } = await import('../services/oneMoreCheck.js');
    sendSuccess(
      res,
      await startOneMoreRun(req.auth!.userId, parsed.data.date, parsed.data.resumePicks ?? [])
    );
  } catch (err) {
    sendError(res, err instanceof Error ? err.message : 'Failed to start One More', 400);
  }
});

const oneMoreCheckSchema = z.object({
  date: z.string(),
  token: z.string().min(1),
  optionId: z.string().min(1),
});
dailyRouter.post('/onemore/check', requireAuth, async (req, res) => {
  const parsed = oneMoreCheckSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 'Invalid request body', 400);
    return;
  }
  try {
    const { submitOneMorePick } = await import('../services/oneMoreCheck.js');
    sendSuccess(
      res,
      await submitOneMorePick(
        req.auth!.userId,
        parsed.data.date,
        parsed.data.token,
        parsed.data.optionId
      )
    );
  } catch (err) {
    sendError(res, err instanceof Error ? err.message : 'Check failed', 400);
  }
});

const lmsStartSchema = z.object({
  date: z.string(),
  /** Prior correct option ids (in order) when resuming a mid-game run. */
  resumePicks: z.array(z.string()).optional(),
});
dailyRouter.post('/lms/start', requireAuth, async (req, res) => {
  const parsed = lmsStartSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 'Invalid request body', 400);
    return;
  }
  try {
    const result = await startLastManStanding(
      req.auth!.userId,
      parsed.data.date,
      parsed.data.resumePicks ?? []
    );
    sendSuccess(res, result);
  } catch (err) {
    sendError(res, err instanceof Error ? err.message : 'Failed to start LMS run', 400);
  }
});

const lmsCheckSchema = z.object({
  date: z.string(),
  token: z.string().min(1),
  optionId: z.string().min(1),
});
dailyRouter.post('/lms/check', requireAuth, async (req, res) => {
  const parsed = lmsCheckSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 'Invalid request body', 400);
    return;
  }
  try {
    const result = await validateLastManStandingCheck(
      req.auth!.userId,
      parsed.data.date,
      parsed.data.token,
      parsed.data.optionId
    );
    sendSuccess(res, result);
  } catch (err) {
    sendError(res, err instanceof Error ? err.message : 'Check failed', 400);
  }
});

