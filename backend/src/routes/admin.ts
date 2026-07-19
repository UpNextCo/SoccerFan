import { z } from 'zod';
import { Router } from 'express';
import {
  checkAdminPassword,
  clearAdminSessionCookie,
  createAdminSessionToken,
  requireAdmin,
  setAdminSessionCookie,
} from '../middleware/adminAuth.js';
import { sendError, sendSuccess } from '../middleware/auth.js';
import {
  generateOnePuzzle,
  getMonthMatrix,
  getPuzzleForAdmin,
  OPS_PLAYABLE_MODES,
  savePuzzleForAdmin,
  setMonthStatus,
  setPuzzleStatus,
} from '../services/puzzleOps.js';
import { validatePuzzlePayload } from '../services/adminPuzzleValidation.js';
import { enrichAdminClubChainPuzzle, enrichAdminGolfPuzzle } from '../services/adminPuzzleEnrich.js';
import {
  adminSearchLeagues,
  adminSearchNationalities,
  adminSearchPlayers,
  adminSearchTeams,
  resolveAdminBingoPlayer,
  resolveAdminGolfAnswer,
  resolveAdminPlayer,
  resolveAdminTeam,
} from '../services/adminEntitySearch.js';
import { adminQuestionEngineRouter } from './adminQuestionEngine.js';
import { adminPuzzleValidationRouter } from './adminPuzzleValidation.js';
import { adminMonthGenerationRouter } from './adminMonthGeneration.js';
import { adminMediaRouter } from './adminMedia.js';

export const adminRouter = Router();
adminRouter.use('/question-engine', adminQuestionEngineRouter);
adminRouter.use('/validation', adminPuzzleValidationRouter);
adminRouter.use('/month-generation', adminMonthGenerationRouter);
adminRouter.use('/media', adminMediaRouter);

adminRouter.post('/login', (req, res) => {
  const body = z
    .object({
      password: z.string().min(1),
      name: z.string().max(64).optional(),
    })
    .safeParse(req.body);
  if (!body.success) {
    sendError(res, 'Invalid body', 400);
    return;
  }
  if (!process.env.ADMIN_PASSWORD) {
    sendError(res, 'Admin not configured', 503, 'ADMIN_DISABLED');
    return;
  }
  if (!checkAdminPassword(body.data.password)) {
    sendError(res, 'Invalid password', 401, 'BAD_PASSWORD');
    return;
  }
  const token = createAdminSessionToken(body.data.name);
  setAdminSessionCookie(res, token);
  sendSuccess(res, { ok: true, name: body.data.name || 'ops' });
});

adminRouter.post('/logout', (_req, res) => {
  clearAdminSessionCookie(res);
  sendSuccess(res, { ok: true });
});

adminRouter.get('/me', requireAdmin, (req, res) => {
  sendSuccess(res, { name: req.adminName || 'ops' });
});

adminRouter.get('/month', requireAdmin, async (req, res) => {
  const yearMonth = String(req.query.yearMonth || '');
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
    sendError(res, 'yearMonth must be YYYY-MM', 400);
    return;
  }
  try {
    const matrix = await getMonthMatrix(yearMonth);
    sendSuccess(res, matrix);
  } catch (err) {
    sendError(res, err instanceof Error ? err.message : String(err), 500);
  }
});

adminRouter.post('/month/generate', requireAdmin, async (req, res) => {
  sendError(
    res,
    'This unsafe bulk generation endpoint has been removed. Use POST /admin/api/month-generation/runs.',
    410,
    'MONTH_GENERATION_ENDPOINT_REMOVED'
  );
});

adminRouter.post('/month/lock', requireAdmin, async (req, res) => {
  const body = z
    .object({
      yearMonth: z.string().regex(/^\d{4}-\d{2}$/),
      note: z.string().max(500).optional(),
    })
    .safeParse(req.body);
  if (!body.success) {
    sendError(res, 'Invalid body', 400);
    return;
  }
  const result = await setMonthStatus(body.data.yearMonth, 'locked', body.data.note);
  if (result.error) {
    sendError(res, result.error, 400, 'VALIDATION', { issues: result.issues ?? [], invalid: result.invalid ?? [] });
    return;
  }
  sendSuccess(res, result);
});

