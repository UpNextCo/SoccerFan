/**
 * Backfill players.api_football_id so we can show headshots from the API-Football media CDN
 * (https://media.api-sports.io/football/players/{id}.png — quota-free).
 *
 * Two passes:
 *   1) Free: copy the numeric external_id (API-Football id) into api_football_id for every player
 *      that was ingested from API-Football.
 *   2) Famous historical players that have no API-Football id (ingested from Transfermarkt/
 *      Wikipedia/FBref): look them up via /players/profiles?search={lastname} and match strictly on
 *      birth YEAR + nationality so we never attach the wrong face.
 *
 * Usage: API_FOOTBALL_KEY=xxx DATABASE_URL=xxx npm run job:backfill-api-football-ids
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { canonicalNationality } from '../utils/nationality.js';

const API_KEY = process.env.API_FOOTBALL_KEY;
const REQUEST_DELAY_MS = 200;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Profile {
  id: number;
  name: string;
  firstname: string | null;
  lastname: string | null;
  birth: { date: string | null } | null;
  nationality: string | null;
}

function fold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
}
function tokens(s: string): Set<string> {
  return new Set(fold(s).split(' ').filter((t) => t.length > 1));
}
function lastNameOf(name: string): string {
  const parts = fold(name).split(' ').filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

const MAX_PAGES = 3;

async function fetchPage(lastname: string, page: number): Promise<{ players: Profile[]; total: number } | null> {
  const url = `https://v3.football.api-sports.io/players/profiles?search=${encodeURIComponent(lastname)}&page=${page}`;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const res = await fetch(url, { headers: { 'x-apisports-key': API_KEY! } });
    if (res.status === 429) { await sleep(3000 * (attempt + 1)); continue; }
    if (!res.ok) { await sleep(500); continue; }
    const json = (await res.json()) as { response?: Array<{ player: Profile }>; paging?: { total?: number } };
    return { players: (json.response ?? []).map((r) => r.player), total: json.paging?.total ?? 1 };
  }
  return null;
}

/** All matching profiles for a lastname (paginated, so common surnames aren't truncated). */
async function fetchProfiles(lastname: string): Promise<Profile[]> {
  const out: Profile[] = [];
  let page = 1;
  let total = 1;
  while (page <= total && page <= MAX_PAGES) {
    const res = await fetchPage(lastname, page);
    if (!res) break;
    out.push(...res.players);
    total = res.total;
    page += 1;
    if (page <= total && page <= MAX_PAGES) await sleep(REQUEST_DELAY_MS);
  }
  return out;
}

interface Target { id: string; name: string; nationality: string; birth_year: number; }

