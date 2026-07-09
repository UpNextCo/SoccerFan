# Monthly Quiz Ops Dashboard

Internal tool for pre-generating, editing, approving, and locking a full month of daily puzzles.

## Setup

1. Set env on the API host:

```bash
ADMIN_PASSWORD=choose-a-strong-shared-password
# optional:
ADMIN_SESSION_SECRET=random-long-string
ADMIN_COOKIE_SECURE=1   # set in production HTTPS
```

2. Build admin UI into `backend/public/admin` (root `npm run build` does this).

3. Open `https://<api-host>/admin` and sign in with the shared password.

Local dev:

```bash
# terminal 1 — API
cd backend && ADMIN_PASSWORD=dev npm run dev

# terminal 2 — Vite (proxies /admin/api → :3000)
cd admin && npm run dev
# open http://localhost:5174/admin/
```

## Ops day workflow

1. Pick the month on the board.
2. **Generate missing** (LMS is slow — expect minutes per day).
3. Click cells → structured editors → fix bad prompts/options.
4. **Save** / **Approve** as you go.
5. **Lock month** when the set is final.
6. Spot-check the iOS app against a locked date.

## Production safety

Rows with `status = locked` are never deleted by `ensureDailyPuzzles` stale migrations or by regenerate jobs (unless you use the admin **Regenerate** / `--force` paths for approved only — locked always refuses).

Statuses: `generated` → `approved` → `locked`.

## Deploy notes

Root scripts:

- `npm run build` — installs backend + admin deps, builds admin SPA, compiles API
- `npm start` — migrates DB, starts API (serves `/admin`)

Share the `/admin` URL + password in Slack; no per-user accounts in v1.
