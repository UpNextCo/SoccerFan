# Railway Deployment Guide

## 1. Create Railway project

1. Go to [railway.app](https://railway.app) and create a new project
2. Add **PostgreSQL** plugin
3. Add **Empty Service** and connect your GitHub repo (or deploy from CLI)

## 2. Configure service

**Important:** In Railway → your GitHub service → **Settings** → **Source** → set **Root Directory** to `backend`.

(Railpack needs a `package.json` in the build root. A root-level `package.json` is also included as a fallback if Root Directory is left blank.)

### Environment variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | Auto-set by Railway PostgreSQL |
| `JWT_SECRET` | Random 64+ char string |
| `APPLE_CLIENT_ID` | `com.psounds.ballknowledge` (your bundle ID) |
| `API_FOOTBALL_KEY` | Optional — for player ingestion |
| `INGEST_SEASON` | Optional — API-Football season start year (e.g. `2026` for 2026/27). Auto-detected if unset. |
| `INGEST_LEAGUE_IDS` | Optional — comma-separated league ids or names to limit ingest (e.g. `140,78` for La Liga + Bundesliga only) |
| `INGEST_SEASONS_BACK` | Optional — seasons of stats history to pull (default `2`) |
| `NODE_ENV` | `production` |
| `PORT` | Railway sets automatically |

## 3. Deploy

Railway uses [`backend/railway.toml`](backend/railway.toml):
- Builds with `npm install && npm run build`
- Starts with `npm run db:migrate && npm start`

## 4. Seed data (one-time)

In Railway shell or locally with production `DATABASE_URL`:

```bash
cd backend
npm run db:seed
npm run job:generate-daily
```

## 5. Daily cron

Add a Railway cron job (or GitHub Action) to run daily at 00:05 UTC:

```bash
npm run job:generate-daily
```

## 5b. Weekly league rollover

Add a Railway cron (or GitHub Action) shortly after Monday 00:00 **Europe/London** (e.g. 00:10 London / 00:10 UTC in winter, 23:10 UTC Sunday in BST):

```bash
npm run job:rollover-weekly-leagues
```

Idempotent — safe if it runs twice. Finalizes the previous London week (promotion/relegation) and ensures the new week row exists. Tables fill lazily when players earn XP.

One-time launch seed (every user starts in Sunday League):

```bash
npm run job:seed-weekly-league-divisions
```

## 6. iOS config

Update production URL in [`ios/BallKnowledge/App/Config.swift`](ios/BallKnowledge/App/Config.swift):

```swift
static let apiBaseURL = URL(string: "https://YOUR-SERVICE.up.railway.app")!
```

## 7. Sign in with Apple

1. Enable Sign in with Apple capability in Apple Developer portal for `com.psounds.ballknowledge`
2. Set `APPLE_CLIENT_ID` to your bundle ID on Railway
3. Configure return URLs if using web auth (not needed for native-only)

## Local development

```bash
docker compose up -d          # PostgreSQL
cd backend && npm install
cp .env.example .env
npm run db:migrate
npm run db:seed
npm run job:generate-daily
npm run dev
```

Use **Dev Sign In** in the iOS app (DEBUG builds) when Apple credentials aren't configured.
