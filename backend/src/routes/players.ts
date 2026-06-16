import { Router } from 'express';
import { requireAuth, sendSuccess } from '../middleware/auth.js';
import { searchPlayers, findPlayerForGuess, playerToSnapshot } from '../services/playerService.js';
import { getGameModes } from '../services/dailyService.js';

export const playersRouter = Router();
export const gamesRouter = Router();

playersRouter.get('/search', requireAuth, async (req, res) => {
  const q = String(req.query.q ?? '');
  const results = await searchPlayers(q);
  sendSuccess(res, results);
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
