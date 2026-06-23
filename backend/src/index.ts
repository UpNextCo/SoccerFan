import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { authRouter } from './routes/auth.js';
import { dailyRouter } from './routes/daily.js';
import { leaguesRouter } from './routes/leagues.js';
import { gamesRouter, playersRouter } from './routes/players.js';
import { statsRouter } from './routes/stats.js';
import { teamsRouter } from './routes/teams.js';
import { bootstrapDatabase } from './db/seed.js';

const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } });
});

app.use('/auth', authRouter);
app.use('/daily', dailyRouter);
app.use('/leagues', leaguesRouter);
app.use('/players', playersRouter);
app.use('/stats', statsRouter);
app.use('/teams', teamsRouter);
app.use('/games', gamesRouter);

app.use((_req, res) => {
  res.status(404).json({ success: false, error: { message: 'Not found' } });
});

app.listen(port, () => {
  console.log(`Ball Knowledge API listening on port ${port}`);
  bootstrapDatabase().catch((err) => {
    console.error('Bootstrap failed:', err);
  });
});
