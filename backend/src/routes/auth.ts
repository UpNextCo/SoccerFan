import { Router } from 'express';
import { z } from 'zod';
import { authenticateWithApple, deleteUserAccount, getUserProfile } from '../services/authService.js';
import { requireAuth, sendError, sendSuccess } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export const authRouter = Router();

const appleSchema = z.object({
  identityToken: z.string().min(1),
  displayName: z.string().optional(),
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
  const profile = await getUserProfile(req.auth!.userId);
  if (!profile) {
    sendError(res, 'User not found', 404, 'NOT_FOUND');
    return;
  }
  sendSuccess(res, profile);
});

authRouter.delete('/me', requireAuth, async (req, res) => {
  await deleteUserAccount(req.auth!.userId);
  sendSuccess(res, { deleted: true });
});
