/**
 * Refresh players.current_club + current_league from the Transfermarkt dump.
 *
 * The API ingest only covers the big-5 leagues, so a player's current club is frozen at
 * their last top-5 season — e.g. Cristiano Ronaldo still shows Manchester United (he's at
 * Al-Nassr), Messi shows PSG (Inter Miami). TM's current_club_name + last_season 2025 are
 * authoritative, so we DOB-match each player and update.
 *
 * For clubs we already know (in the `teams` registry, i.e. top-5) we keep our clean name +
 * canonical league. For clubs abroad (Saudi/MLS/Brazil…) we use a cleaned TM name + the
 * league mapped from the competition slug.
 *
 * Expects CSVs in transferdata/. DRY RUN by default; pass "apply" to write.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

const APPLY = process.argv.includes('apply') || process.env.APPLY === '1';
const DIR = process.argv.slice(2).find((a) => a !== 'apply' && !a.startsWith('-')) ?? process.env.TM_DIR ?? 'transferdata';

// TM domestic-competition codes for the big 5 — players still in these keep our existing
// (clean, API-sourced) current_club; we only refresh players who've LEFT the top-5, which
// is the gap the ingest can't see (Saudi/MLS/Brazil/etc.).
const TOP5_COMPS = new Set(['GB1', 'ES1', 'IT1', 'L1', 'FR1']);

const LEAGUE_BY_ID: Record<number, string> = {
  39: 'Premier League', 140: 'La Liga', 135: 'Serie A', 78: 'Bundesliga', 61: 'Ligue 1',
};
const LEAGUE_OVERRIDE: Record<string, string> = {
  'saudi-pro-league': 'Saudi Pro League', 'major-league-soccer': 'Major League Soccer',
  'campeonato-brasileiro-serie-a': 'Brasileirão', 'liga-portugal': 'Primeira Liga',
  'super-lig': 'Süper Lig', 'premier-league': 'Premier League', 'laliga': 'La Liga',
  'serie-a': 'Serie A', 'bundesliga': 'Bundesliga', 'ligue-1': 'Ligue 1',
  'eredivisie': 'Eredivisie', 'jupiler-pro-league': 'Belgian Pro League',
  'super-league-1': 'Super League Greece', 'superligaen': 'Danish Superliga',
  'premier-liga': 'Russian Premier League', 'scottish-premiership': 'Scottish Premiership',
};
const CLUB_ALIASES: Record<string, string> = {
  'club internacional de futbol miami': 'Inter Miami',
  'al nassr football club': 'Al-Nassr', 'al hilal saudi football club': 'Al-Hilal',
  'al ittihad football club': 'Al-Ittihad', 'al ahli saudi football club': 'Al-Ahli',
  'al ettifaq football club': 'Al-Ettifaq', 'al qadsiah football club': 'Al-Qadsiah',
  'fc internazionale milano': 'Inter', 'internazionale': 'Inter',
};

function norm(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
function tokens(name: string): Set<string> {
  return new Set(norm(name).split(' ').filter((t) => t.length > 1));
}
function leagueName(slug: string): string {
  if (!slug) return 'Unknown';
  return LEAGUE_OVERRIDE[slug] ?? slug.split('-').map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w)).join(' ');
}
function cleanClub(raw: string): string {
  const n = norm(raw);
  if (CLUB_ALIASES[n]) return CLUB_ALIASES[n];
  return raw.trim()
    .replace(/\s+(Saudi\s+)?Football\s+Club$/i, '')
    .replace(/^(Esporte|Futebol|Sport)\s+Clube?\s+/i, '')
    .replace(/\s+(Esporte|Futebol)\s+Clube?$/i, '')
    .replace(/\s+(a\.s\.|S\.A\.D\.)$/i, '')
    .trim() || raw.trim();
}
function parseCsv(text: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  let header: string[] | null = null; let field = ''; let row: string[] = []; let q = false;
  const pf = () => { row.push(field); field = ''; };
  const pr = () => { if (row.length === 1 && row[0] === '') { row = []; return; } if (!header) header = row; else { const o: Record<string, string> = {}; for (let i = 0; i < header.length; i += 1) o[header[i]!] = row[i] ?? ''; out.push(o); } row = []; };
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 1; } else q = false; } else field += c; }
    else if (c === '"') q = true; else if (c === ',') pf(); else if (c === '\n') { pf(); pr(); } else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { pf(); pr(); }
  return out;
}

async function main() {
  console.log(`Refresh current_club from Transfermarkt — ${APPLY ? 'APPLY (writing)' : 'DRY RUN'}\n`);

  const comps = parseCsv(readFileSync(`${DIR}/competitions.csv`, 'utf8'));
  const compName = new Map<string, string>();
  for (const c of comps) compName.set(c.competition_id!, leagueName(c.name ?? ''));

  const tm = parseCsv(readFileSync(`${DIR}/players.csv`, 'utf8'));
  const byDob = new Map<string, Array<{ club: string; comp: string; toks: Set<string>; nname: string }>>();
  for (const p of tm) {
    const dob = (p.date_of_birth ?? '').slice(0, 10);
    if (!dob || !p.current_club_name) continue;
    (byDob.get(dob) ?? byDob.set(dob, []).get(dob)!).push({ club: p.current_club_name, comp: p.current_club_domestic_competition_id ?? '', toks: tokens(p.name ?? ''), nname: norm(p.name ?? '') });
  }

  // Registry of known clubs → clean name + (top-5) league. Exact map for all teams, plus a
  // big-league list for substring resolution (TM's "Parma Calcio 1913" → our "Parma").
  const teamRows = (await db.execute(sql`SELECT name, league_id FROM teams`)) as unknown as Array<{ name: string; league_id: number | null }>;
  const registry = new Map<string, { name: string; league: string | null }>();
  const bigTeams: Array<{ norm: string; name: string; league: string }> = [];
  for (const t of teamRows) {
    const lg = t.league_id != null ? LEAGUE_BY_ID[t.league_id] ?? null : null;
    const n = norm(t.name);
    if (!registry.has(n)) registry.set(n, { name: t.name, league: lg });
    if (lg && n.length >= 4) bigTeams.push({ norm: n, name: t.name, league: lg });
  }
  bigTeams.sort((a, b) => b.norm.length - a.norm.length); // prefer the longest (most specific) match

  /** Resolve a TM club name to our clean registry name when it's a club we know. */
  function lookupRegistry(tmName: string): { name: string; league: string | null } | null {
    const n = norm(tmName);
    const exact = registry.get(n);
    if (exact) return exact;
    // Token-subset: a big-league team whose every name token appears in the TM name —
    // e.g. {parma} ⊆ "Parma Calcio 1913", {atletico,madrid} ⊆ "Club Atlético de Madrid",
    // {borussia,monchengladbach} ⊆ "Borussia Verein für Leibesübungen 1900 Mönchengladbach".
    // Require >=2 tokens so a 1-token club (Inter) can't swallow "Inter Miami".
    const nt = new Set(n.split(' ').filter((w) => w.length > 1));
    for (const t of bigTeams) {
      const tt = t.norm.split(' ').filter((w) => w.length > 1);
      if (tt.length >= 2 && tt.every((w) => nt.has(w))) return { name: t.name, league: t.league };
    }
    return null;
  }

  const ours = (await db.execute(sql`
    SELECT id, name, current_club, current_league, birth_date::text AS dob FROM players WHERE birth_date IS NOT NULL
  `)) as unknown as Array<{ id: string; name: string; current_club: string; current_league: string; dob: string }>;

  const updates: Array<{ id: string; club: string; league: string }> = [];
  const examples: string[] = [];
  for (const o of ours) {
    const a = tokens(o.name);
    const on = norm(o.name);
    // Strict: exact name, or a token-subset sharing >=2 tokens (avoids mononym false-matches
    // like "Cabrera" → "Leandro Cabrera" that would write a wrong current club).
    const cands = (byDob.get(o.dob.slice(0, 10)) ?? []).filter((t) => {
      if (t.nname === on) return true;
      const [small, big] = a.size <= t.toks.size ? [a, t.toks] : [t.toks, a];
      return small.size >= 2 && [...small].every((x) => big.has(x));
    });
    if (cands.length !== 1) continue;
    const tmClub = cands[0]!;
    if (TOP5_COMPS.has(tmClub.comp)) continue; // still in the big-5 → keep our clean data
    const reg = lookupRegistry(tmClub.club);
    const club = reg ? reg.name : cleanClub(tmClub.club);
    const league = reg && reg.league ? reg.league : (compName.get(tmClub.comp) ?? o.current_league);
    if (club !== o.current_club || league !== o.current_league) {
      updates.push({ id: o.id, club, league });
      if (examples.length < 20 && o.current_club !== club) examples.push(`${o.name}: ${o.current_club} (${o.current_league}) → ${club} (${league})`);
    }
  }

  console.log(`${updates.length} players to update\n`);
  for (const e of examples) console.log(`  ${e}`);

  if (APPLY) {
    for (let i = 0; i < updates.length; i += 500) {
      const batch = updates.slice(i, i + 500);
      const tuples = batch.map((u) => sql`(${u.id}::uuid, ${u.club}::text, ${u.league}::text)`);
      await db.execute(sql`
        UPDATE players AS p SET current_club = v.club, current_league = v.league
        FROM (VALUES ${sql.join(tuples, sql`, `)}) AS v(id, club, league) WHERE p.id = v.id
      `);
    }
    console.log(`\nApplied ${updates.length} current-club updates.`);
  } else {
    console.log('\n(DRY RUN — re-run with "apply" to write.)');
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
