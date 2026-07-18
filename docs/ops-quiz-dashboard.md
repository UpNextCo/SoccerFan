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
2. Filter by mode if needed, then use **Generate full month**. Generation
   continues in the background and survives closing or refreshing the dashboard.
   The progress panel shows completed, skipped and failed puzzles; failed items can
   be retried without touching successful, approved or locked content.
3. Open a puzzle and make changes in its structured editor.
4. Use **Run checks** to validate structure, database facts and solvability.
5. **Save changes**, then **Save & approve** once validation is clean.
6. Lock individual puzzles or **Lock month** when the set is final.
7. Spot-check the iOS app against a locked date.

The editor warns before leaving with unsaved changes. `Cmd+S`/`Ctrl+S` saves the
current draft, and **Discard** restores the last server copy.

## Structured editors

- **Bingo** — inspect the board preview, edit and reorder category cards, change
  nationality/club rules, and manage the shipped player pool. Validation checks
  every category has matching players and the board remains solvable.
- **One More** — choose a database-backed metric and threshold, preview coverage,
  then generate ten verified qualifier/distractor pairs. Swapping a player looks
  up the real metric value automatically; operators should not hand-enter stats.
- **Last Man Standing** — use the question navigator to review one slot at a time,
  edit type-specific content, options, correct answers, reveals, badge blur and
  career clubs. Any slot can be changed to **Custom image**: choose a JPEG, PNG or
  WebP kit/stadium/photo, enter four text answers, select the correct answer, then
  save and approve. The dashboard resizes large uploads and the iOS card displays
  the stored image unblurred.
- **Draft XI** — edit category, formation and constraints, then review the optimal
  lineup and score in the pitch-style QA section.
- **Football Golf** — build exactly five consecutively numbered holes, navigate them
  individually, and choose a verified template (season, club-era, career or
  tournament). Answers, rarity and suggested par update automatically as the
  question changes; use Run checks for full course validation. Display wording
  stays editable without becoming the source of truth for football facts.
  Approval rejects any course that does not contain exactly five holes. Generated
  courses prefer a fun mix (season/tournament moments, club eras, career journeys)
  with broad answer pools, avoid nationality filter stacks, use a balanced
  2/3/3/4/4 par plan (subject to per-prompt safety clamping), and keep a fixed
  28-day semantic rule cooldown; five holes per day require 145 distinct rules in
  the sustainable bank.
- **Club Chain** — edit endpoints and inspect the answer path. Validation checks
  every teammate link and compares the stored path with the database graph.
- **Target Man** — edit category and target through structured fields; puzzle and
  answer values stay synchronized.

Raw JSON is available only in the advanced fallback editor and should not be the
normal authoring workflow.

## Question templates and candidate generation

Custom questions use the structured question engine under
`/admin/api/question-engine`. A template stores prompt copy plus catalog IDs and
configuration; it never stores operator-provided SQL.

For One More, the dashboard can:

1. List the approved metric catalog.
2. Preview pool size, suggested thresholds and sample players.
3. Generate verified candidate pairs.
4. Re-check a replacement player's value against the database.
5. Save reusable templates as draft, active or archived.

The same catalog/query implementation powers generation and Ops verification, so
the dashboard cannot silently drift from the game.

## Validation

**Run checks** performs both payload and database-backed validation. Approval and
locking also run validation server-side, so bypassing the UI cannot publish an
invalid puzzle.

Errors must be fixed before approval. Warnings identify thin pools or quality
concerns that should be reviewed but do not necessarily block publishing.

## Production safety

Rows with `status = locked` are never deleted by `ensureDailyPuzzles` stale migrations or by regenerate jobs (unless you use the admin **Regenerate** / `--force` paths for approved only — locked always refuses).

Statuses: `generated` → `approved` → `locked`.

Regeneration replaces the current generated/approved puzzle and is blocked for a
locked puzzle. Golf regeneration generates and validates the replacement before
atomically swapping the stored row, so a failed generation leaves the current
course intact. Preview and validation endpoints are read-only; proposed candidates
are not written to `daily_puzzles` until **Save changes**.

## Deploy notes

Root scripts:

- `npm run build` — installs backend + admin deps, builds admin SPA, compiles API
- `npm start` — migrates DB, starts API (serves `/admin`)
- `cd backend && npm run test:validation` — runs pure semantic validator tests
- `cd backend && npm run job:build-golf-templates` — expands the Golf question
  bank with season, club-era, career and tournament prompts (broad ~20–120
  answer pools; geography filters are avoided)
- `cd backend && npm run job:build-lms-bank -- --total 450` — grows the
  Claude-reviewed LMS bank toward the 45-day freshness target
- `cd backend && npm run job:audit-lms-freshness` — reports exact LMS repeats
  and distinct signed bank inventory by question type
- `cd backend && npm run job:audit-bingo-freshness -- START END` — reports
  repeated Bingo boards, high-frequency tiles and type balance
- `cd admin && npm run lint` — checks editor hooks and TypeScript-facing lint rules

Share the `/admin` URL + password in Slack; no per-user accounts in v1.
