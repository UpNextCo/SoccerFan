import { Router } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requireAuth, sendError, sendSuccess } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import {
  dailyLeaderboard,
  londonDateString,
  overallLeaderboard,
  teamFans,
  teamLeaderboard,
  weeklyLeaderboard,
  weeklyLeagueForUser,
  weekStartFor,
  xpByModeBreakdownForUser,
} from '../services/leagueService.js';

export const leaguesRouter = Router();

function todayLondon(): string {
  return londonDateString();
}

leaguesRouter.get('/daily', requireAuth, async (req, res) => {
  try {
    const date = typeof req.query.date === 'string' ? req.query.date : todayLondon();
    sendSuccess(res, { date, standings: await dailyLeaderboard(date) });
  } catch (err) {
    sendError(res, err instanceof Error ? err.message : 'Failed to load daily league', 500);
  }
});

leaguesRouter.get('/weekly', requireAuth, async (_req, res) => {
  try {
    const weekStart = weekStartFor(todayLondon());
    sendSuccess(res, { weekStart, standings: await weeklyLeaderboard(weekStart) });
  } catch (err) {
    sendError(res, err instanceof Error ? err.message : 'Failed to load weekly league', 500);
  }
});

leaguesRouter.get('/overall', requireAuth, async (_req, res) => {
  try {
    sendSuccess(res, { standings: await overallLeaderboard() });
  } catch (err) {
    sendError(res, err instanceof Error ? err.message : 'Failed to load overall league', 500);
  }
});

leaguesRouter.get('/teams', requireAuth, async (_req, res) => {
  try {
    sendSuccess(res, { standings: await teamLeaderboard() });
  } catch (err) {
    sendError(res, err instanceof Error ? err.message : 'Failed to load team league', 500);
  }
});

leaguesRouter.get('/teams/:teamId', requireAuth, async (req, res) => {
  const teamId = Number(req.params.teamId);
  if (!Number.isInteger(teamId) || teamId <= 0) {
    sendError(res, 'Invalid team id', 400, 'VALIDATION_ERROR');
    return;
  }
  try {
    sendSuccess(res, { teamId, standings: await teamFans(teamId) });
  } catch (err) {
    sendError(res, err instanceof Error ? err.message : 'Failed to load team fans', 500);
  }
});

leaguesRouter.get('/players/:userId/xp-by-mode', requireAuth, async (req, res) => {
  const userId = String(req.params.userId || '');
  if (!/^[0-9a-f-]{36}$/i.test(userId)) {
    sendError(res, 'Invalid user id', 400, 'VALIDATION_ERROR');
    return;
  }
  const date =
    typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
      ? req.query.date
      : todayLondon();
  try {
    sendSuccess(res, await xpByModeBreakdownForUser(userId, date));
  } catch (err) {
    sendError(res, err instanceof Error ? err.message : 'Failed to load XP by mode', 500);
  }
});

/** Weekly pyramid league for the authenticated user. */
leaguesRouter.get('/me', requireAuth, async (req, res) => {
  try {
    sendSuccess(res, await weeklyLeagueForUser(req.auth!.userId));
  } catch (err) {
    sendError(res, err instanceof Error ? err.message : 'Failed to load your league', 500);
  }
});

const teamSchema = z.object({ teamId: z.number().int().nullable() });

leaguesRouter.put('/team', requireAuth, async (req, res) => {
  const parsed = teamSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 'Invalid request body', 400);
    return;
  }

  try {
    await db
      .update(users)
      .set({ favoriteTeamId: parsed.data.teamId })
      .where(eq(users.id, req.auth!.userId));
    sendSuccess(res, { favoriteTeamId: parsed.data.teamId });
  } catch (err) {
    sendError(res, err instanceof Error ? err.message : 'Failed to set team', 500);
  }
});
