/**
 * Ingest match-level aggregates from the Transfermarkt Kaggle dump that our season-total
 * stats can't express:
 *   - penalty goals, weak-foot goals (from game_events descriptions)
 *   - Champions League knockout goals, CL goals vs English clubs, CL red cards
 *   - career hat-tricks, goals before 21, age at first goal, age at debut (from appearances)
 *   - international caps (from players.csv)
 *
 * TM player ids are matched to ours by date of birth + name tokens (same approach as
 * import-transfermarkt). The big files (appearances ~150MB, game_events ~150MB) are STREAMED
 * line-by-line; we only ever keep compact per-player counters, then upsert player_extra_stats.
 *
 * Usage: DATABASE_URL=... npx tsx src/jobs/ingest-tm-events.ts [transferdata]
 */
import 'dotenv/config';
import { readFileSync, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

const DIR = process.argv[2] ?? process.env.TM_DIR ?? 'transferdata';
const YEAR_MS = 365.25 * 86_400_000;

function tokens(name: string): Set<string> {
  return new Set(
    name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((t) => t.length > 1)
  );
}
function isSubset(small: Set<string>, big: Set<string>): boolean {
  for (const t of small) if (!big.has(t)) return false;
  return true;
}
/** Exact DOB is highly selective, so one shared name token is enough (lets mononyms match). */
function dobNameMatch(a: Set<string>, b: Set<string>): boolean {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  return small.size >= 1 && isSubset(small, big);
}

/** Whole-file CSV parser (for the small reference files). */
function parseCsv(text: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  let header: string[] | null = null;
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => {
    if (row.length === 1 && row[0] === '') { row = []; return; }
    if (!header) header = row;
    else { const o: Record<string, string> = {}; for (let i = 0; i < header.length; i += 1) o[header[i]!] = row[i] ?? ''; out.push(o); }
    row = [];
  };
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 1; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') pushField();
    else if (c === '\n') { pushField(); pushRow(); }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length > 0) { pushField(); pushRow(); }
  return out;
}

/** Quote-aware split of a single CSV line (one record per line in these dumps). */
function splitLine(line: string): string[] {
  const out: string[] = [];
  let f = '';
  let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { f += '"'; i += 1; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { out.push(f); f = ''; }
    else f += c;
  }
  out.push(f);
  return out;
}

async function streamCsv(path: string, onRow: (cols: string[], idx: Record<string, number>) => void): Promise<void> {
  const rl = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity });
  let idx: Record<string, number> | null = null;
  for await (const line of rl) {
    if (!line) continue;
    const cols = splitLine(line);
    if (!idx) { idx = {}; cols.forEach((c, i) => (idx![c] = i)); continue; }
    onRow(cols, idx);
  }
}

const KNOCKOUT = /knockout|round of 16|quarter-?final|semi-?final|(^|[^a-z])final([^a-z]|$)|last 16|eighth-?final/i;
const isKnockout = (round: string) => KNOCKOUT.test(round) && !/group|qualifying/i.test(round);

