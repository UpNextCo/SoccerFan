/**
 * Reconcile display names against Transfermarkt using DATE OF BIRTH + nationality —
 * the only reliable key for popular nicknames (e.g. our legal "Francisco Alarcón
 * Suárez" → TM "Isco", DOB 1992-04-21). Requires players.birth_date (run
 * job:backfill-dob first). The old name is preserved in aliases + search_text.
 *
 * Pure DB + local CSV. Zero API calls. Idempotent.
 *
 * Usage: DATABASE_URL=... npm run job:tm-rename [tmDir]
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { isAbbreviatedName, normalizeSearchText } from '../utils/playerSearch.js';

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
    name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((t) => t.length > 1)
  );
}

function sharedTokenCount(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n += 1;
  return n;
}

/** Prefer Transfermarkt's (popular) name; keep ours only if TM looks worse. */
function chooseDisplayName(ours: string, tm: string): string {
  const a = ours.replace(/\s+/g, ' ').trim();
  const b = tm.replace(/\s+/g, ' ').trim();
  if (!b || isAbbreviatedName(b)) return a;
  const at = a.split(' ').length;
  const bt = b.split(' ').length;
  if (bt < at) return b; // TM is shorter / more common
  if (at < bt) return a; // ours is already shorter
  return b.length <= a.length ? b : a;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

interface TmRow {
  name: string;
  cit: string;
  cob: string;
  toks: Set<string>;
}

async function main() {
  console.log('Parsing players.csv...');
  const tm = parseCsv(readFileSync(`${DIR}/players.csv`, 'utf8'));
  const byDob = new Map<string, TmRow[]>();
  for (const p of tm) {
    const dob = (p.date_of_birth ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) continue;
    const name = (p.name ?? '').trim();
    if (!name) continue;
    const row: TmRow = {
      name,
      cit: normNat(p.country_of_citizenship ?? ''),
      cob: normNat(p.country_of_birth ?? ''),
      toks: tokens(name),
    };
    (byDob.get(dob) ?? byDob.set(dob, []).get(dob)!).push(row);
  }
  console.log(`Indexed ${tm.length} TM players by DOB (${byDob.size} distinct dates)`);

  const ours = (await db.execute(sql`
    SELECT p.id, p.name, p.nationality, p.birth_date::text AS dob, p.aliases, p.search_text,
           COALESCE((SELECT SUM(appearances) FROM player_stats s
                     WHERE s.player_id = p.id AND s.league_id IN (39,140,135,78,61,2,3)), 0)::int AS apps
    FROM players p WHERE p.birth_date IS NOT NULL
  `)) as unknown as Array<{ id: string; name: string; nationality: string; dob: string; aliases: string[]; search_text: string; apps: number }>;
  console.log(`${ours.length} of our players have a DOB to match`);

  // A famous player (50+ top-flight apps) is certainly in TM, so a DOB+nationality
  // hit is them even with no shared name token (legal "Francisco Alarcón Suárez" →
  // "Isco"). Obscure players often AREN'T in TM, so a same-DOB hit may be a different
  // person — for them we require a shared name token.
  const PROMINENT_APPS = 50;

  interface Update {
    id: string;
    name: string;
    aliases: string;
    searchText: string;
  }
  const updates: Update[] = [];
  let matched = 0;
  const examples: string[] = [];

  for (const p of ours) {
    const cands = byDob.get(p.dob);
    if (!cands || cands.length === 0) continue;

    const ourNat = normNat(p.nationality);
    const ourToks = tokens(p.name);
    const natMatches = cands.filter((c) => c.cit === ourNat || c.cob === ourNat);
    const prominent = p.apps >= PROMINENT_APPS;

    // Rank the candidate pool by shared name tokens.
    const pool = natMatches.length > 0 ? natMatches : cands;
    const ranked = pool
      .map((c) => ({ c, s: sharedTokenCount(ourToks, c.toks) }))
      .sort((a, b) => b.s - a.s);
    const best = ranked[0];
    const uniqueBest = best && (ranked.length === 1 || best.s > ranked[1]!.s);

    let pick: TmRow | undefined;
    if (best && best.s >= 1 && uniqueBest) {
      // Shared name token + clear winner — safe for anyone.
      pick = best.c;
    } else if (prominent && natMatches.length === 1) {
      // Famous player, unique DOB+nationality hit — trust even with no shared token.
      pick = natMatches[0];
    }
    if (!pick) continue;
    matched += 1;

    const chosen = chooseDisplayName(p.name, pick.name);
    if (chosen === p.name) continue;

    const aliasSet = new Set<string>([...(Array.isArray(p.aliases) ? p.aliases : []), p.name, pick.name, chosen]);
    updates.push({
      id: p.id,
      name: chosen,
      aliases: JSON.stringify([...aliasSet]),
      searchText: `${p.search_text} ${normalizeSearchText(pick.name)}`.trim(),
    });
    if (examples.length < 30) examples.push(`${p.name}  →  ${chosen}`);
  }

  console.log(`\nDOB-matched ${matched} players · renaming ${updates.length}`);
  console.log('Sample renames:');
  for (const e of examples) console.log(`  ${e}`);

  for (const batch of chunk(updates, 300)) {
    const tuples = batch.map((u) => sql`(${u.id}::uuid, ${u.name}::text, ${u.aliases}::jsonb, ${u.searchText}::text)`);
    await db.execute(sql`
      UPDATE players AS p SET name = v.nm, aliases = v.al, search_text = v.st
      FROM (VALUES ${sql.join(tuples, sql`, `)}) AS v(id, nm, al, st)
      WHERE p.id = v.id
    `);
  }
  console.log(`\nApplied ${updates.length} renames. Done.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
