import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../middleware/adminAuth.js';
import { sendError, sendSuccess } from '../middleware/auth.js';
import {
  getPlayerReviewCounts,
  getRandomPlayerDossier,
  loadPlayerDossier,
  setPlayerReview,
  type PlayerReviewPool,
} from '../services/adminPlayerReview.js';

export const adminPlayerReviewRouter = Router();
adminPlayerReviewRouter.use(requireAdmin);

const uuidSchema = z.string().uuid();
const poolSchema = z.enum(['unreviewed', 'flagged', 'approved', 'any']).default('unreviewed');

adminPlayerReviewRouter.get('/counts', async (_req, res) => {
  try {
    sendSuccess(res, await getPlayerReviewCounts());
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : 'Failed to load review counts', 500);
  }
});

adminPlayerReviewRouter.get('/random', async (req, res) => {
  const pool = poolSchema.safeParse(req.query.pool ?? 'unreviewed');
  if (!pool.success) {
    sendError(res, 'Invalid pool', 400, 'VALIDATION_ERROR');
    return;
  }
  const exclude = String(req.query.exclude ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => uuidSchema.safeParse(id).success);
  try {
    sendSuccess(res, await getRandomPlayerDossier(pool.data as PlayerReviewPool, exclude));
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : 'Failed to pick a player', 500);
  }
});

adminPlayerReviewRouter.get('/:playerId', async (req, res) => {
  const playerId = uuidSchema.safeParse(req.params.playerId);
  if (!playerId.success) {
    sendError(res, 'Invalid player id', 400, 'VALIDATION_ERROR');
    return;
  }
  try {
    const [dossier, counts] = await Promise.all([
      loadPlayerDossier(playerId.data),
      getPlayerReviewCounts(),
    ]);
    if (!dossier) {
      sendError(res, 'Player not found', 404, 'NOT_FOUND');
      return;
    }
    sendSuccess(res, { dossier, counts });
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : 'Failed to load player dossier', 500);
  }
});

adminPlayerReviewRouter.post('/:playerId/review', async (req, res) => {
  const playerId = uuidSchema.safeParse(req.params.playerId);
  if (!playerId.success) {
    sendError(res, 'Invalid player id', 400, 'VALIDATION_ERROR');
    return;
  }
  const parsed = z
    .object({
      status: z.enum(['approved', 'flagged', 'pending']),
      note: z.string().max(2000).optional().nullable(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 'Invalid review body', 400, 'VALIDATION_ERROR');
    return;
  }
  if (parsed.data.status === 'flagged' && !parsed.data.note?.trim()) {
    sendError(res, 'Add a short note when flagging a player.', 400, 'VALIDATION_ERROR');
    return;
  }
  try {
    const dossier = await setPlayerReview({
      playerId: playerId.data,
      status: parsed.data.status,
      note: parsed.data.note,
      reviewedBy: req.adminName || 'ops',
    });
    const counts = await getPlayerReviewCounts();
    sendSuccess(res, { dossier, counts });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save review';
    sendError(res, message, message === 'Player not found.' ? 404 : 400);
  }
});
