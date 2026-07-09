# Ball Knowledge

Daily football puzzle app — native iOS (SwiftUI) + Node/TypeScript backend on Railway.

## Structure

- `ios/` — SwiftUI iOS app
- `backend/` — Express API + Drizzle + PostgreSQL
- `admin/` — Monthly Quiz Ops dashboard (served at `/admin`)
- `shared/` — Shared TypeScript types
- `scripts/` — Data ingestion scripts
- `docs/ops-quiz-dashboard.md` — Ops runbook for the quiz dashboard

## Backend setup

Requires PostgreSQL. Use Docker (`docker compose up -d`) or Railway.

```bash
cd backend
cp .env.example .env
npm install
npm run db:migrate
npm run db:seed
npm run job:generate-daily
npm run dev
```

Test auth (dev mode):
```bash
curl -X POST http://localhost:3000/auth/apple \
  -H 'Content-Type: application/json' \
  -d '{"identityToken":"dev:test-user","displayName":"Test Player"}'
```

## Railway deployment

1. Create Railway project with PostgreSQL + Node service
2. Set env vars: `DATABASE_URL`, `JWT_SECRET`, `APPLE_CLIENT_ID`, `API_FOOTBALL_KEY`, `ADMIN_PASSWORD`
3. Build from repo root (`npm run build`) so `admin/` is emitted into `backend/public/admin`
4. Point service root to repo root (or ensure start script builds admin) — migrations run on start
5. Open `https://<host>/admin` — see [docs/ops-quiz-dashboard.md](docs/ops-quiz-dashboard.md)

## iOS setup

Open `ios/BallKnowledge.xcodeproj` in Xcode 16+.
Set your team for Sign in with Apple capability.
Update `API_BASE_URL` in `Config.swift` to your Railway URL.

## Dev auth

In development, POST `/auth/apple` with `{ "identityToken": "dev:test-user-1", "displayName": "Test Player" }` when Apple credentials aren't configured.

## Privacy

Privacy policy: https://ballknowledge.app/privacy (placeholder — update before App Store submission)
