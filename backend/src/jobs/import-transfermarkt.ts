/**
 * Import REAL market values + transfer fees from the Transfermarkt Kaggle dump
 * (davidcariboo/player-scores) into players.{market_value_eur, peak_market_value_eur,
 * record_fee_eur}, then re-tier market_value_tier from real peak value.
 *
 * Peak value comes from the FULL valuation history (player_valuations.csv), and players
 * are matched Transfermarkt → ours primarily by date of birth + name tokens (robust to
 * word-order/name variants), then name+nationality, then unique token-subset.
 *
 * Expects CSVs in transferdata/ (players.csv, player_valuations.csv, transfers.csv).
 * Usage: DATABASE_URL=... npx tsx src/jobs/import-transfermarkt.ts transferdata
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { players } from '../db/schema.js';
import { isAbbreviatedName, normalizeSearchText } from '../utils/playerSearch.js';

function tokens(name: string): Set<string> {
  return new Set(
    name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((t) => t.length > 1)
  );
}

function isSubset(small: Set<string>, big: Set<string>): boolean {
  for (const t of small) if (!big.has(t)) return false;
  return true;
}

/** Prefer the common name (Transfermarkt's) over a longer legal name. */
function chooseDisplayName(ours: string, tm: string): string {
  const a = ours.replace(/\s+/g, ' ').trim();
  const b = tm.replace(/\s+/g, ' ').trim();
  if (!b || isAbbreviatedName(b)) return a;
  const at = a.split(' ').length;
  const bt = b.split(' ').length;
  if (bt < at) return b;
  if (at < bt) return a;
  return b.length <= a.length ? b : a;
}

// Override with an arg or TM_DIR env if the CSVs live elsewhere.
const DIR = process.argv[2] ?? process.env.TM_DIR ?? 'data/transfermarkt';

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
    if (!header) {
      header = row;
    } else {
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
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      pushField();
    } else if (c === '\n') {
      pushField();
      pushRow();
    } else if (c === '\r') {
      // ignore
    } else {
      field += c;
    }
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

function key(name: string, nat: string): string {
  return `${normalizeSearchText(name)}|${normNat(nat)}`;
}

