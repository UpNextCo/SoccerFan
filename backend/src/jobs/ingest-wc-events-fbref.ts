/**
 * Ingest game-by-game World Cup events scraped from FBref (scripts/fbref_wc_matches_scrape.py)
 * into wc_match_events: goals (open-play + penalty), own goals and cards — each with minute,
 * stage and opponent. FBref's match-report event feed is complete and internally consistent, so
 * this REPLACES the patchy Wikipedia/StatsBomb goal data for the scraped years (which missed real
 * goals and caused the clue validator to false-reject true clues).
 *
 * Players are matched to ours via the wc_squads roster for that (year, country) — the same tiny,
 * reliable candidate pool the StatsBomb ingest uses — by surname + token overlap. The scraper's
 * a/b side is only a hint; we resolve each player against BOTH teams' squads so own goals (credited
 * on the beneficiary's side by FBref) still land on the conceding player's own country.
 *
 * Only goal/own_goal/card rows are deleted+reinserted for the scraped years; existing shootout
 * rows (shootout_pen/shootout_save) are preserved.
 *
 * Usage: DATABASE_URL=... npx tsx src/jobs/ingest-wc-events-fbref.ts [path-to-json]
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

const FILE = 'fbref_wc_events.json';

// FBref national-team name → our wc_squads country, where they differ.
const COUNTRY_ALIAS: Record<string, string> = {
  'Korea Republic': 'South Korea',
  'Korea DPR': 'North Korea',
  'IR Iran': 'Iran',
  China: 'China PR',
  'United States': 'United States',
  Czechia: 'Czech Republic',
  Türkiye: 'Turkey',
};

interface RawEvent {
  year: number; stage: string; date: string; home: string; away: string;
  side: string; player: string; minute: number | null; type: string; detail: string;
}
interface SquadMember { tokens: Set<string>; surname: string; playerId: string }

function norm(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}
function toks(name: string): string[] {
  return norm(name).replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((t) => t.length > 1);
}
function country(team: string): string { return COUNTRY_ALIAS[team] ?? team; }
function hashInt(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
  return Math.abs(h);
}

async function main() {
  const path = process.argv[2] ?? FILE;
  const events = JSON.parse(readFileSync(path, 'utf8')) as RawEvent[];
  if (!events.length) { console.log('No events in JSON; nothing to do.'); process.exit(0); }
  const years = [...new Set(events.map((e) => e.year))].sort();
  console.log(`Loaded ${events.length} FBref events across ${years.join(', ')}`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS wc_match_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      year integer NOT NULL, match_id integer NOT NULL, match_date date,
      stage text NOT NULL DEFAULT '', team text NOT NULL, opponent text NOT NULL DEFAULT '',
      player_id uuid REFERENCES players(id) ON DELETE SET NULL, player_name text NOT NULL,
      type text NOT NULL, minute integer, detail text,
      assist_player_id uuid REFERENCES players(id) ON DELETE SET NULL, assist_player_name text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);

  // Roster for matching: wc_squads (year, country) → members with player_id.
  const squad = (await db.execute(sql`
    SELECT year, country, player_name, player_id FROM wc_squads WHERE player_id IS NOT NULL
  `)) as unknown as Array<{ year: number; country: string; player_name: string; player_id: string }>;
  const byYC = new Map<string, SquadMember[]>();
  for (const s of squad) {
    const t = toks(s.player_name);
    if (!t.length) continue;
    const key = `${s.year}|${norm(s.country)}`;
    (byYC.get(key) ?? byYC.set(key, []).get(key)!).push({ tokens: new Set(t), surname: t[t.length - 1]!, playerId: s.player_id });
  }
  const matchInSquad = (year: number, team: string, name: string): string | null => {
    const cands = byYC.get(`${year}|${norm(country(team))}`) ?? [];
    const st = new Set(toks(name));
    let best: { id: string; score: number } | null = null;
    for (const c of cands) {
      if (!st.has(c.surname)) continue; // surname must appear in the FBref name
      let score = 0;
      for (const t of c.tokens) if (st.has(t)) score += 1;
      if (!best || score > best.score) best = { id: c.playerId, score };
    }
    return best?.id ?? null;
  };

  interface Row { year: number; matchId: number; matchDate: string | null; stage: string; team: string; opponent: string; playerId: string | null; playerName: string; type: string; minute: number | null; detail: string | null }
  const rows: Row[] = [];
  let unmatched = 0;
  for (const e of events) {
    // For own goals FBref credits the event to the beneficiary's side; the scorer's own team is the
    // OTHER side. Use the side hint, but resolve by squad-matching against both teams to be safe.
    const sideTeam = e.side === 'a' ? e.home : e.away;
    const otherTeam = e.side === 'a' ? e.away : e.home;
    const guessTeam = e.type === 'own_goal' ? otherTeam : sideTeam;
    const guessOpp = e.type === 'own_goal' ? sideTeam : otherTeam;

    let team = guessTeam; let opponent = guessOpp;
    let pid = matchInSquad(e.year, team, e.player);
    if (!pid) {
      const alt = matchInSquad(e.year, guessOpp, e.player);
      if (alt) { pid = alt; team = guessOpp; opponent = guessTeam; }
    }
    if (!pid) unmatched += 1;

    rows.push({
      year: e.year,
      matchId: hashInt(`${e.year}|${e.home}|${e.away}`),
      matchDate: /^\d{4}-\d{2}-\d{2}$/.test(e.date) ? e.date : null,
      stage: e.stage,
      team,
      opponent,
      playerId: pid,
      playerName: e.player,
      type: e.type,
      minute: e.minute,
      detail: e.detail || null,
    });
  }
  const matched = rows.length - unmatched;
  console.log(`${rows.length} events · ${matched} matched to players (${Math.round((matched / rows.length) * 100)}%)`);

  // Replace only the goal/own_goal/card rows for the scraped years; keep shootout data intact.
  await db.execute(sql`
    DELETE FROM wc_match_events
    WHERE year = ANY(${years}) AND type IN ('goal', 'own_goal', 'card')
  `);
  for (let i = 0; i < rows.length; i += 400) {
    const batch = rows.slice(i, i + 400);
    const tuples = batch.map((r) => sql`(${r.year}, ${r.matchId}, ${r.matchDate}::date, ${r.stage}, ${r.team}, ${r.opponent}, ${r.playerId}::uuid, ${r.playerName}, ${r.type}, ${r.minute}, ${r.detail})`);
    await db.execute(sql`
      INSERT INTO wc_match_events (year, match_id, match_date, stage, team, opponent, player_id, player_name, type, minute, detail)
      VALUES ${sql.join(tuples, sql`, `)}
    `);
  }
  console.log(`Inserted ${rows.length} rows for ${years.join(', ')}.`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
