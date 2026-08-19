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
import {
  enrichAdminBackYourselfPuzzle,
  enrichAdminBingoPuzzle,
  enrichAdminClubChainPuzzle,
  enrichAdminDraftPuzzle,
  enrichAdminGolfPuzzle,
  enrichAdminLMSPuzzle,
  enrichAdminOneMorePuzzle,
} from '../services/adminPuzzleEnrich.js';
import { recomputeLmsQuestionAnswer } from '../services/lastManStanding/recomputeReveal.js';
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
import { resolveBackYourselfPlayerCards } from '../services/backYourselfGenerator.js';
import { adminQuestionEngineRouter } from './adminQuestionEngine.js';
import { adminPuzzleValidationRouter } from './adminPuzzleValidation.js';
import { adminMonthGenerationRouter } from './adminMonthGeneration.js';
import { adminMediaRouter } from './adminMedia.js';
import { adminPlayerPhotosRouter } from './adminPlayerPhotos.js';

export const adminRouter = Router();
adminRouter.use('/question-engine', adminQuestionEngineRouter);
adminRouter.use('/validation', adminPuzzleValidationRouter);
adminRouter.use('/month-generation', adminMonthGenerationRouter);
adminRouter.use('/media', adminMediaRouter);
adminRouter.use('/player-photos', adminPlayerPhotosRouter);

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
  let puzzleJson = row.puzzleJson;
  let answerJson = row.answerJson;
  if (modeId === 'football_golf') {
    puzzleJson = await enrichAdminGolfPuzzle(row.puzzleJson);
  } else if (modeId === 'club_chain') {
    puzzleJson = await enrichAdminClubChainPuzzle(row.puzzleJson);
  } else if (modeId === 'draft_master') {
    puzzleJson = await enrichAdminDraftPuzzle(row.puzzleJson);
  } else if (modeId === 'football_bingo') {
    puzzleJson = await enrichAdminBingoPuzzle(row.puzzleJson);
  } else if (modeId === 'one_more') {
    puzzleJson = await enrichAdminOneMorePuzzle(row.puzzleJson);
  } else if (modeId === 'last_man_standing') {
    const enriched = await enrichAdminLMSPuzzle(row.puzzleJson, row.answerJson);
    puzzleJson = enriched.puzzleJson;
    answerJson = enriched.answerJson;
  } else if (modeId === 'back_yourself') {
    try {
      const enriched = await enrichAdminBackYourselfPuzzle(row.puzzleJson, row.answerJson);
      puzzleJson = enriched.puzzleJson;
      answerJson = enriched.answerJson;
    } catch {
      // Keep stored copy if pool refresh fails (e.g. offline media).
    }
  }
  sendSuccess(res, {
    id: row.id,
    date: row.date,
    modeId: row.modeId,
    status: row.status,
    puzzleJson,
    answerJson,
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

/** Refresh Back Yourself valid player pool from the editor's current category. */
adminRouter.post('/puzzle/recompute-back-yourself', requireAdmin, async (req, res) => {
  const body = z
    .object({ puzzleJson: z.unknown(), answerJson: z.unknown().optional() })
    .safeParse(req.body);
  if (!body.success) {
    sendError(res, 'Invalid body', 400);
    return;
  }
  try {
    const enriched = await enrichAdminBackYourselfPuzzle(
      body.data.puzzleJson,
      body.data.answerJson ?? null
    );
    sendSuccess(res, enriched);
  } catch (err) {
    sendError(res, err instanceof Error ? err.message : String(err), 400);
  }
});

/** Re-solve Draft XI optimal lineup from the editor's current constraint chips (live Ops preview). */
adminRouter.post('/puzzle/recompute-draft', requireAdmin, async (req, res) => {
  const body = z.object({ puzzleJson: z.unknown() }).safeParse(req.body);
  if (!body.success) {
    sendError(res, 'Invalid body', 400);
    return;
  }
  try {
    // Live preview: skip logo/headshot hydration so Best score + pts update quickly while editing.
    const puzzleJson = await enrichAdminDraftPuzzle(body.data.puzzleJson, {
      requireOptimal: true,
      skipMedia: true,
    });
    sendSuccess(res, { puzzleJson });
  } catch (err) {
    sendError(res, err instanceof Error ? err.message : String(err), 400);
  }
});

/** Look up category stat values for Draft XI lineup players (manual Ops overrides). */
adminRouter.post('/puzzle/draft-player-values', requireAdmin, async (req, res) => {
  const body = z
    .object({
      categoryId: z.string().min(1),
      playerIds: z.array(z.string().uuid()).min(1).max(11),
    })
    .safeParse(req.body);
  if (!body.success) {
    sendError(res, 'Invalid body', 400);
    return;
  }
  try {
    const { battleCategoryValues } = await import('../services/battleGenerator.js');
    const values = await battleCategoryValues(body.data.categoryId, body.data.playerIds);
    sendSuccess(res, { values });
  } catch (err) {
    sendError(res, err instanceof Error ? err.message : String(err), 400);
  }
});

/** Rebuild LMS answer explanation (and higher/lower correct option) after Ops edits. */
adminRouter.post('/puzzle/recompute-lms-reveal', requireAdmin, async (req, res) => {
  const body = z
    .object({
      question: z.object({
        id: z.string().min(1),
        type: z.string().min(1),
        prompt: z.string().nullable().optional(),
        subPrompt: z.string().nullable().optional(),
        options: z.array(
          z.object({
            id: z.string().min(1),
            label: z.string(),
          }).passthrough()
        ),
        presentation: z.record(z.unknown()).nullable().optional(),
      }).passthrough(),
      answer: z.object({
        questionId: z.string().min(1),
        correctOptionId: z.string().min(1),
        reveal: z.string().nullable().optional(),
      }).passthrough(),
    })
    .safeParse(req.body);
  if (!body.success) {
    sendError(res, 'Invalid body', 400);
    return;
  }
  try {
    const next = await recomputeLmsQuestionAnswer(
      {
        ...body.data.question,
        presentation: body.data.question.presentation as {
          careerClubs?: Array<{ name: string; note?: 'loan' | string | null }>;
          cluePlayers?: Array<{ name: string }>;
        } | null,
      },
      body.data.answer
    );
    sendSuccess(res, { answer: next });
  } catch (err) {
    sendError(res, err instanceof Error ? err.message : String(err), 400);
  }
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

adminRouter.post('/resolve/players', requireAdmin, async (req, res) => {
  const body = z
    .object({ ids: z.array(z.string()).max(150) })
    .safeParse(req.body);
  if (!body.success) {
    sendError(res, 'Invalid body', 400);
    return;
  }
  try {
    sendSuccess(res, await resolveBackYourselfPlayerCards(body.data.ids));
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
