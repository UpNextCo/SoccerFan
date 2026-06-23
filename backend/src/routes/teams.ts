import { Router } from 'express';
import { requireAuth, sendSuccess } from '../middleware/auth.js';
import { lookupTeamLogo, searchTeams } from '../services/teamService.js';

export const teamsRouter = Router();

teamsRouter.get('/search', requireAuth, async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const results = await searchTeams(q);
  sendSuccess(res, results);
});

teamsRouter.get('/logo', requireAuth, async (req, res) => {
  const club = String(req.query.club ?? '').trim();
  const league = String(req.query.league ?? '').trim();

  if (!club) {
    res.status(400).json({ success: false, error: { message: 'club is required' } });
    return;
  }

  const match = await lookupTeamLogo(club, league);
  if (!match) {
    res.status(404).json({ success: false, error: { message: 'Team logo not found' } });
    return;
  }

  sendSuccess(res, match);
});
