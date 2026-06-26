/**
 * Ingest match-level World Cup events from StatsBomb open data (free, no auth) into
 * wc_match_events: goals (scorer + minute + penalty flag + assist), own goals, cards, and
 * penalty-shootout takers/saves — each with match date / stage / opponent.
 *
 * StatsBomb covers WC 2018 (season_id 3) and 2022 (season_id 106) under competition_id 43.
 * Players are matched to ours via the wc_squads roster for that (year, country) — a tiny,
 * reliable candidate pool — by surname + token overlap (StatsBomb uses full legal names).
 *
 * Usage: DATABASE_URL=... npx tsx src/jobs/ingest-wc-events-statsbomb.ts
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

const BASE = 'https://raw.githubusercontent.com/statsbomb/open-data/master/data';
const SEASONS: Array<{ year: number; seasonId: number }> = [
  { year: 2018, seasonId: 3 },
  { year: 2022, seasonId: 106 },
];

// StatsBomb team name → our wc_squads country, where they differ.
const COUNTRY_ALIAS: Record<string, string> = {
  'Korea Republic': 'South Korea',
  'IR Iran': 'Iran',
  'United States': 'United States',
  China: 'China PR',
};

function norm(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}
function toks(name: string): string[] {
  return norm(name).replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((t) => t.length > 1);
}
function country(team: string): string { return COUNTRY_ALIAS[team] ?? team; }

async function getJson<T>(url: string): Promise<T | null> {
  const r = await fetch(url, { headers: { 'User-Agent': 'BallKnowledge/1.0' } });
  if (!r.ok) return null;
  return (await r.json()) as T;
}

interface SquadMember { tokens: Set<string>; surname: string; playerId: string; }
interface EventRow {
  year: number; matchId: number; matchDate: string; stage: string; team: string; opponent: string;
  playerId: string | null; playerName: string; type: string; minute: number | null;
  detail: string | null; assistPlayerId: string | null; assistPlayerName: string | null;
}

async function main() {
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
  await db.execute(sql`CREATE INDEX IF NOT EXISTS wc_match_events_player_idx ON wc_match_events (player_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS wc_match_events_year_type_idx ON wc_match_events (year, type)`);

  // Roster for matching: wc_squads (year, country) → members with player_id.
  const squad = (await db.execute(sql`
    SELECT year, country, player_name, player_id FROM wc_squads WHERE player_id IS NOT NULL
  `)) as unknown as Array<{ year: number; country: string; player_name: string; player_id: string }>;
  const byYC = new Map<string, SquadMember[]>();
  for (const s of squad) {
    const key = `${s.year}|${norm(s.country)}`;
    const t = toks(s.player_name);
    if (t.length === 0) continue;
    (byYC.get(key) ?? byYC.set(key, []).get(key)!).push({ tokens: new Set(t), surname: t[t.length - 1]!, playerId: s.player_id });
  }
  const matchPlayer = (year: number, team: string, sbName: string): string | null => {
    const cands = byYC.get(`${year}|${norm(country(team))}`) ?? [];
    const st = new Set(toks(sbName));
    let best: { id: string; score: number } | null = null;
    for (const c of cands) {
      if (!st.has(c.surname)) continue; // surname must appear in the StatsBomb (full) name
      let score = 0;
      for (const t of c.tokens) if (st.has(t)) score += 1;
      if (!best || score > best.score) best = { id: c.playerId, score };
    }
    return best?.id ?? null;
  };

  const all: EventRow[] = [];

  for (const { year, seasonId } of SEASONS) {
    const matches = await getJson<any[]>(`${BASE}/matches/43/${seasonId}.json`);
    if (!matches) { console.log(`  ${year}: no matches file`); continue; }
    console.log(`  ${year}: ${matches.length} matches`);

    // Fetch event files in small parallel batches.
    for (let i = 0; i < matches.length; i += 6) {
      const batch = matches.slice(i, i + 6);
      await Promise.all(batch.map(async (m) => {
        const [events, lineups] = await Promise.all([
          getJson<any[]>(`${BASE}/events/${m.match_id}.json`),
          getJson<any[]>(`${BASE}/lineups/${m.match_id}.json`),
        ]);
        if (!events) return;
        const home = m.home_team.home_team_name;
        const away = m.away_team.away_team_name;
        const stage = m.competition_stage?.name ?? '';
        const meta = { year, matchId: m.match_id as number, matchDate: m.match_date as string, stage };
        const oppOf = (team: string) => (team === home ? away : home);
        const byId = new Map(events.map((e) => [e.id, e]));
        // StatsBomb uses full legal names in events; the lineup carries the common nickname
        // ("Gavi", "Pedri") which matches our roster + reads better as a display name.
        const nick = new Map<number, string>();
        for (const t of lineups ?? []) for (const p of t.lineup ?? []) {
          if (p.player_nickname) nick.set(p.player_id, p.player_nickname);
        }
        const commonName = (pl: any): string => (pl?.id != null ? nick.get(pl.id) : undefined) ?? pl?.name ?? '';

        for (const e of events) {
          const team = e.team?.name;
          const pName = commonName(e.player);
          const mkBase = (player: string, pid: string | null, type: string, minute: number | null, detail: string | null,
            aId: string | null = null, aName: string | null = null): EventRow => ({
            ...meta, team, opponent: oppOf(team), playerId: pid, playerName: player, type, minute, detail, assistPlayerId: aId, assistPlayerName: aName,
          });

          if (e.type?.name === 'Shot' && e.shot?.outcome?.name === 'Goal') {
            const isPen = e.shot?.type?.name === 'Penalty';
            const shootout = e.period === 5;
            // assist via key pass
            let aId: string | null = null; let aName: string | null = null;
            const kp = e.shot?.key_pass_id ? byId.get(e.shot.key_pass_id) : null;
            if (kp?.pass?.goal_assist && kp.player) { aName = commonName(kp.player); aId = matchPlayer(year, kp.team?.name ?? team, aName!); }
            if (shootout) {
              all.push(mkBase(pName, matchPlayer(year, team, pName), 'shootout_pen', null, 'scored'));
            } else {
              all.push(mkBase(pName, matchPlayer(year, team, pName), 'goal', e.minute ?? null, isPen ? 'penalty' : null, aId, aName));
            }
          } else if (e.type?.name === 'Shot' && e.period === 5) {
            // missed/saved shootout penalty
            const out = (e.shot?.outcome?.name ?? '').toLowerCase();
            const detail = out.includes('saved') ? 'saved' : 'missed';
            all.push(mkBase(pName, matchPlayer(year, team, pName), 'shootout_pen', null, detail));
          } else if (e.type?.name === 'Own Goal Against') {
            // player who put it into their own net (team = their team)
            all.push(mkBase(pName, matchPlayer(year, team, pName), 'own_goal', e.minute ?? null, null));
          } else if (e.foul_committed?.card || e.bad_behaviour?.card) {
            const card = (e.foul_committed?.card || e.bad_behaviour?.card).name;
            all.push(mkBase(pName, matchPlayer(year, team, pName), 'card', e.minute ?? null, card));
          } else if (e.type?.name === 'Goal Keeper' && e.period === 5 && /saved/i.test(e.goalkeeper?.type?.name ?? '')) {
            all.push(mkBase(pName, matchPlayer(year, team, pName), 'shootout_save', null, null));
          }
        }
      }));
    }
    console.log(`  ${year}: events parsed (running total ${all.length})`);
  }

  const matched = all.filter((r) => r.playerId).length;
  console.log(`\n${all.length} events · ${matched} matched to players (${Math.round((matched / all.length) * 100)}%)`);

  await db.execute(sql`DELETE FROM wc_match_events WHERE year IN (2018, 2022)`);
  for (let i = 0; i < all.length; i += 400) {
    const batch = all.slice(i, i + 400);
    const tuples = batch.map((r) => sql`(${r.year}, ${r.matchId}, ${r.matchDate}::date, ${r.stage}, ${r.team}, ${r.opponent}, ${r.playerId}::uuid, ${r.playerName}, ${r.type}, ${r.minute}, ${r.detail}, ${r.assistPlayerId}::uuid, ${r.assistPlayerName})`);
    await db.execute(sql`
      INSERT INTO wc_match_events (year, match_id, match_date, stage, team, opponent, player_id, player_name, type, minute, detail, assist_player_id, assist_player_name)
      VALUES ${sql.join(tuples, sql`, `)}
    `);
  }
  console.log('Inserted.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
