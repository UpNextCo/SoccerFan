/**
 * Backfill missing league/CL/EL assist totals from the Transfermarkt match-level dump.
 *
 * Our season-total ingest has a systemic ASSIST gap for ~2010-2014 (goals present, assists
 * zero or token) across every competition, which undercounts assist categories for that era
 * (e.g. Müller's Champions League assists showed 19 vs a true ~30). Transfermarkt's
 * appearances.csv records per-game assists from 2012 onward, so we re-derive season assist
 * totals from it and fill ONLY the broken gap seasons (detected by an abnormally low
 * assists:goals ratio); league-seasons that already have real assist data are left untouched.
 *
 * TM player ids are matched to ours by DOB + name tokens (our external_id is NOT the TM id),
 * mirroring ingest-tm-events.
 *
 * Usage: DATABASE_URL=... npx tsx src/jobs/backfill-assists-tm.ts [transferdata]
 */
import 'dotenv/config';
import { readFileSync, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

const DIR = process.argv[2] ?? process.env.TM_DIR ?? 'transferdata';

const COMP_TO_LEAGUE: Record<string, number> = {
  GB1: 39, ES1: 140, IT1: 135, L1: 78, FR1: 61, CL: 2, EL: 3,
};

function tokens(name: string): Set<string> {
  return new Set(
    name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((t) => t.length > 1)
  );
}
function isSubset(small: Set<string>, big: Set<string>): boolean {
  for (const t of small) if (!big.has(t)) return false;
  return true;
}
function dobNameMatch(a: Set<string>, b: Set<string>): boolean {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  return small.size >= 1 && isSubset(small, big);
}

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
    if (inQuotes) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 1; } else inQuotes = false; } else field += c; }
    else if (c === '"') inQuotes = true;
    else if (c === ',') pushField();
    else if (c === '\n') { pushField(); pushRow(); }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length > 0) { pushField(); pushRow(); }
  return out;
}

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

function seasonOf(date: string): number | null {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  if (!y || !m) return null;
  return m >= 7 ? y : y - 1;
}

async function main() {
  // 1) Broken (league, season) pairs — assists far too low relative to goals (true gaps are
  //    near-zero; a healthy season runs ~0.5-0.75 assists per goal).
  const ratioRows = (await db.execute(sql`
    SELECT league_id, season, SUM(assists)::int AS a, SUM(goals)::int AS g FROM player_stats
    WHERE league_id IN (39, 140, 135, 78, 61, 2, 3)
    GROUP BY league_id, season
    HAVING SUM(goals) > 50 AND SUM(assists) < 0.2 * SUM(goals)
  `)) as unknown as Array<{ league_id: number; season: number; a: number; g: number }>;
  const gapSet = new Set(ratioRows.map((r) => `${r.league_id}|${r.season}`));
  console.log(`${gapSet.size} broken league-seasons:`, ratioRows.map((r) => `${r.league_id}/${r.season}(${r.a}a:${r.g}g)`).join(', '));
  if (gapSet.size === 0) { console.log('Nothing to backfill.'); process.exit(0); }

  // 2) Match TM player ids → ours by DOB + name tokens.
  console.log('Loading TM players.csv...');
  const tmPlayers = parseCsv(readFileSync(`${DIR}/players.csv`, 'utf8'));
  const tmToks = new Map<string, Set<string>>();
  const tmByDob = new Map<string, string[]>();
  for (const p of tmPlayers) {
    const dob = (p.date_of_birth ?? '').slice(0, 10) || null;
    tmToks.set(p.player_id!, tokens(p.name ?? ''));
    if (dob) (tmByDob.get(dob) ?? tmByDob.set(dob, []).get(dob)!).push(p.player_id!);
  }
  const ours = (await db.execute(sql`SELECT id, name, birth_date::text AS dob FROM players WHERE birth_date IS NOT NULL`)) as unknown as Array<{ id: string; name: string; dob: string }>;
  const tmToOur = new Map<string, string>();
  for (const o of ours) {
    const dob = o.dob.slice(0, 10);
    const ourToks = tokens(o.name);
    const cands = (tmByDob.get(dob) ?? []).filter((id) => dobNameMatch(tmToks.get(id)!, ourToks));
    if (cands.length === 1) tmToOur.set(cands[0]!, o.id);
  }
  console.log(`Matched ${tmToOur.size} TM players to ours`);

  // 3) Stream appearances.csv → assists per (ourPlayer, league, season) for broken seasons only.
  const agg = new Map<string, number>();
  let scanned = 0;
  await streamCsv(`${DIR}/appearances.csv`, (cols, ix) => {
    scanned += 1;
    const league = COMP_TO_LEAGUE[cols[ix.competition_id]!];
    if (!league) return;
    const season = seasonOf(cols[ix.date]!);
    if (season === null || !gapSet.has(`${league}|${season}`)) return;
    const assists = Number(cols[ix.assists]) || 0;
    if (assists <= 0) return;
    const ourId = tmToOur.get(cols[ix.player_id]!);
    if (!ourId) return;
    const key = `${ourId}|${league}|${season}`;
    agg.set(key, (agg.get(key) ?? 0) + assists);
  });
  console.log(`Scanned ${scanned} appearances · ${agg.size} (player,league,season) assist totals derived`);

  // 4) Target the existing row with the most apps per (player,league,season) so a rare two-club
  //    season isn't double-counted, then overwrite its (broken) assists with the TM total.
  const rows = (await db.execute(sql`
    SELECT id, player_id, league_id, season, appearances FROM player_stats
    WHERE league_id IN (39, 140, 135, 78, 61, 2, 3)
  `)) as unknown as Array<{ id: string; player_id: string; league_id: number; season: number; appearances: number }>;
  const bestRow = new Map<string, { id: string; apps: number }>();
  for (const r of rows) {
    if (!gapSet.has(`${r.league_id}|${r.season}`)) continue;
    const key = `${r.player_id}|${r.league_id}|${r.season}`;
    const cur = bestRow.get(key);
    if (!cur || r.appearances > cur.apps) bestRow.set(key, { id: r.id, apps: r.appearances });
  }

  const updates: Array<{ id: string; assists: number }> = [];
  for (const [key, assists] of agg) {
    const target = bestRow.get(key);
    if (target) updates.push({ id: target.id, assists });
  }
  console.log(`${updates.length} player_stats rows to update`);

  let done = 0;
  for (let i = 0; i < updates.length; i += 500) {
    const batch = updates.slice(i, i + 500);
    const values = sql.join(batch.map((u) => sql`(${u.id}::uuid, ${u.assists}::int)`), sql`, `);
    await db.execute(sql`
      UPDATE player_stats AS s SET assists = v.a
      FROM (VALUES ${values}) AS v(id, a)
      WHERE s.id = v.id
    `);
    done += batch.length;
  }
  console.log(`Updated ${done} rows.`);
  process.exit(0);
}

main();