interface Agg {
  penaltyGoals: number;
  weakFootGoals: number;
  hattricks: number;
  uclKnockoutGoals: number;
  uclGoalsVsEnglish: number;
  uclRedCards: number;
  goalsBefore21: number;
  firstGoalMs: number | null;
  debutMs: number | null;
  intlCaps: number;
}
const blank = (): Agg => ({
  penaltyGoals: 0, weakFootGoals: 0, hattricks: 0, uclKnockoutGoals: 0, uclGoalsVsEnglish: 0,
  uclRedCards: 0, goalsBefore21: 0, firstGoalMs: null, debutMs: null, intlCaps: 0,
});

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS player_extra_stats (
      player_id uuid PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
      penalty_goals integer NOT NULL DEFAULT 0,
      weak_foot_goals integer NOT NULL DEFAULT 0,
      career_hattricks integer NOT NULL DEFAULT 0,
      ucl_knockout_goals integer NOT NULL DEFAULT 0,
      ucl_goals_vs_english integer NOT NULL DEFAULT 0,
      ucl_red_cards integer NOT NULL DEFAULT 0,
      goals_before_21 integer NOT NULL DEFAULT 0,
      first_goal_age_days integer,
      debut_age_days integer,
      intl_caps integer NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  // ---- Reference tables ----
  console.log('Loading competitions + clubs...');
  const comps = parseCsv(readFileSync(`${DIR}/competitions.csv`, 'utf8'));
  const englishCompIds = new Set<string>();
  const uclCompIds = new Set<string>();
  for (const c of comps) {
    const country = (c.country_name ?? '').toLowerCase();
    const name = (c.name ?? c.competition_code ?? '').toLowerCase();
    if (country === 'england') englishCompIds.add(c.competition_id!);
    if (name.includes('champions-league') || name.includes('champions league') || c.competition_id === 'CL') uclCompIds.add(c.competition_id!);
  }
  const clubCountryIsEnglish = new Map<string, boolean>();
  for (const cl of parseCsv(readFileSync(`${DIR}/clubs.csv`, 'utf8'))) {
    clubCountryIsEnglish.set(cl.club_id!, englishCompIds.has(cl.domestic_competition_id ?? ''));
  }

  console.log('Loading games...');
  interface Game { compId: string; round: string; home: string; away: string; }
  const games = new Map<string, Game>();
  await streamCsv(`${DIR}/games.csv`, (cols, ix) => {
    games.set(cols[ix.game_id]!, {
      compId: cols[ix.competition_id]!, round: cols[ix.round] ?? '',
      home: cols[ix.home_club_id]!, away: cols[ix.away_club_id]!,
    });
  });
  console.log(`  ${games.size} games`);

  // ---- TM players.csv: id → dob, foot, caps, name tokens ----
  console.log('Loading TM players...');
  const tmPlayers = parseCsv(readFileSync(`${DIR}/players.csv`, 'utf8'));
  interface Tm { dob: string | null; foot: string; caps: number; toks: Set<string>; }
  const tmById = new Map<string, Tm>();
  const tmByDob = new Map<string, string[]>(); // dob → tmIds
  for (const p of tmPlayers) {
    const dob = (p.date_of_birth ?? '').slice(0, 10) || null;
    tmById.set(p.player_id!, {
      dob, foot: (p.foot ?? '').toLowerCase(), caps: Number(p.international_caps ?? '0') || 0, toks: tokens(p.name ?? ''),
    });
    if (dob) (tmByDob.get(dob) ?? tmByDob.set(dob, []).get(dob)!).push(p.player_id!);
  }

  // ---- Match TM → ours by DOB + name tokens ----
  const ours = (await db.execute(sql`
    SELECT id, name, birth_date::text AS dob FROM players WHERE birth_date IS NOT NULL
  `)) as unknown as Array<{ id: string; name: string; dob: string }>;
  const tmToOur = new Map<string, string>();    // tmId → our player id
  const dobMsByOur = new Map<string, number>();  // our id → dob ms
  for (const o of ours) {
    const dob = o.dob.slice(0, 10);
    const ourToks = tokens(o.name);
    const cands = (tmByDob.get(dob) ?? []).filter((id) => dobNameMatch(tmById.get(id)!.toks, ourToks));
    if (cands.length === 1) {
      tmToOur.set(cands[0]!, o.id);
      dobMsByOur.set(o.id, Date.parse(`${dob}T00:00:00Z`));
    }
  }
  console.log(`Matched ${tmToOur.size} TM players to ours`);

  const agg = new Map<string, Agg>();
  const get = (ourId: string): Agg => { let a = agg.get(ourId); if (!a) { a = blank(); agg.set(ourId, a); } return a; };

  // Caps from players.csv
  for (const [tmId, t] of tmById) { const o = tmToOur.get(tmId); if (o && t.caps > 0) get(o).intlCaps = t.caps; }

  // ---- Stream appearances: debut, first goal, goals-before-21, hat-tricks ----
  console.log('Streaming appearances.csv...');
  let appRows = 0;
  await streamCsv(`${DIR}/appearances.csv`, (cols, ix) => {
    appRows += 1;
    const ourId = tmToOur.get(cols[ix.player_id]!);
    if (!ourId) return;
    const a = get(ourId);
    const ms = Date.parse(`${cols[ix.date]!}T00:00:00Z`);
    if (!Number.isFinite(ms)) return;
    const goals = Number(cols[ix.goals] ?? '0') || 0;
    if (a.debutMs === null || ms < a.debutMs) a.debutMs = ms;
    if (goals > 0 && (a.firstGoalMs === null || ms < a.firstGoalMs)) a.firstGoalMs = ms;
    if (goals >= 3) a.hattricks += 1;
    if (goals > 0) {
      const dobMs = dobMsByOur.get(ourId);
      if (dobMs !== undefined && ms - dobMs < 21 * YEAR_MS) a.goalsBefore21 += goals;
    }
  });
  console.log(`  ${appRows} appearance rows`);

  // ---- Stream game_events: penalties, weak foot, CL knockout / vs-English / red cards ----
  console.log('Streaming game_events.csv...');
  let evRows = 0;
  await streamCsv(`${DIR}/game_events.csv`, (cols, ix) => {
    evRows += 1;
    const ourId = tmToOur.get(cols[ix.player_id]!);
    if (!ourId) return;
    const type = cols[ix.type] ?? '';
    const desc = cols[ix.description] ?? '';
    const game = games.get(cols[ix.game_id]!);
    const isUcl = game ? uclCompIds.has(game.compId) : false;

    if (type === 'Goals') {
      const a = get(ourId);
      if (/penalty/i.test(desc)) a.penaltyGoals += 1;
      const tmFoot = tmById.get(cols[ix.player_id]!)?.foot ?? '';
      if (/left-footed/i.test(desc) && tmFoot === 'right') a.weakFootGoals += 1;
      else if (/right-footed/i.test(desc) && tmFoot === 'left') a.weakFootGoals += 1;
      if (isUcl && game) {
        if (isKnockout(game.round)) a.uclKnockoutGoals += 1;
        const scorerClub = cols[ix.club_id]!;
        const opponent = scorerClub === game.home ? game.away : game.home;
        if (clubCountryIsEnglish.get(opponent)) a.uclGoalsVsEnglish += 1;
      }
    } else if (type === 'Cards' && isUcl && /red|second yellow/i.test(desc)) {
      get(ourId).uclRedCards += 1;
    }
  });
  console.log(`  ${evRows} event rows`);

  // ---- Upsert ----
  console.log(`Upserting ${agg.size} players...`);
  const days = (ms: number | null, ourId: string): number | null => {
    if (ms === null) return null;
    const dobMs = dobMsByOur.get(ourId);
    return dobMs === undefined ? null : Math.round((ms - dobMs) / 86_400_000);
  };
  const rows = [...agg.entries()];
  for (let i = 0; i < rows.length; i += 300) {
    const batch = rows.slice(i, i + 300);
    const tuples = batch.map(([id, a]) => sql`(${id}::uuid, ${a.penaltyGoals}, ${a.weakFootGoals}, ${a.hattricks}, ${a.uclKnockoutGoals}, ${a.uclGoalsVsEnglish}, ${a.uclRedCards}, ${a.goalsBefore21}, ${days(a.firstGoalMs, id)}, ${days(a.debutMs, id)}, ${a.intlCaps})`);
    await db.execute(sql`
      INSERT INTO player_extra_stats AS p
        (player_id, penalty_goals, weak_foot_goals, career_hattricks, ucl_knockout_goals, ucl_goals_vs_english, ucl_red_cards, goals_before_21, first_goal_age_days, debut_age_days, intl_caps)
      VALUES ${sql.join(tuples, sql`, `)}
      ON CONFLICT (player_id) DO UPDATE SET
        penalty_goals = EXCLUDED.penalty_goals, weak_foot_goals = EXCLUDED.weak_foot_goals,
        career_hattricks = EXCLUDED.career_hattricks, ucl_knockout_goals = EXCLUDED.ucl_knockout_goals,
        ucl_goals_vs_english = EXCLUDED.ucl_goals_vs_english, ucl_red_cards = EXCLUDED.ucl_red_cards,
        goals_before_21 = EXCLUDED.goals_before_21, first_goal_age_days = EXCLUDED.first_goal_age_days,
        debut_age_days = EXCLUDED.debut_age_days, intl_caps = EXCLUDED.intl_caps, updated_at = now()
    `);
  }
  console.log('Done.');

  // ---- Sanity samples ----
  for (const [label, col] of [
    ['Penalty goals', 'penalty_goals'], ['Career hat-tricks', 'career_hattricks'],
    ['CL knockout goals', 'ucl_knockout_goals'], ['CL goals vs English', 'ucl_goals_vs_english'],
    ['Weak-foot goals', 'weak_foot_goals'], ['Intl caps', 'intl_caps'],
  ] as const) {
    const top = (await db.execute(sql`
      SELECT pl.name, e.${sql.raw(col)} AS v FROM player_extra_stats e JOIN players pl ON pl.id = e.player_id
      ORDER BY e.${sql.raw(col)} DESC LIMIT 6
    `)) as unknown as Array<{ name: string; v: number }>;
    console.log(`\n${label}: ` + top.map((t) => `${t.name}(${t.v})`).join(', '));
  }
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
