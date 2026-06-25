/**
 * KEYSTONE: build a Transfermarkt player_id -> our player id mapping, stored in
 * players.tm_player_id. Everything downstream (lineups, events, managers, finals,
 * World Cup appearances) joins TM's per-game tables on this id.
 *
 * Matching strategy (high precision over recall):
 *   1. DOB + nationality, ranked by shared name tokens, unique clear winner (>=1 token).
 *      DOB is the reliable key; nationality + a shared token guards against same-DOB
 *      strangers. (Same approach proven in tm-rename.ts.)
 *   2. Fallback: globally-unique exact normalized name + nationality (for the handful of
 *      famous players still missing a birth_date).
 * A TM id maps to at most one of our players (ties broken by top-flight appearances).
 *
 * Pure DB + local CSV. Zero API calls. Idempotent — safe to re-run.
 *
 * Usage: DATABASE_URL=... npm run job:map-tm-players [tmDir]
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { normalizeSearchText } from '../utils/playerSearch.js';

const DIR = process.argv[2] ?? process.env.TM_DIR ?? 'transferdata';

function parseCsv(text: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  let header: string[] | null = null;
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    if (row.length === 1 && row[0] === '') {
      row = [];
      return;
    }
    if (!header) header = row;
    else {
      const obj: Record<string, string> = {};
      for (let i = 0; i < header.length; i += 1) obj[header[i]!] = row[i] ?? '';
      out.push(obj);
    }
    row = [];
  };
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') pushField();
    else if (c === '\n') {
      pushField();
      pushRow();
    } else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length > 0) {
    pushField();
    pushRow();
  }
  return out;
}

function normNat(nat: string): string {
  return nat.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function tokens(name: string): Set<string> {
  return new Set(
    name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1)
  );
}

function sharedTokenCount(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n += 1;
  return n;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

interface TmRow {
  tmId: string;
  name: string;
  cit: string;
  cob: string;
  toks: Set<string>;
}

async function main() {
  await db.execute(sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS tm_player_id text`);
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS players_tm_player_id_unique ON players (tm_player_id) WHERE tm_player_id IS NOT NULL`
  );

  console.log('Parsing players.csv...');
  const tm = parseCsv(readFileSync(`${DIR}/players.csv`, 'utf8'));
  const byDob = new Map<string, TmRow[]>();
  const byNameNat = new Map<string, TmRow[]>();
  for (const p of tm) {
    const name = (p.name ?? '').trim();
    if (!name) continue;
    const row: TmRow = {
      tmId: p.player_id!,
      name,
      cit: normNat(p.country_of_citizenship ?? ''),
      cob: normNat(p.country_of_birth ?? ''),
      toks: tokens(name),
    };
    const dob = (p.date_of_birth ?? '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      (byDob.get(dob) ?? byDob.set(dob, []).get(dob)!).push(row);
    }
    const nk = `${normalizeSearchText(name)}|${row.cit}`;
    (byNameNat.get(nk) ?? byNameNat.set(nk, []).get(nk)!).push(row);
  }
  console.log(`Indexed ${tm.length} TM players (${byDob.size} distinct DOBs)`);

  const ours = (await db.execute(sql`
    SELECT p.id, p.name, p.nationality, p.birth_date::text AS dob, p.search_text,
           COALESCE((SELECT SUM(appearances) FROM player_stats s
                     WHERE s.player_id = p.id AND s.league_id IN (39,140,135,78,61,2,3)), 0)::int AS apps
    FROM players p
  `)) as unknown as Array<{
    id: string;
    name: string;
    nationality: string;
    dob: string | null;
    search_text: string;
    apps: number;
  }>;
  console.log(`${ours.length} of our players to map`);

  interface Cand {
    ourId: string;
    tmId: string;
    apps: number;
    method: 'dob' | 'name';
  }
  const cands: Cand[] = [];
  let dobMatched = 0;
  let nameMatched = 0;

  for (const p of ours) {
    const ourNat = normNat(p.nationality);
    const ourToks = tokens(p.name);
    let pick: TmRow | undefined;
    let method: 'dob' | 'name' = 'dob';

    if (p.dob && /^\d{4}-\d{2}-\d{2}$/.test(p.dob)) {
      const pool0 = byDob.get(p.dob) ?? [];
      const natMatches = pool0.filter((c) => c.cit === ourNat || c.cob === ourNat);
      const pool = natMatches.length > 0 ? natMatches : pool0;
      const ranked = pool
        .map((c) => ({ c, s: sharedTokenCount(ourToks, c.toks) }))
        .sort((a, b) => b.s - a.s);
      const best = ranked[0];
      const uniqueBest = best && (ranked.length === 1 || best.s > ranked[1]!.s);
      if (best && best.s >= 1 && uniqueBest) {
        pick = best.c;
        dobMatched += 1;
      }
    }

    if (!pick) {
      // Fallback: globally-unique exact name + nationality.
      const nk = `${normalizeSearchText(p.name)}|${ourNat}`;
      const hits = byNameNat.get(nk);
      if (hits && hits.length === 1) {
        pick = hits[0];
        method = 'name';
        nameMatched += 1;
      }
    }

    if (pick) cands.push({ ourId: p.id, tmId: pick.tmId, apps: p.apps, method });
  }

  // A TM id must map to at most one of our players — keep the most prominent.
  const bestForTm = new Map<string, Cand>();
  for (const c of cands) {
    const prev = bestForTm.get(c.tmId);
    if (!prev || c.apps > prev.apps) bestForTm.set(c.tmId, c);
  }
  const finalMap = [...bestForTm.values()];
  const dropped = cands.length - finalMap.length;

  console.log(
    `\nMatched ${cands.length} (${dobMatched} DOB, ${nameMatched} name-fallback) · ${dropped} dropped as TM-id collisions`
  );

  // Clear then write, so re-runs reflect current matching.
  await db.execute(sql`UPDATE players SET tm_player_id = NULL WHERE tm_player_id IS NOT NULL`);
  for (const batch of chunk(finalMap, 500)) {
    const tuples = batch.map((u) => sql`(${u.ourId}::uuid, ${u.tmId}::text)`);
    await db.execute(sql`
      UPDATE players AS p SET tm_player_id = v.tm
      FROM (VALUES ${sql.join(tuples, sql`, `)}) AS v(id, tm)
      WHERE p.id = v.id
    `);
  }
  console.log(`Stored ${finalMap.length} mappings.`);

  // --- Coverage report ---
  const cov = (await db.execute(sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(birth_date)::int AS with_dob,
      COUNT(tm_player_id)::int AS mapped
    FROM players
  `)) as unknown as Array<{ total: number; with_dob: number; mapped: number }>;
  const c = cov[0]!;

  const prom = (await db.execute(sql`
    WITH apps AS (
      SELECT p.id, p.tm_player_id IS NOT NULL AS mapped,
             COALESCE(SUM(s.appearances) FILTER (WHERE s.league_id IN (39,140,135,78,61,2,3)), 0) AS a
      FROM players p LEFT JOIN player_stats s ON s.player_id = p.id
      GROUP BY p.id, p.tm_player_id
    )
    SELECT
      COUNT(*) FILTER (WHERE a >= 50)::int AS prominent,
      COUNT(*) FILTER (WHERE a >= 50 AND mapped)::int AS prominent_mapped,
      COUNT(*) FILTER (WHERE a >= 200)::int AS elite,
      COUNT(*) FILTER (WHERE a >= 200 AND mapped)::int AS elite_mapped
    FROM apps
  `)) as unknown as Array<{
    prominent: number;
    prominent_mapped: number;
    elite: number;
    elite_mapped: number;
  }>;
  const pr = prom[0]!;

  const pct = (a: number, b: number) => (b ? ((100 * a) / b).toFixed(1) : '0.0');
  console.log('\n=== TM mapping coverage ===');
  console.log(`  Players total:        ${c.total}`);
  console.log(`  With birth_date:      ${c.with_dob} (${pct(c.with_dob, c.total)}%)`);
  console.log(`  Mapped to TM:         ${c.mapped} (${pct(c.mapped, c.total)}%)`);
  console.log(
    `  Prominent (50+ apps): ${pr.prominent_mapped}/${pr.prominent} mapped (${pct(pr.prominent_mapped, pr.prominent)}%)`
  );
  console.log(
    `  Elite (200+ apps):    ${pr.elite_mapped}/${pr.elite} mapped (${pct(pr.elite_mapped, pr.elite)}%)`
  );

  const unmapped = (await db.execute(sql`
    WITH apps AS (
      SELECT p.id, p.name, p.tm_player_id,
             COALESCE(SUM(s.appearances) FILTER (WHERE s.league_id IN (39,140,135,78,61,2,3)), 0) AS a
      FROM players p LEFT JOIN player_stats s ON s.player_id = p.id
      GROUP BY p.id
    )
    SELECT name, a::int AS apps FROM apps WHERE tm_player_id IS NULL ORDER BY a DESC LIMIT 20
  `)) as unknown as Array<{ name: string; apps: number }>;
  console.log('\n  Top unmapped (by top-flight apps) — investigate if many are famous:');
  for (const u of unmapped) console.log(`    ${u.name} · ${u.apps} apps`);

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
