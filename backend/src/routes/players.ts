import { Router } from 'express';
import { requireAuth, sendSuccess } from '../middleware/auth.js';
import { searchPlayers, findPlayerForGuess, playerToSnapshot, getPlayerById } from '../services/playerService.js';
import { getGameModes } from '../services/dailyService.js';
import {
  getLatestTransferFeeEurM,
  getPlayerCareerStats,
  getPlayerHonours,
  getPlayerTrophyCount,
  getPlayerTransfers,
  resolveLeagueId,
} from '../services/statsService.js';

export const playersRouter = Router();
export const gamesRouter = Router();

playersRouter.get('/search', requireAuth, async (req, res) => {
  const q = String(req.query.q ?? '');
  const results = await searchPlayers(q);
  sendSuccess(res, results);
});

playersRouter.get('/:id/stats/career', requireAuth, async (req, res) => {
  const playerId = String(req.params.id);
  const leagueId = resolveLeagueId(
    req.query.leagueId ? Number(req.query.leagueId) : undefined,
    req.query.league ? String(req.query.league) : undefined
  );

  if (!leagueId) {
    res.status(400).json({ success: false, error: { message: 'leagueId or league required' } });
    return;
  }

  const player = await getPlayerById(playerId);
  if (!player) {
    res.status(404).json({ success: false, error: { message: 'Player not found' } });
    return;
  }

  const totals = await getPlayerCareerStats(playerId, leagueId);
  sendSuccess(res, {
    playerId,
    leagueId,
    totals,
    trophyCount: await getPlayerTrophyCount(playerId),
    latestTransferFeeEurM: await getLatestTransferFeeEurM(playerId),
  });
});

playersRouter.get('/:id/transfers', requireAuth, async (req, res) => {
  const playerId = String(req.params.id);
  const player = await getPlayerById(playerId);
  if (!player) {
    res.status(404).json({ success: false, error: { message: 'Player not found' } });
    return;
  }
  sendSuccess(res, await getPlayerTransfers(playerId));
});

playersRouter.get('/:id/honours', requireAuth, async (req, res) => {
  const playerId = String(req.params.id);
  const player = await getPlayerById(playerId);
  if (!player) {
    res.status(404).json({ success: false, error: { message: 'Player not found' } });
    return;
  }
  sendSuccess(res, await getPlayerHonours(playerId));
});

playersRouter.get('/:id', requireAuth, async (req, res) => {
  const id = String(req.params.id);
  const player = await findPlayerForGuess(id);
  if (!player) {
    res.status(404).json({ success: false, error: { message: 'Player not found' } });
    return;
  }
  sendSuccess(res, playerToSnapshot(player));
});

gamesRouter.get('/', requireAuth, async (_req, res) => {
  sendSuccess(res, getGameModes());
});
