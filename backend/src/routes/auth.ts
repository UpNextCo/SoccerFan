import { Router } from 'express';
import { z } from 'zod';
import {
  authenticateWithApple,
  deleteUserAccount,
  getUserAvatarJpeg,
  getUserProfile,
  setUserAvatar,
  updateUserProfile,
} from '../services/authService.js';
import { requireAuth, sendError, sendSuccess } from '../middleware/auth.js';

export const authRouter = Router();

const appleSchema = z.object({
  identityToken: z.string().min(1),
  displayName: z.string().optional(),
});

const profilePatchSchema = z.object({
  displayName: z.string().min(1).max(40).optional(),
  favoriteTeamId: z.number().int().nullable().optional(),
});

const avatarPutSchema = z.object({
  /** Base64-encoded JPEG (no data: prefix). */
  jpegBase64: z.string().min(1).optional(),
  /** Clear the avatar when true. */
  clear: z.boolean().optional(),
});

authRouter.post('/apple', async (req, res) => {
  const parsed = appleSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 'Invalid request body', 400, 'VALIDATION_ERROR');
    return;
  }

  try {
    const result = await authenticateWithApple(
      parsed.data.identityToken,
      parsed.data.displayName
    );
    sendSuccess(res, result);
  } catch (err) {
    sendError(res, err instanceof Error ? err.message : 'Auth failed', 401, 'AUTH_FAILED');
  }
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const clientDate = typeof req.query.date === 'string' ? req.query.date : undefined;
  const profile = await getUserProfile(req.auth!.userId, clientDate);
  if (!profile) {
    sendError(res, 'User not found', 404, 'NOT_FOUND');
    return;
  }
  sendSuccess(res, profile);
});

authRouter.patch('/me', requireAuth, async (req, res) => {
  const parsed = profilePatchSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 'Invalid request body', 400, 'VALIDATION_ERROR');
    return;
  }
  if (parsed.data.displayName === undefined && parsed.data.favoriteTeamId === undefined) {
    sendError(res, 'Nothing to update', 400, 'VALIDATION_ERROR');
    return;
  }
  try {
    const clientDate = typeof req.query.date === 'string' ? req.query.date : undefined;
    const profile = await updateUserProfile(req.auth!.userId, parsed.data, clientDate);
    if (!profile) {
      sendError(res, 'User not found', 404, 'NOT_FOUND');
      return;
    }
    sendSuccess(res, profile);
  } catch (err) {
    sendError(res, err instanceof Error ? err.message : 'Update failed', 400);
  }
});

authRouter.put('/me/avatar', requireAuth, async (req, res) => {
  const parsed = avatarPutSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 'Invalid request body', 400, 'VALIDATION_ERROR');
    return;
  }
  try {
    let jpeg: Buffer | null = null;
    if (parsed.data.clear) {
      jpeg = null;
    } else if (parsed.data.jpegBase64) {
      jpeg = Buffer.from(parsed.data.jpegBase64, 'base64');
    } else {
      sendError(res, 'Provide jpegBase64 or clear: true', 400, 'VALIDATION_ERROR');
      return;
    }
    const profile = await setUserAvatar(req.auth!.userId, jpeg);
    if (!profile) {
      sendError(res, 'User not found', 404, 'NOT_FOUND');
      return;
    }
    sendSuccess(res, profile);
  } catch (err) {
    sendError(res, err instanceof Error ? err.message : 'Avatar upload failed', 400);
  }
});

authRouter.delete('/me', requireAuth, async (req, res) => {
  await deleteUserAccount(req.auth!.userId);
  sendSuccess(res, { deleted: true });
});

/** Public avatar image handler — mounted at GET /avatars/:userId on the app. */
export async function serveAvatar(
  req: { params: { userId: string } },
  res: import('express').Response
): Promise<void> {
  const userId = req.params.userId;
  if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) {
    res.status(404).end();
    return;
  }
  const jpeg = await getUserAvatarJpeg(userId);
  if (!jpeg) {
    res.status(404).end();
    return;
  }
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(jpeg);
}