async function main() {
  if (!API_KEY) throw new Error('API_FOOTBALL_KEY not set');

  await db.execute(sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS api_football_id integer`);

  // Pass 1 — free copy from the numeric external_id.
  const copied = (await db.execute(sql`
    UPDATE players SET api_football_id = external_id::int
    WHERE api_football_id IS NULL AND external_id ~ '^[0-9]+$'
  `)) as unknown as { rowCount?: number };
  console.log(`Pass 1: copied api_football_id from external_id (${copied.rowCount ?? '?'} rows).`);

  // Pass 2 — famous historical players with no API-Football id, matchable by DOB.
  const targets = (await db.execute(sql`
    SELECT p.id, p.name, p.nationality, EXTRACT(YEAR FROM p.birth_date)::int AS birth_year
    FROM players p
    WHERE p.api_football_id IS NULL AND p.birth_date IS NOT NULL
      AND (
        p.market_value_tier >= 3
        OR EXISTS (SELECT 1 FROM final_appearances f WHERE f.player_id = p.id)
        OR EXISTS (SELECT 1 FROM player_awards a WHERE a.player_id = p.id)
      )
    ORDER BY p.market_value_tier DESC, p.peak_market_value_eur DESC NULLS LAST
  `)) as unknown as Target[];
  console.log(`Pass 2: ${targets.length} famous players to look up.`);

  let matched = 0;
  let processed = 0;
  for (const t of targets) {
    processed += 1;
    const lastname = lastNameOf(t.name);
    if (lastname.length < 3) continue;

    const profiles = await fetchProfiles(lastname);
    await sleep(REQUEST_DELAY_MS);
    if (!profiles.length) continue;

    const ourNat = canonicalNationality(t.nationality);
    const ourTokens = tokens(t.name);
    const nameOverlap = (p: Profile): number => {
      const ct = tokens(`${p.firstname ?? ''} ${p.lastname ?? ''} ${p.name}`);
      let n = 0;
      for (const tok of ourTokens) if (ct.has(tok)) n += 1;
      return n;
    };
    const bestByName = (list: Profile[]): Profile | undefined => {
      let best = 0;
      let pick: Profile | undefined;
      for (const c of list) { const o = nameOverlap(c); if (o > best) { best = o; pick = c; } }
      return best >= 1 ? pick : undefined; // require a real name overlap
    };

    // Same nationality + a usable DOB.
    const sameNat = profiles.filter((p) => p.birth?.date && canonicalNationality(p.nationality ?? '') === ourNat);
    const yearOf = (p: Profile) => Number(p.birth!.date!.slice(0, 4));

    // Prefer an exact birth-year match; fall back to ±1 year (minor DOB discrepancies) but then
    // require a name-token overlap so we never attach a stranger's face.
    const exact = sameNat.filter((p) => yearOf(p) === t.birth_year);
    let chosen: Profile | undefined;
    if (exact.length === 1) chosen = exact[0];
    else if (exact.length > 1) chosen = bestByName(exact);
    else {
      const near = sameNat.filter((p) => Math.abs(yearOf(p) - t.birth_year) <= 1);
      chosen = bestByName(near);
    }

    // Note: we intentionally allow the same api_football_id on more than one of our rows — duplicate
    // records for the same person (e.g. "Kaká" and "Ricardo dos Santos Leite") should both get the face.
    if (!chosen) continue;
    await db.execute(sql`UPDATE players SET api_football_id = ${chosen.id} WHERE id = ${t.id}::uuid`);
    matched += 1;
    if (processed % 25 === 0) console.log(`  …${processed}/${targets.length} processed, ${matched} matched`);
  }

  console.log(`Pass 2 done: matched ${matched}/${targets.length}.`);

  // Pass 3 — famous players with NO DOB. Match by name + nationality, but guard with the ERA they
  // actually played (the API candidate's birth year must make them 14–40 at their earliest season),
  // and require ALL our name tokens to be present in the candidate (so it's the same person, not a
  // same-surname stranger). Only accept a UNIQUE candidate, then write BOTH the id and the DOB.
  const noDob = (await db.execute(sql`
    SELECT p.id, p.name, p.nationality,
      (SELECT MIN(season) FROM player_stats s WHERE s.player_id = p.id)::int AS min_season
    FROM players p
    WHERE p.api_football_id IS NULL AND p.birth_date IS NULL
      AND (p.market_value_tier >= 3
           OR EXISTS (SELECT 1 FROM final_appearances f WHERE f.player_id = p.id)
           OR EXISTS (SELECT 1 FROM player_awards a WHERE a.player_id = p.id))
  `)) as unknown as Array<{ id: string; name: string; nationality: string; min_season: number | null }>;
  const datable = noDob.filter((t) => t.min_season != null);
  console.log(`Pass 3: ${datable.length} famous players with no DOB to match by name + era.`);

  let p3 = 0;
  let p3proc = 0;
  for (const t of datable) {
    p3proc += 1;
    const lastname = lastNameOf(t.name);
    if (lastname.length < 3) continue;
    const profiles = await fetchProfiles(lastname);
    await sleep(REQUEST_DELAY_MS);
    if (!profiles.length) continue;

    const ourNat = canonicalNationality(t.nationality);
    const ourTokens = tokens(t.name);
    const minS = t.min_season!;
    const cands = profiles.filter((p) => {
      if (!p.birth?.date || canonicalNationality(p.nationality ?? '') !== ourNat) return false;
      const by = Number(p.birth.date.slice(0, 4));
      if (!(by <= minS - 14 && by >= minS - 40)) return false;
      const ct = tokens(`${p.firstname ?? ''} ${p.lastname ?? ''} ${p.name}`);
      for (const tok of ourTokens) if (!ct.has(tok)) return false; // our tokens ⊆ candidate
      return true;
    });
    if (cands.length !== 1) continue; // unique-only → never guess
    const chosen = cands[0]!;
    await db.execute(sql`UPDATE players SET api_football_id = ${chosen.id}, birth_date = ${chosen.birth!.date} WHERE id = ${t.id}::uuid`);
    p3 += 1;
    if (p3proc % 25 === 0) console.log(`  …${p3proc}/${datable.length} processed, ${p3} matched`);
  }
  console.log(`Pass 3 done: matched ${p3}/${datable.length} (also filled their birth dates).`);

  const cov = (await db.execute(sql`
    SELECT COUNT(*) FILTER (WHERE api_football_id IS NOT NULL) have,
           COUNT(*) FILTER (WHERE market_value_tier >= 3 AND api_football_id IS NOT NULL) famous_have,
           COUNT(*) FILTER (WHERE market_value_tier >= 3) famous_total
    FROM players
  `)) as unknown as Array<{ have: number; famous_have: number; famous_total: number }>;
  console.log(`Coverage: ${cov[0]!.have} players with headshots; famous ${cov[0]!.famous_have}/${cov[0]!.famous_total}.`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
