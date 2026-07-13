import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../middleware/adminAuth.js';
import { sendError, sendSuccess } from '../middleware/auth.js';
import { validateAdminPuzzleDraft } from '../services/adminDraftValidation.js';
import {
  clubChainLink,
  recomputeClubChainShortestPath,
} from '../services/clubChainGenerator.js';

export const adminPuzzleValidationRouter = Router();
adminPuzzleValidationRouter.use(requireAdmin);

const uuid = z.string().uuid();
const validateBody = z.object({
  modeId: z.string().min(1).max(80),
  puzzleJson: z.unknown(),
  answerJson: z.unknown().nullable().optional(),
});

adminPuzzleValidationRouter.post('/validate', async (req, res) => {
  const body = validateBody.safeParse(req.body);
  if (!body.success) {
    sendError(res, 'Invalid validation body', 400, 'VALIDATION');
    return;
  }
  try {
    sendSuccess(res, await validateAdminPuzzleDraft(
      body.data.modeId,
      body.data.puzzleJson,
      body.data.answerJson ?? null
    ));
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : String(error), 500);
  }
});

adminPuzzleValidationRouter.post('/club-chain/recompute', async (req, res) => {
  const body = z.object({
    startPlayerId: uuid,
    targetPlayerId: uuid,
  }).refine((value) => value.startPlayerId !== value.targetPlayerId, {
    message: 'Endpoints must be distinct',
  }).safeParse(req.body);
  if (!body.success) {
    sendError(res, 'Invalid Club Chain endpoints', 400, 'VALIDATION');
    return;
  }
  try {
    const path = await recomputeClubChainShortestPath(
      body.data.startPlayerId,
      body.data.targetPlayerId
    );
    if (!path) {
      sendError(res, 'No path found in the Club Chain generator graph', 404, 'NO_PATH');
      return;
    }
    sendSuccess(res, path);
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : String(error), 500);
  }
});

adminPuzzleValidationRouter.post('/club-chain/validate-path', async (req, res) => {
  const body = z.object({
    playerIds: z.array(uuid).min(2).max(20),
  }).safeParse(req.body);
  if (!body.success) {
    sendError(res, 'Invalid Club Chain path', 400, 'VALIDATION');
    return;
  }
  try {
    const links = await Promise.all(body.data.playerIds.slice(0, -1).map(
      (playerId, index) => clubChainLink(playerId, body.data.playerIds[index + 1]!)
    ));
    sendSuccess(res, {
      valid: links.every((link) => link !== null),
      links: links.map((link, index) => ({
        fromPlayerId: body.data.playerIds[index]!,
        toPlayerId: body.data.playerIds[index + 1]!,
        link,
      })),
    });
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : String(error), 500);
  }
});