function toEur(value: string): number | null {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

interface TmPlayer {
  tmId: string;
  name: string;
  dob: string | null; // YYYY-MM-DD
  current: number | null;
  peak: number | null;
  toks: Set<string>;
}

/** Two names share enough tokens to be the same person (order-independent). */
function tokenCompatible(a: Set<string>, b: Set<string>): boolean {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  return small.size >= 2 && isSubset(small, big);
}

/** Looser check for the DOB path: an exact date of birth is already highly selective,
 *  so one shared name token is enough — this lets mononyms (Pedro, Marcelo, Raúl…) match. */
function dobNameMatch(a: Set<string>, b: Set<string>): boolean {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  return small.size >= 1 && isSubset(small, big);
}

async function main() {
  await db.execute(sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS market_value_eur integer`);
  await db.execute(sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS peak_market_value_eur integer`);
  await db.execute(sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS record_fee_eur integer`);

  // --- PEAK + current value per TM player from the FULL valuation history ---
  // players.csv's precomputed columns are frequently blank; the history is far more
  // complete and is what makes a player like Son (peak ~€90m, lower now) read as elite.
  console.log('Parsing player_valuations.csv (full history)...');
  const valuations = parseCsv(readFileSync(`${DIR}/player_valuations.csv`, 'utf8'));
  // PEAK (max over the player's whole history — captures their prime) + latest value.
  const peakByTm = new Map<string, number>();
  const latestByTm = new Map<string, { date: string; value: number }>();
  for (const v of valuations) {
    const tmId = v.player_id;
    const val = toEur(v.market_value_in_eur ?? '');
    if (!tmId || !val) continue;
    if (val > (peakByTm.get(tmId) ?? 0)) peakByTm.set(tmId, val);
    const date = v.date ?? '';
    const prev = latestByTm.get(tmId);
    if (!prev || date > prev.date) latestByTm.set(tmId, { date, value: val });
  }
  console.log(`${peakByTm.size} TM players have a valuation history`);

  // --- Transfermarkt players → index by DOB and by name+nationality ---
  console.log('Parsing players.csv...');
  const tmPlayers = parseCsv(readFileSync(`${DIR}/players.csv`, 'utf8'));
  const byDob = new Map<string, TmPlayer[]>(); // keyed by DOB only; disambiguate by name tokens
  const byKey = new Map<string, TmPlayer[]>();
  const byNat = new Map<string, TmPlayer[]>();
  for (const p of tmPlayers) {
    const name = p.name ?? '';
    const tmId = p.player_id!;
    const dob = (p.date_of_birth ?? '').slice(0, 10) || null;
    const entry: TmPlayer = {
      tmId,
      name,
      dob,
      current: latestByTm.get(tmId)?.value ?? toEur(p.market_value_in_eur ?? ''),
      peak: peakByTm.get(tmId) ?? toEur(p.highest_market_value_in_eur ?? ''),
      toks: tokens(name),
    };
    if (dob) (byDob.get(dob) ?? byDob.set(dob, []).get(dob)!).push(entry);
    const k = key(name, p.country_of_citizenship ?? '');
    (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(entry);
    const nat = normNat(p.country_of_citizenship ?? '');
    (byNat.get(nat) ?? byNat.set(nat, []).get(nat)!).push(entry);
  }
  console.log(`${tmPlayers.length} Transfermarkt players parsed`);

  // --- Record (max) transfer fee per TM player ---
  console.log('Parsing transfers.csv...');
  const transfers = parseCsv(readFileSync(`${DIR}/transfers.csv`, 'utf8'));
  const recordFee = new Map<string, number>();
  for (const t of transfers) {
    const fee = toEur(t.transfer_fee ?? '');
    if (!fee) continue;
    const prev = recordFee.get(t.player_id!) ?? 0;
    if (fee > prev) recordFee.set(t.player_id!, fee);
  }
  console.log(`${recordFee.size} TM players have a recorded fee`);

  // --- Match: DOB + name tokens (strongest), then name+nationality, then token-subset ---
  const ours = (await db.execute(sql`
    SELECT id, name, nationality, aliases, search_text, birth_date::text AS dob FROM players
  `)) as unknown as Array<{ id: string; name: string; nationality: string; aliases: string[]; search_text: string; dob: string | null }>;

  interface Update {
    id: string;
    mv: number | null;
    pv: number | null;
    rf: number | null;
    name: string;
    aliases: string;
    searchText: string;
  }
  const updates: Update[] = [];
  let viaDob = 0;
  let exact = 0;
  let subset = 0;
  let renamed = 0;

  for (const p of ours) {
    let tm: TmPlayer | undefined;
    const ourToks = tokens(p.name);
    const dob = (p.dob ?? '').slice(0, 10);

    // 1) Same date of birth + compatible name tokens — robust to word-order/name variants.
    if (dob) {
      const cands = (byDob.get(dob) ?? []).filter((t) => dobNameMatch(t.toks, ourToks));
      if (cands.length === 1) {
        tm = cands[0];
        viaDob += 1;
      }
    }
    // 2) Exact name + nationality (unique).
    if (!tm) {
      const exactHits = byKey.get(key(p.name, p.nationality));
      if (exactHits && exactHits.length === 1) {
        tm = exactHits[0];
        exact += 1;
      } else if (!exactHits || exactHits.length === 0) {
        // 3) Token-subset within nationality (unique).
        if (ourToks.size >= 2) {
          const cands = (byNat.get(normNat(p.nationality)) ?? []).filter((t) => tokenCompatible(t.toks, ourToks));
          if (cands.length === 1) {
            tm = cands[0];
            subset += 1;
          }
        }
      }
    }
    if (!tm) continue;

    const chosen = chooseDisplayName(p.name, tm.name);
    if (chosen !== p.name) renamed += 1;
    const aliasSet = new Set<string>([...(Array.isArray(p.aliases) ? p.aliases : []), p.name, tm.name, chosen]);
    updates.push({
      id: p.id,
      mv: tm.current,
      pv: tm.peak,
      rf: recordFee.get(tm.tmId) ?? null,
      name: chosen,
      aliases: JSON.stringify([...aliasSet]),
      searchText: `${p.search_text} ${normalizeSearchText(tm.name)}`.trim(),
    });
  }
  console.log(`Matched ${updates.length} players (${viaDob} dob, ${exact} name+nat, ${subset} subset) · ${renamed} renamed to common name`);

  for (const batch of chunk(updates, 300)) {
    const tuples = batch.map(
      (u) => sql`(${u.id}::uuid, ${u.mv}::int, ${u.pv}::int, ${u.rf}::int, ${u.name}::text, ${u.aliases}::jsonb, ${u.searchText}::text)`
    );
    await db.execute(sql`
      UPDATE players AS p SET
        market_value_eur = v.mv,
        peak_market_value_eur = v.pv,
        record_fee_eur = v.rf,
        name = v.nm,
        aliases = v.al,
        search_text = v.st
      FROM (VALUES ${sql.join(tuples, sql`, `)}) AS v(id, mv, pv, rf, nm, al, st)
      WHERE p.id = v.id
    `);
  }
  console.log(`Wrote values + fees + common names for ${updates.length} players`);

  // --- Tier (1-5) from ABSOLUTE peak market value (real €, interpretable, no pool
  // dilution). compute-fame then lifts legends via achievements so older/uncovered
  // greats aren't penalised by football's market inflation. ---
  await db.execute(sql`
    UPDATE players SET market_value_tier = CASE
      WHEN peak_market_value_eur >= 70000000 THEN 5
      WHEN peak_market_value_eur >= 35000000 THEN 4
      WHEN peak_market_value_eur >= 15000000 THEN 3
      WHEN peak_market_value_eur >=  5000000 THEN 2
      ELSE 1
    END
    WHERE peak_market_value_eur IS NOT NULL
  `);
  console.log('Re-tiered players from absolute peak market value.');

  const sample = (await db.execute(sql`
    SELECT name, peak_market_value_eur, record_fee_eur
    FROM players WHERE peak_market_value_eur IS NOT NULL
    ORDER BY peak_market_value_eur DESC LIMIT 12
  `)) as unknown as Array<{ name: string; peak_market_value_eur: number; record_fee_eur: number | null }>;
  console.log('\n=== Most valuable (by peak market value) ===');
  for (const s of sample) {
    const fee = s.record_fee_eur ? `record fee €${(s.record_fee_eur / 1e6).toFixed(0)}m` : 'no fee';
    console.log(`  ${s.name}: €${(s.peak_market_value_eur / 1e6).toFixed(0)}m peak · ${fee}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