adminRouter.post('/month/unlock', requireAdmin, async (req, res) => {
  const body = z
    .object({
      yearMonth: z.string().regex(/^\d{4}-\d{2}$/),
      note: z.string().max(500).optional(),
    })
    .safeParse(req.body);
  if (!body.success) {
    sendError(res, 'Invalid body', 400);
    return;
  }
  const result = await setMonthStatus(body.data.yearMonth, 'generated', body.data.note);
  sendSuccess(res, result);
});

adminRouter.get('/puzzle', requireAdmin, async (req, res) => {
  const date = String(req.query.date || '');
  const modeId = String(req.query.modeId || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !modeId) {
    sendError(res, 'date and modeId required', 400);
    return;
  }
  const row = await getPuzzleForAdmin(date, modeId);
  if (!row) {
    sendError(res, 'Not found', 404);
    return;
  }
  const puzzleJson =
    modeId === 'football_golf'
      ? await enrichAdminGolfPuzzle(row.puzzleJson)
      : modeId === 'club_chain'
        ? await enrichAdminClubChainPuzzle(row.puzzleJson)
        : row.puzzleJson;
  sendSuccess(res, {
    id: row.id,
    date: row.date,
    modeId: row.modeId,
    status: row.status,
    puzzleJson,
    answerJson: row.answerJson,
    contentHash: row.contentHash,
    reviewNote: row.reviewNote,
    reviewedAt: row.reviewedAt,
    createdAt: row.createdAt,
  });
});

adminRouter.put('/puzzle', requireAdmin, async (req, res) => {
  const body = z
    .object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      modeId: z.string().min(1),
      puzzleJson: z.unknown(),
      answerJson: z.unknown().nullable().optional(),
      reviewNote: z.string().max(500).optional(),
      keepApproved: z.boolean().optional(),
    })
    .safeParse(req.body);
  if (!body.success) {
    sendError(res, 'Invalid body', 400);
    return;
  }
  const validation = validatePuzzlePayload(
    body.data.modeId,
    body.data.puzzleJson,
    body.data.answerJson ?? null
  );
  if (!validation.ok) {
    sendError(res, validation.error || 'Invalid puzzle', 400, 'VALIDATION');
    return;
  }
  const result = await savePuzzleForAdmin({
    date: body.data.date,
    modeId: body.data.modeId,
    puzzleJson: body.data.puzzleJson,
    answerJson: body.data.answerJson ?? null,
    reviewNote: body.data.reviewNote,
    keepApproved: body.data.keepApproved,
  });
  if (!result.ok) {
    sendError(res, result.error || 'Save failed', result.error === 'locked' ? 409 : 400);
    return;
  }
  sendSuccess(res, {
    ok: true,
    puzzleJson: result.puzzleJson,
    answerJson: result.answerJson,
  });
});

adminRouter.post('/puzzle/approve', requireAdmin, async (req, res) => {
  const body = z
    .object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      modeId: z.string().min(1),
      note: z.string().max(500).optional(),
    })
    .safeParse(req.body);
  if (!body.success) {
    sendError(res, 'Invalid body', 400);
    return;
  }
  const result = await setPuzzleStatus(body.data.date, body.data.modeId, 'approved', body.data.note);
  if (!result.ok) {
    sendError(res, result.error || 'Failed', 400);
    return;
  }
  sendSuccess(res, { ok: true });
});

adminRouter.post('/puzzle/lock', requireAdmin, async (req, res) => {
  const body = z
    .object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      modeId: z.string().min(1),
      note: z.string().max(500).optional(),
    })
    .safeParse(req.body);
  if (!body.success) {
    sendError(res, 'Invalid body', 400);
    return;
  }
  const result = await setPuzzleStatus(body.data.date, body.data.modeId, 'locked', body.data.note);
  if (!result.ok) {
    sendError(res, result.error || 'Failed', 400);
    return;
  }
  sendSuccess(res, { ok: true });
});

