/**
 * Build + QA the curated World Cup XI clue bank (the SOLE source of clues for the live game).
 *
 *   build (default): ask Claude for fair, identifying, year-stamped clues — first per major nation
 *                    (position by position, across all its World Cups), then a per-year catch-all for
 *                    everyone else — DB-verify each to that nation+year's squad, upsert into
 *                    wc_memorable (status active), and export wc_memorable_review.csv.
 *   apply <file>:    read the edited CSV and apply your `status` (active|rejected) changes by id.
 *
 * Workflow: run build → open the CSV → set status=rejected for any wrong/weak clue → run apply.
 * The generator draws only active rows.
 *
 * Usage: DATABASE_URL=... ANTHROPIC_API_KEY=... npx tsx src/jobs/build-wc-memorable.ts
 *        DATABASE_URL=... npx tsx src/jobs/build-wc-memorable.ts apply wc_memorable_review.csv
 */
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { proposeTeamClues, proposeYearClues, type ClueProposal } from '../services/llmCuration.js';

// 2006 onwards only — recent World Cups are the recognisable ones, and these are the years we have
// complete FBref game-by-game data to validate clues against.
const YEARS = [2006, 2010, 2014, 2018, 2022];
// Major footballing nations get a dedicated, position-by-position pass (this is where the most
// recognisable World Cup players live and where structured clue-writing pays off).
const MAJOR_TEAMS = [
  'Brazil', 'Argentina', 'France', 'Germany', 'Spain', 'England', 'Italy', 'Netherlands',
  'Portugal', 'Uruguay', 'Belgium', 'Croatia', 'Mexico', 'Colombia',
];
const FILE = 'wc_memorable_review.csv';
const COLS = ['id', 'year', 'status', 'position', 'player', 'clue'] as const;

