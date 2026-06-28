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

async function fetchProfiles(lastname: string): Promise<Profile[]> {
  const url = `https://v3.football.api-sports.io/players/profiles?search=${encodeURIComponent(lastname)}`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await fetch(url, { headers: { 'x-apisports-key': API_KEY! } });
    if (res.status === 429) { await sleep(2000); continue; }
    if (!res.ok) return [];
    const json = (await res.json()) as { response?: Array<{ player: Profile }> };
    return (json.response ?? []).map((r) => r.player);
  }
  return [];
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

  // api_football_ids already in use (so we never assign the same face twice).
  const usedRows = (await db.execute(sql`SELECT api_football_id FROM players WHERE api_football_id IS NOT NULL`)) as unknown as Array<{ api_football_id: number }>;
  const used = new Set<number>(usedRows.map((r) => r.api_football_id));

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

    // Strict: same birth year AND same nationality. Disambiguate ties by full-name token overlap.
    const candidates = profiles.filter((p) => {
      const year = p.birth?.date ? Number(p.birth.date.slice(0, 4)) : NaN;
      if (year !== t.birth_year) return false;
      const nat = canonicalNationality(p.nationality ?? '');
      return nat === ourNat;
    });

    let chosen: Profile | undefined;
    if (candidates.length === 1) {
      chosen = candidates[0];
    } else if (candidates.length > 1) {
      let best = -1;
      for (const c of candidates) {
        const ct = tokens(`${c.firstname ?? ''} ${c.lastname ?? ''} ${c.name}`);
        let overlap = 0;
        for (const tok of ourTokens) if (ct.has(tok)) overlap += 1;
        if (overlap > best) { best = overlap; chosen = c; }
      }
      if (best < 1) chosen = undefined; // ambiguous, no name overlap → skip
    }

    if (!chosen || used.has(chosen.id)) continue;
    used.add(chosen.id);
    await db.execute(sql`UPDATE players SET api_football_id = ${chosen.id} WHERE id = ${t.id}::uuid`);
    matched += 1;
    if (processed % 25 === 0) console.log(`  …${processed}/${targets.length} processed, ${matched} matched`);
  }

  console.log(`Pass 2 done: matched ${matched}/${targets.length}.`);

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
