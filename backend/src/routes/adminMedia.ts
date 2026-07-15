import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../middleware/adminAuth.js';
import { sendError, sendSuccess } from '../middleware/auth.js';
import { createOpsImage } from '../services/opsMedia.js';

export const adminMediaRouter = Router();
adminMediaRouter.use(requireAdmin);

adminMediaRouter.post('/', async (req, res) => {
  const parsed = z
    .object({
      fileBase64: z.string().min(1),
      mimeType: z.string().min(1).max(100),
      filename: z.string().max(255).optional(),
    })
    .strict()
    .safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 'Invalid image upload body.', 400);
    return;
  }
  try {
    const media = await createOpsImage({
      fileBase64: parsed.data.fileBase64,
      suppliedMimeType: parsed.data.mimeType,
      filename: parsed.data.filename,
      createdBy: req.adminName || 'ops',
    });
    sendSuccess(res, media);
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : 'Image upload failed.', 400);
  }
});