adminRouter.post('/puzzle/unlock', requireAdmin, async (req, res) => {
  const body = z
    .object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      modeId: z.string().min(1),
      note: z.string().max(500).optional(),
    })
    .safeParse(req.body);
  if (!body.success) {
    sendError(res, 'Invalid body', 400);
    return;
  }
  const result = await setPuzzleStatus(body.data.date, body.data.modeId, 'generated', body.data.note);
  if (!result.ok) {
    sendError(res, result.error || 'Failed', 400);
    return;
  }
  sendSuccess(res, { ok: true });
});

adminRouter.post('/puzzle/regenerate', requireAdmin, async (req, res) => {
  const body = z
    .object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      modeId: z.string().min(1),
      force: z.boolean().optional(),
    })
    .safeParse(req.body);
  if (!body.success) {
    sendError(res, 'Invalid body', 400);
    return;
  }
  if (!(OPS_PLAYABLE_MODES as readonly string[]).includes(body.data.modeId)) {
    sendError(res, 'Unknown mode', 400);
    return;
  }
  res.setTimeout(0);
  const result = await generateOnePuzzle(body.data.date, body.data.modeId, {
    force: body.data.force ?? true,
  });
  if (!result.ok) {
    const status = result.skipped === 'locked' ? 409 : 400;
    sendError(res, result.skipped || result.error || 'Failed', status);
    return;
  }
  const row = await getPuzzleForAdmin(body.data.date, body.data.modeId);
  sendSuccess(res, {
    ok: true,
    puzzle: row
      ? {
          date: row.date,
          modeId: row.modeId,
          status: row.status,
          puzzleJson: row.puzzleJson,
          answerJson: row.answerJson,
          contentHash: row.contentHash,
        }
      : null,
  });
});

// ---- Entity search / resolve (for structured editors) --------------------

adminRouter.get('/search/players', requireAdmin, async (req, res) => {
  const q = String(req.query.q ?? '');
  try {
    sendSuccess(res, await adminSearchPlayers(q));
  } catch (err) {
    sendError(res, err instanceof Error ? err.message : String(err), 500);
  }
});

adminRouter.get('/search/teams', requireAdmin, async (req, res) => {
  const q = String(req.query.q ?? '');
  try {
    sendSuccess(res, await adminSearchTeams(q));
  } catch (err) {
    sendError(res, err instanceof Error ? err.message : String(err), 500);
  }
});

adminRouter.get('/search/leagues', requireAdmin, async (req, res) => {
  const q = String(req.query.q ?? '');
  try {
    sendSuccess(res, await adminSearchLeagues(q));
  } catch (err) {
    sendError(res, err instanceof Error ? err.message : String(err), 500);
  }
});

adminRouter.get('/search/nationalities', requireAdmin, async (req, res) => {
  const q = String(req.query.q ?? '');
  try {
    sendSuccess(res, await adminSearchNationalities(q));
  } catch (err) {
    sendError(res, err instanceof Error ? err.message : String(err), 500);
  }
});

adminRouter.get('/resolve/player/:id', requireAdmin, async (req, res) => {
  const id = String(req.params.id);
  const kind = String(req.query.kind ?? 'card');
  try {
    if (kind === 'bingo') {
      const player = await resolveAdminBingoPlayer(id);
      if (!player) {
        sendError(res, 'Player not found', 404);
        return;
      }
      sendSuccess(res, player);
      return;
    }
    if (kind === 'golf') {
      const player = await resolveAdminGolfAnswer(id);
      if (!player) {
        sendError(res, 'Player not found', 404);
        return;
      }
      sendSuccess(res, player);
      return;
    }
    const player = await resolveAdminPlayer(id);
    if (!player) {
      sendError(res, 'Player not found', 404);
      return;
    }
    sendSuccess(res, player);
  } catch (err) {
    sendError(res, err instanceof Error ? err.message : String(err), 500);
  }
});

adminRouter.get('/resolve/team/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    sendError(res, 'Invalid team id', 400);
    return;
  }
  try {
    const team = await resolveAdminTeam(id);
    if (!team) {
      sendError(res, 'Team not found', 404);
      return;
    }
    sendSuccess(res, team);
  } catch (err) {
    sendError(res, err instanceof Error ? err.message : String(err), 500);
  }
});
