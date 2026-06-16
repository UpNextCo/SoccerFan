import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { authRouter } from './routes/auth.js';
import { dailyRouter } from './routes/daily.js';
import { gamesRouter, playersRouter } from './routes/players.js';

const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } });
});

app.use('/auth', authRouter);
app.use('/daily', dailyRouter);
app.use('/players', playersRouter);
app.use('/games', gamesRouter);

app.use((_req, res) => {
  res.status(404).json({ success: false, error: { message: 'Not found' } });
});

app.listen(port, () => {
  console.log(`Ball Knowledge API listening on port ${port}`);
});
