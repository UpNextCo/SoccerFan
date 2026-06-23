import { Router } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requireAuth, sendError, sendSuccess } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import {
  dailyLeaderboard,
  myCohortStandings,
  overallLeaderboard,
  teamLeaderboard,
  weeklyLeaderboard,
  weekStartFor,
} from '../services/leagueService.js';

export const leaguesRouter = Router();

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

leaguesRouter.get('/daily', requireAuth, async (req, res) => {
  try {
    const date = typeof req.query.date === 'string' ? req.query.date : todayUTC();
    sendSuccess(res, { date, standings: await dailyLeaderboard(date) });
  } catch (err) {
    sendError(res, err instanceof Error ? err.message : 'Failed to load daily league', 500);
  }
});

leaguesRouter.get('/weekly', requireAuth, async (_req, res) => {
  try {
    const weekStart = weekStartFor(todayUTC());
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
    const weekStart = weekStartFor(todayUTC());
    sendSuccess(res, { weekStart, standings: await teamLeaderboard(weekStart) });
  } catch (err) {
    sendError(res, err instanceof Error ? err.message : 'Failed to load team league', 500);
  }
});

leaguesRouter.get('/me', requireAuth, async (req, res) => {
  try {
    const weekStart = weekStartFor(todayUTC());
    sendSuccess(res, { weekStart, ...(await myCohortStandings(req.auth!.userId, weekStart)) });
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
