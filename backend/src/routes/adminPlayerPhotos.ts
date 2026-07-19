import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../middleware/adminAuth.js';
import { sendError, sendSuccess } from '../middleware/auth.js';
import {
  clearAdminPlayerPhoto,
  getAdminPlayerPhoto,
  listAdminPlayerPhotoOverrides,
  setAdminPlayerPhoto,
} from '../services/adminPlayerPhoto.js';

export const adminPlayerPhotosRouter = Router();
adminPlayerPhotosRouter.use(requireAdmin);

const uuidSchema = z.string().uuid();

adminPlayerPhotosRouter.get('/overrides', async (req, res) => {
  const limit = Number(req.query.limit ?? 40);
  try {
    sendSuccess(res, {
      players: await listAdminPlayerPhotoOverrides(Number.isFinite(limit) ? limit : 40),
    });
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : 'Failed to list photo overrides', 500);
  }
});

adminPlayerPhotosRouter.get('/:playerId', async (req, res) => {
  const playerId = uuidSchema.safeParse(req.params.playerId);
  if (!playerId.success) {
    sendError(res, 'Invalid player id', 400, 'VALIDATION_ERROR');
    return;
  }
  try {
    const player = await getAdminPlayerPhoto(playerId.data);
    if (!player) {
      sendError(res, 'Player not found', 404, 'NOT_FOUND');
      return;
    }
    sendSuccess(res, player);
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : 'Failed to load player photo', 500);
  }
});

adminPlayerPhotosRouter.put('/:playerId', async (req, res) => {
  const playerId = uuidSchema.safeParse(req.params.playerId);
  if (!playerId.success) {
    sendError(res, 'Invalid player id', 400, 'VALIDATION_ERROR');
    return;
  }
  const parsed = z
    .object({
      fileBase64: z.string().min(1),
      mimeType: z.string().min(1).max(100),
      filename: z.string().max(255).optional(),
    })
    .strict()
    .safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 'Invalid image upload body.', 400, 'VALIDATION_ERROR');
    return;
  }
  try {
    const player = await setAdminPlayerPhoto({
      playerId: playerId.data,
      fileBase64: parsed.data.fileBase64,
      mimeType: parsed.data.mimeType,
      filename: parsed.data.filename,
      createdBy: req.adminName || 'ops',
    });
    sendSuccess(res, player);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save player photo';
    sendError(res, message, message === 'Player not found.' ? 404 : 400);
  }
});

adminPlayerPhotosRouter.delete('/:playerId', async (req, res) => {
  const playerId = uuidSchema.safeParse(req.params.playerId);
  if (!playerId.success) {
    sendError(res, 'Invalid player id', 400, 'VALIDATION_ERROR');
    return;
  }
  try {
    const player = await clearAdminPlayerPhoto(playerId.data);
    sendSuccess(res, player);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to clear player photo';
    sendError(res, message, message === 'Player not found.' ? 404 : 400);
  }
});
