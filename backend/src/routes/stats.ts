import { Router } from 'express';
import { requireAuth, sendSuccess } from '../middleware/auth.js';
import {
  getTopPlayersByCareerStat,
  resolveLeagueId,
  type StatMetric,
} from '../services/statsService.js';

export const statsRouter = Router();

const METRICS = new Set<StatMetric>([
  'goals',
  'assists',
  'appearances',
  'yellowCards',
  'redCards',
  'minutes',
  'cleanSheets',
  'saves',
  'foulsCommitted',
  'tackles',
]);

statsRouter.get('/top', requireAuth, async (req, res) => {
  const leagueId = resolveLeagueId(
    req.query.leagueId ? Number(req.query.leagueId) : undefined,
    req.query.league ? String(req.query.league) : undefined
  );
  const metric = String(req.query.metric ?? 'goals') as StatMetric;
  const min = Number(req.query.min ?? 10);
  const limit = req.query.limit ? Number(req.query.limit) : 50;

  if (!leagueId) {
    res.status(400).json({ success: false, error: { message: 'leagueId or league required' } });
    return;
  }
  if (!METRICS.has(metric)) {
    res.status(400).json({ success: false, error: { message: 'Invalid metric' } });
    return;
  }

  const results = await getTopPlayersByCareerStat({ leagueId, metric, min, limit });
  sendSuccess(res, results);
});
