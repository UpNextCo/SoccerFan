import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, sendError, sendSuccess } from '../middleware/auth.js';
import {
  createVsChallenge,
  getActiveVsChallenge,
  getVsChallenge,
  joinVsChallenge,
  giveUpVsHotseat,
  lockVsPick,
  nameVsHotseat,
  startVsChallenge,
  submitVsChallenge,
  VsError,
} from '../services/vsService.js';

const VS_MODE_ID_VALUES = ['draft_master', 'back_yourself', 'darts_501', 'target_man'] as const;

export const vsRouter = Router();

function handleVsError(res: import('express').Response, err: unknown, fallback: string): void {
  if (err instanceof VsError) {
    sendError(res, err.message, err.status, err.code);
    return;
  }
  sendError(res, err instanceof Error ? err.message : fallback, 500);
}

const createSchema = z.object({
  modeId: z.enum(VS_MODE_ID_VALUES),
});

vsRouter.post('/create', requireAuth, async (req, res) => {
  const parsed = createSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    sendError(res, 'Pick Draft XI, Back Yourself, Football 501 or Target Man', 400);
    return;
  }
  try {
    sendSuccess(res, await createVsChallenge(req.auth!.userId, parsed.data.modeId), 201);
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

vsRouter.post('/:id/start', requireAuth, async (req, res) => {
  try {
    sendSuccess(res, await startVsChallenge(req.auth!.userId, String(req.params.id)));
  } catch (err) {
    handleVsError(res, err, 'Failed to start challenge');
  }
});

const lockSchema = z.object({
  slotId: z.string().min(1),
  constraintId: z.string().min(1),
  playerId: z.string().min(1),
});

vsRouter.post('/:id/lock', requireAuth, async (req, res) => {
  const parsed = lockSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 'Invalid request body', 400);
    return;
  }
  try {
    sendSuccess(res, await lockVsPick(req.auth!.userId, String(req.params.id), parsed.data));
  } catch (err) {
    handleVsError(res, err, 'Failed to lock pick');
  }
});

const nameSchema = z.object({
  playerId: z.string().min(1),
});

vsRouter.post('/:id/name', requireAuth, async (req, res) => {
  const parsed = nameSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 'Invalid request body', 400);
    return;
  }
  try {
    sendSuccess(res, await nameVsHotseat(req.auth!.userId, String(req.params.id), parsed.data.playerId));
  } catch (err) {
    handleVsError(res, err, 'Failed to name player');
  }
});

vsRouter.post('/:id/giveup', requireAuth, async (req, res) => {
  try {
    sendSuccess(res, await giveUpVsHotseat(req.auth!.userId, String(req.params.id)));
  } catch (err) {
    handleVsError(res, err, 'Failed to give up');
  }
});

vsRouter.get('/:id', requireAuth, async (req, res) => {
  try {
    sendSuccess(res, await getVsChallenge(req.auth!.userId, String(req.params.id)));
  } catch (err) {
    handleVsError(res, err, 'Failed to load challenge');
  }
});

const pickSchema = z.object({
  slotId: z.string(),
  constraintId: z.string(),
  playerId: z.string(),
});

const submitSchema = z.object({
  answer: z.unknown().optional(),
  picks: z.array(pickSchema).optional(),
});

vsRouter.post('/:id/submit', requireAuth, async (req, res) => {
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 'Invalid request body', 400);
    return;
  }
  if (parsed.data.answer == null && parsed.data.picks == null) {
    sendError(res, 'Invalid request body', 400);
    return;
  }
  try {
    sendSuccess(
      res,
      await submitVsChallenge(req.auth!.userId, String(req.params.id), parsed.data.answer, parsed.data.picks)
    );
  } catch (err) {
    handleVsError(res, err, 'Failed to submit');
  }
});