function norm(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
function toks(s: string): string[] { return norm(s).split(' ').filter((t) => t.length > 1); }
function lastTok(s: string): string { const t = toks(s); return t[t.length - 1] ?? ''; }
function firstInitial(s: string): string { return (toks(s)[0] ?? '').charAt(0); }

interface SquadRow { player_name: string; player_id: string; country: string }

// Phrases in a clue → the canonical award row we must find in player_awards to allow it. Awards are
// the #1 source of confidently-wrong clues (Claude hands them to the runner-up), so we hard-verify
// every award claim against the DB and drop any that don't match the real winner for that year.
const AWARD_PHRASES: Array<{ re: RegExp; award: string }> = [
  { re: /golden ball/i, award: 'World Cup Golden Ball' },
  { re: /golden boot/i, award: 'World Cup Golden Boot' },
  { re: /golden glove/i, award: 'World Cup Golden Glove' },
  { re: /(best young player|young player award|young player of the tournament)/i, award: 'World Cup Young Player' },
  // FIFA's "best player of the tournament" IS the Golden Ball — verify against that winner. The
  // (?<!young ) guard avoids matching "best YOUNG player of the tournament" (handled above).
  { re: /(?<!young )(player of the tournament|best player of the (?:tournament|world cup)|tournament'?s best player|most valuable player)/i, award: 'World Cup Golden Ball' },
];
// We only store award WINNERS, so silver/bronze placements can't be verified — reject them outright.
const UNVERIFIABLE_AWARD = /(silver|bronze)\s+(ball|boot|glove)|runner-?up for the golden/i;
// Catch-all for invented/unverifiable trophies (e.g. "Best Player award", "assist award") that don't
// map to one of our four real World Cup awards.
const GENERIC_AWARD_CLAIM = /\b(won|awarded|voted|named|received|claimed)\b[^.]{0,60}\baward\b/i;

type AwardSet = Set<string>; // `${playerId}|${year}|${award}`

async function loadAwards(): Promise<AwardSet> {
  const rows = (await db.execute(sql`
    SELECT player_id AS "playerId", year, award FROM player_awards
    WHERE award LIKE 'World Cup %' AND player_id IS NOT NULL
  `)) as unknown as Array<{ playerId: string; year: number; award: string }>;
  return new Set(rows.map((r) => `${r.playerId}|${r.year}|${r.award}`));
}

/**
 * True if a clue's award claims are all backed by the DB. A clue with no award language passes; a
 * clue claiming an award the player didn't win that year (or any silver/bronze placement we can't
 * check) fails.
 */
function awardClaimReason(clue: string, playerId: string, year: number, awards: AwardSet): string | null {
  if (UNVERIFIABLE_AWARD.test(clue)) return 'claims an unverifiable silver/bronze/runner-up award';
  let matchedKnown = false;
  for (const { re, award } of AWARD_PHRASES) {
    if (re.test(clue)) {
      matchedKnown = true;
      if (!awards.has(`${playerId}|${year}|${award}`)) return `claims the ${award.replace('World Cup ', '')} but the DB winner is someone else`;
    }
  }
  // A clue that "won an award" we couldn't map to (and verify against) a real World Cup award is
  // unverifiable — likely invented (e.g. a per-nation "best player" award). Drop it.
  if (!matchedKnown && GENERIC_AWARD_CLAIM.test(clue)) return 'claims an award that maps to no real World Cup trophy';
  return null;
}

// ---- Match-event validation: verify goal/stage/opponent/hat-trick claims against the DB ----
// `wc_match_events` goals are near-complete (totals match real World Cups), and `player_stats`
// (league 1 = World Cup) carries a goals tally INCLUDING zero-goal players, so together they tell us
// authoritatively whether a player scored. We verify the *claims a clue makes* and reject only when
// the data clearly contradicts — never when we simply lack the player's events (avoids false drops
// like Théo Hernández's 2022 semi goal, which is missing from the events table).
const TEAM_ALIAS: Record<string, string> = {
  usa: 'united states', 'united states of america': 'united states', us: 'united states',
  'korea republic': 'south korea', korea: 'south korea',
  'serbia montenegro': 'serbia and montenegro', czechia: 'czech republic', china: 'china pr',
};
function normTeam(s: string): string {
  const t = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&/g, 'and').replace(/[^a-z\s]/g, ' ').replace(/\b(the)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return TEAM_ALIAS[t] ?? t;
}

interface EvGoal { stage: string; opponent: string; matchId: number }
interface MatchIndex {
  statsGoals: Map<string, number>;       // pid|year -> WC goals (row exists ⇒ authoritative)
  goals: Map<string, EvGoal[]>;          // pid|year -> goal events
  ownGoals: Set<string>;                 // pid|year with a recorded own goal
  yearOpps: Map<number, Set<string>>;    // year -> normalized opponents seen that year
}

async function loadMatchIndex(): Promise<MatchIndex> {
  const stats = (await db.execute(sql`
    SELECT player_id AS "playerId", season AS year, goals FROM player_stats
    WHERE league_id = 1 AND player_id IS NOT NULL
  `)) as unknown as Array<{ playerId: string; year: number; goals: number }>;
  const statsGoals = new Map<string, number>();
  for (const r of stats) statsGoals.set(`${r.playerId}|${r.year}`, Number(r.goals) || 0);

  const evs = (await db.execute(sql`
    SELECT player_id AS "playerId", year, type, stage, opponent, match_id AS "matchId"
    FROM wc_match_events WHERE type IN ('goal', 'own_goal') AND player_id IS NOT NULL
  `)) as unknown as Array<{ playerId: string; year: number; type: string; stage: string; opponent: string; matchId: number }>;
  const goals = new Map<string, EvGoal[]>();
  const ownGoals = new Set<string>();
  const yearOpps = new Map<number, Set<string>>();
  for (const e of evs) {
    const k = `${e.playerId}|${e.year}`;
    if (e.type === 'own_goal') { ownGoals.add(k); continue; }
    (goals.get(k) ?? goals.set(k, []).get(k)!).push({ stage: e.stage, opponent: e.opponent, matchId: e.matchId });
    const set = yearOpps.get(e.year) ?? yearOpps.set(e.year, new Set()).get(e.year)!;
    if (e.opponent) set.add(normTeam(e.opponent));
  }
  return { statsGoals, goals, ownGoals, yearOpps };
}

/** Claude occasionally "thinks out loud" and leaves a self-correction in the clue — always garbled. */
function garbledReason(clue: string): string | null {
  if (/\bwait\b/i.test(clue) || /\bthat was \d{4}\b/i.test(clue)) return 'contains a self-correction ("wait") — garbled';
  return null;
}

const CLAIMS_GOAL = /\b(scored|netted|nets|brace|hat-?trick|opening goal|winning goal|the winner|equaliser|equalizer|both goals|two goals|got on the scoresheet|opened the scoring)\b/;
const NON_GOAL_CTX = /\b(own goal|assist|assisted|set up|set-up|provided|created|teed up|laid on|missed|disallow|ruled out|chalked off|saved|conceded|clean sheet|without scoring|failed to score|denied|drew the foul|won (?:the|a) penalty)\b/;
const SHOOTOUT_CTX = /\b(shootout|shoot-out|spot-?kicks?|penalty shoot)\b/;

function wantedStage(c: string): string | null {
  // Only treat a stage as the GOAL's stage when it's phrased as the goal happening "in/of/during the
  // {stage}". This avoids incidental mentions that aren't where the goal was scored — e.g. "into the
  // quarter-finals", "round-of-16 exit", "reached the semi-finals", "three consecutive quarter-finals".
  const m = c.match(/\b(?:in|of|during)\s+(?:the\s+|a\s+)?(?:\d{4}\s+)?(third[- ]place|3rd place|semi-?finals?|quarter-?finals?|round of 16|round-of-16|last[- ]16|group stage|group-stage|final)\b/);
  if (!m) return null;
  const s = m[1]!;
  if (/third|3rd/.test(s)) return '3rd Place Final';
  if (/semi/.test(s)) return 'Semi-finals';
  if (/quarter/.test(s)) return 'Quarter-finals';
  if (/16/.test(s)) return 'Round of 16';
  if (/group/.test(s)) return 'Group Stage';
  return 'Final';
}
function wantedOpponent(original: string, yearOpps: Set<string> | undefined): string | null {
  if (!yearOpps) return null;
  const m = original.match(/\b(?:against|versus|vs\.?|over|past)\s+([A-Z][A-Za-z'’.-]+(?:\s+(?:&\s+)?(?:and\s+)?[A-Z][A-Za-z'’.-]+)*)/);
  if (!m) return null;
  const opp = normTeam(m[1]!);
  return yearOpps.has(opp) ? opp : null; // only act when it resolves to a real opponent that year
}
function maxGoalsInAMatch(evs: EvGoal[]): number {
  const byMatch = new Map<number, number>();
  for (const e of evs) byMatch.set(e.matchId, (byMatch.get(e.matchId) ?? 0) + 1);
  return byMatch.size ? Math.max(...byMatch.values()) : 0;
}

function matchClaimReason(clue: string, playerId: string, year: number, idx: MatchIndex): string | null {
  const c = clue.toLowerCase();
  const key = `${playerId}|${year}`;
  const evs = idx.goals.get(key) ?? [];
  const statsRow = idx.statsGoals.has(key);
  const scored = (idx.statsGoals.get(key) ?? 0) > 0 || evs.length > 0;

  if (CLAIMS_GOAL.test(c) && !SHOOTOUT_CTX.test(c) && !NON_GOAL_CTX.test(c)) {
    // Both sources agree the player didn't score that year.
    if (!scored && statsRow) return 'claims a goal but the player did not score at that World Cup';
    // Granular checks only when we actually hold the player's goal events (else we can't be sure).
    if (evs.length > 0) {
      const stage = wantedStage(c);
      if (stage && !evs.some((e) => e.stage === stage)) return `claims a goal in the ${stage} but none is recorded`;
      if (/hat-?trick/.test(c) && maxGoalsInAMatch(evs) < 3) return 'claims a hat-trick but no 3-goal match is recorded';
      else if (/\b(brace|scored twice|both goals|two goals)\b/.test(c) && maxGoalsInAMatch(evs) < 2) return 'claims a brace but no 2-goal match is recorded';
      const opp = wantedOpponent(clue, idx.yearOpps.get(year));
      if (opp && !evs.some((e) => normTeam(e.opponent) === opp)) return 'claims a goal against an opponent the player did not score against';
    }
  }

  // Own-goal claim (the player themselves putting it in their own net — not assisting/benefiting
  // from someone else's). Verify against recorded own goals; only reject when we have the player on
  // file (statsRow) so a match gap can't cause a false drop.
  const claimsOwnGoal = /own goal/.test(c)
    && !/\b(assist|assisted|set up|set-up|provided|cross|led to|off (?:a|the)|deflect)/.test(c);
  if (claimsOwnGoal && statsRow && !idx.ownGoals.has(key)) {
    return 'claims an own goal but none is recorded';
  }
  return null;
}

/**
 * Resolve a proposed name to exactly one real squad player, strictly. Prefers a full-name match,
 * then a unique surname match, then surname + first-initial when a surname is shared (kills the old
 * surname-only bug that attached e.g. Emiliano Martínez's clue to Lautaro Martínez). Returns null
 * when ambiguous or unmatched so the clue is simply skipped.
 */
function resolvePlayer(squad: SquadRow[], name: string, country: string): SquadRow | null {
  const wanted = norm(name);
  const pool = country ? squad.filter((s) => norm(s.country) === norm(country)) : squad;
  const search = pool.length ? pool : squad;

  const exact = search.filter((s) => norm(s.player_name) === wanted);
  if (exact.length === 1) return exact[0]!;

  const tl = lastTok(name);
  if (!tl) return null;
  const byLast = search.filter((s) => lastTok(s.player_name) === tl);
  if (byLast.length === 1) return byLast[0]!;
  if (byLast.length > 1) {
    const fi = firstInitial(name);
    const narrowed = fi ? byLast.filter((s) => firstInitial(s.player_name) === fi) : [];
    if (narrowed.length === 1) return narrowed[0]!;
    return null; // ambiguous surname — don't guess
  }
  return null;
}

function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = ''; let row: string[] = []; let q = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 1; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); field = ''; row = []; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift() ?? [];
  return rows.filter((r) => r.some((c) => c !== '')).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

async function ensureTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS wc_memorable (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      year integer NOT NULL,
      player_id uuid REFERENCES players(id) ON DELETE CASCADE,
      player_name text NOT NULL,
      position text NOT NULL DEFAULT '',
      clue text NOT NULL,
      status text NOT NULL DEFAULT 'active',
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS wc_memorable_unique ON wc_memorable (year, player_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS wc_memorable_year_status_idx ON wc_memorable (year, status)`);
}

async function exportCsv(): Promise<void> {
  const rows = (await db.execute(sql`
    SELECT id, year, status, position, player_name, clue FROM wc_memorable ORDER BY year, position, player_name
  `)) as unknown as Array<Record<string, unknown>>;
  const lines = [COLS.join(',')];
  for (const r of rows) lines.push([r.id, r.year, r.status, r.position, r.player_name, r.clue].map(csvCell).join(','));
  writeFileSync(FILE, lines.join('\n'));
  console.log(`Exported ${rows.length} clues to ${FILE}.`);
}

/** Load every World Cup squad once, indexed by year. */
async function loadSquadsByYear(): Promise<Map<number, SquadRow[]>> {
  const rows = (await db.execute(sql`
    SELECT year, player_name, player_id, country FROM wc_squads WHERE player_id IS NOT NULL
  `)) as unknown as Array<{ year: number; player_name: string; player_id: string; country: string }>;
  const byYear = new Map<number, SquadRow[]>();
  for (const r of rows) {
    const list = byYear.get(r.year) ?? byYear.set(r.year, []).get(r.year)!;
    list.push({ player_name: r.player_name, player_id: r.player_id, country: r.country });
  }
  return byYear;
}

/**
 * Verify + store a batch of proposals. Returns the canonical player names that were stored, so later
 * passes can avoid duplicating them. Tracks (year, player_id) to avoid double-storing in one run.
 */
async function storeProposals(
  proposals: ClueProposal[],
  squadsByYear: Map<number, SquadRow[]>,
  storedKeys: Set<string>,
  awards: AwardSet,
  matchIdx: MatchIndex,
): Promise<{ stored: string[]; rejected: number }> {
  const storedNames: string[] = [];
  let rejected = 0;
  for (const p of proposals) {
    const squad = squadsByYear.get(p.year);
    if (!squad) continue;
    const match = resolvePlayer(squad, p.player, p.country);
    if (!match) continue; // unverified / ambiguous — drop it
    const bad = garbledReason(p.clue)
      ?? awardClaimReason(p.clue, match.player_id, p.year, awards)
      ?? matchClaimReason(p.clue, match.player_id, p.year, matchIdx);
    if (bad) { rejected += 1; continue; }
    const key = `${p.year}|${match.player_id}`;
    if (storedKeys.has(key)) continue;
    storedKeys.add(key);
    await db.execute(sql`
      INSERT INTO wc_memorable (year, player_id, player_name, position, clue, status)
      VALUES (${p.year}, ${match.player_id}::uuid, ${match.player_name}, ${p.position}, ${p.clue}, 'active')
      ON CONFLICT (year, player_id) DO UPDATE SET clue = EXCLUDED.clue, position = EXCLUDED.position
    `);
    storedNames.push(match.player_name);
  }
  return { stored: storedNames, rejected };
}

async function build(): Promise<void> {
  await ensureTable();
  // Full rebuild so older / weaker entries from a previous run are removed.
  await db.execute(sql`DELETE FROM wc_memorable`);

  const squadsByYear = await loadSquadsByYear();
  const awards = await loadAwards();
  const matchIdx = await loadMatchIndex();
  const storedKeys = new Set<string>();
  const seenNames = new Set<string>(); // global avoid-list (normalised) across passes

  const addAvoid = (names: string[]) => { for (const n of names) seenNames.add(norm(n)); };
  const avoidList = () => [...seenNames];
  const note = (n: number) => (n ? ` · ${n} unverifiable claims rejected` : '');

  // Pass 1 — per major nation, position by position, across all its World Cups.
  for (const team of MAJOR_TEAMS) {
    const proposals = await proposeTeamClues(team, YEARS, avoidList(), 24);
    if (!proposals) { console.log(`  ${team}: no proposals (API key / failure)`); continue; }
    const { stored, rejected } = await storeProposals(proposals, squadsByYear, storedKeys, awards, matchIdx);
    addAvoid(stored);
    console.log(`  ${team}: ${proposals.length} proposed · ${stored.length} verified & stored${note(rejected)}`);
  }

  // Pass 2 — per-year catch-all to reach smaller nations and fill positional gaps.
  for (const year of YEARS) {
    const count = year >= 2006 ? 40 : 18;
    const proposals = await proposeYearClues(year, avoidList(), count);
    if (!proposals) { console.log(`  ${year}: no proposals (API key / failure)`); continue; }
    const { stored, rejected } = await storeProposals(proposals, squadsByYear, storedKeys, awards, matchIdx);
    addAvoid(stored);
    console.log(`  ${year}: ${proposals.length} proposed · ${stored.length} verified & stored${note(rejected)}`);
  }

  await exportCsv();
}

async function apply(file: string): Promise<void> {
  const recs = parseCsv(readFileSync(file, 'utf8'));
  let changed = 0;
  for (const r of recs) {
    if (!r.id) continue;
    const status = (r.status ?? '').trim();
    if (!['active', 'rejected'].includes(status)) continue;
    const clue = (r.clue ?? '').trim();
    const res = clue
      ? await db.execute(sql`UPDATE wc_memorable SET status = ${status}, clue = ${clue} WHERE id = ${r.id}::uuid RETURNING id`)
      : await db.execute(sql`UPDATE wc_memorable SET status = ${status} WHERE id = ${r.id}::uuid AND status <> ${status} RETURNING id`);
    if ((res as unknown as unknown[]).length) changed += 1;
  }
  console.log(`Applied ${changed} edits from ${file}.`);
}

/**
 * Re-run the validators (awards + match events) over the EXISTING bank — no Claude calls — and mark
 * any active clue the DB contradicts as rejected. Pass `--dry` to only print what WOULD be rejected
 * (review before committing). Fixes a bank in place when the rules change, without a full regenerate.
 */
async function revalidate(dry: boolean): Promise<void> {
  const awards = await loadAwards();
  const matchIdx = await loadMatchIndex();
  const rows = (await db.execute(sql`
    SELECT id, player_id AS "playerId", player_name AS "playerName", year, clue
    FROM wc_memorable WHERE status = 'active' AND player_id IS NOT NULL
  `)) as unknown as Array<{ id: string; playerId: string; playerName: string; year: number; clue: string }>;
  let rejected = 0;
  for (const r of rows) {
    const reason = garbledReason(r.clue)
      ?? awardClaimReason(r.clue, r.playerId, r.year, awards)
      ?? matchClaimReason(r.clue, r.playerId, r.year, matchIdx);
    if (!reason) continue;
    rejected += 1;
    console.log(`  ${dry ? 'WOULD REJECT' : 'rejected'} [${r.year} ${r.playerName}] (${reason})\n      "${r.clue}"`);
    if (!dry) await db.execute(sql`UPDATE wc_memorable SET status = 'rejected' WHERE id = ${r.id}::uuid`);
  }
  console.log(`\n${dry ? 'DRY RUN — ' : ''}Reviewed ${rows.length} active clues · ${rejected} ${dry ? 'would be ' : ''}rejected.`);
  if (!dry) await exportCsv();
}

async function main() {
  if (process.argv[2] === 'apply') await apply(process.argv[3] ?? FILE);
  else if (process.argv[2] === 'export') await exportCsv();
  else if (process.argv[2] === 'revalidate') await revalidate(process.argv.includes('--dry'));
  else await build();
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
