import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authRouter, serveAvatar } from './routes/auth.js';
import { dailyRouter } from './routes/daily.js';
import { leaguesRouter } from './routes/leagues.js';
import { gamesRouter, playersRouter } from './routes/players.js';
import { statsRouter } from './routes/stats.js';
import { teamsRouter } from './routes/teams.js';
import { adminRouter } from './routes/admin.js';
import { bootstrapDatabase } from './db/seed.js';
import { startDailyPreGeneration } from './services/dailyPreGeneration.js';
import {
  startMonthGenerationWorker,
  stopMonthGenerationWorker,
} from './services/adminMonthGeneration.js';

const app = express();
const port = Number(process.env.PORT) || 3000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '4mb' }));

app.get('/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } });
});

// Public profile photos — no auth so clients can load via AsyncImage.
app.get('/avatars/:userId', (req, res) => {
  void serveAvatar(req, res);
});

app.use('/auth', authRouter);
app.use('/daily', dailyRouter);
app.use('/leagues', leaguesRouter);
app.use('/players', playersRouter);
app.use('/stats', statsRouter);
app.use('/teams', teamsRouter);
app.use('/games', gamesRouter);
app.use('/admin/api', adminRouter);

// Built admin SPA (vite build → public/admin). In dev, run `npm run dev` in admin/.
const adminDist = path.resolve(__dirname, '../public/admin');
app.use('/admin', express.static(adminDist, { index: false }));
app.get(/^\/admin(?:\/.*)?$/, (_req, res, next) => {
  // Don't swallow API 404s — those are mounted under /admin/api already.
  if (_req.path.startsWith('/admin/api')) {
    next();
    return;
  }
  res.sendFile(path.join(adminDist, 'index.html'), (err) => {
    if (err) next();
  });
});

app.use((_req, res) => {
  res.status(404).json({ success: false, error: { message: 'Not found' } });
});

const server = app.listen(port, () => {
  console.log(`Ball Knowledge API listening on port ${port}`);
  startMonthGenerationWorker();
  bootstrapDatabase()
    .then(() => {
      startDailyPreGeneration();
    })
    .catch((err) => {
      console.error('Bootstrap failed:', err);
    });
});

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received; stopping month generation worker`);
  const serverStopped = new Promise<void>((resolve) => {
    server.close((error) => {
      if (error) {
        console.error('HTTP server shutdown failed:', error);
        process.exitCode = 1;
      }
      resolve();
    });
  });
  try {
    await stopMonthGenerationWorker();
  } catch (error) {
    console.error('Month generation worker shutdown failed:', error);
    process.exitCode = 1;
  }
  await serverStopped;
  process.exit(process.exitCode ?? 0);
}

process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.once('SIGINT', () => {
  void shutdown('SIGINT');
});
