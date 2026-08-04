import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, sendError, sendSuccess } from '../middleware/auth.js';
import {
  createVsChallenge,
  getActiveVsChallenge,
  getVsChallenge,
  joinVsChallenge,
  submitVsChallenge,
  VsError,
} from '../services/vsService.js';

export const vsRouter = Router();

function handleVsError(res: import('express').Response, err: unknown, fallback: string): void {
  if (err instanceof VsError) {
    sendError(res, err.message, err.status, err.code);
    return;
  }
  sendError(res, err instanceof Error ? err.message : fallback, 500);
}

vsRouter.post('/create', requireAuth, async (req, res) => {
  try {
    sendSuccess(res, await createVsChallenge(req.auth!.userId), 201);
  } catch (err) {
    handleVsError(res, err, 'Failed to create challenge');
  }
});

const joinSchema = z.object({
  code: z.string().min(1).max(16),
});

vsRouter.post('/join', requireAuth, async (req, res) => {
  const parsed = joinSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 'Invalid request body', 400);
    return;
  }
  try {
    sendSuccess(res, await joinVsChallenge(req.auth!.userId, parsed.data.code));
  } catch (err) {
    handleVsError(res, err, 'Failed to join challenge');
  }
});

vsRouter.get('/active', requireAuth, async (req, res) => {
  try {
    sendSuccess(res, await getActiveVsChallenge(req.auth!.userId));
  } catch (err) {
    handleVsError(res, err, 'Failed to load challenge');
  }
});

vsRouter.get('/:id', requireAuth, async (req, res) => {
  try {
    sendSuccess(res, await getVsChallenge(req.auth!.userId, String(req.params.id)));
  } catch (err) {
    handleVsError(res, err, 'Failed to load challenge');
  }
});

const submitSchema = z.object({
  picks: z.array(
    z.object({
      slotId: z.string(),
      constraintId: z.string(),
      playerId: z.string(),
    })
  ),
});

vsRouter.post('/:id/submit', requireAuth, async (req, res) => {
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 'Invalid request body', 400);
    return;
  }
  try {
    sendSuccess(res, await submitVsChallenge(req.auth!.userId, String(req.params.id), parsed.data.picks));
  } catch (err) {
    handleVsError(res, err, 'Failed to submit');
  }
});
