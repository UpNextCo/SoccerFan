/**
 * Import REAL market values + transfer fees from the Transfermarkt Kaggle dump
 * (davidcariboo/player-scores) into players.{market_value_eur, peak_market_value_eur,
 * record_fee_eur}, then re-tier market_value_tier from real peak value.
 *
 * Matches Transfermarkt → our players by normalized name + nationality (unique only),
 * same conservative entity-resolution as the FBref reconciliation.
 *
 * Expects CSVs in data/transfermarkt/ (players.csv, transfers.csv).
 * Usage: DATABASE_URL=... npm run job:import-transfermarkt
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { players } from '../db/schema.js';
import { normalizeSearchText } from '../utils/playerSearch.js';

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
  current: number | null;
  peak: number | null;
}

async function main() {
  await db.execute(sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS market_value_eur integer`);
  await db.execute(sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS peak_market_value_eur integer`);
  await db.execute(sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS record_fee_eur integer`);

  // --- Transfermarkt players → index by name+nationality (unique only) ---
  console.log('Parsing players.csv...');
  const tmPlayers = parseCsv(readFileSync(`${DIR}/players.csv`, 'utf8'));
  const byKey = new Map<string, TmPlayer[]>();
  const tmById = new Map<string, TmPlayer>();
  for (const p of tmPlayers) {
    const entry: TmPlayer = {
      tmId: p.player_id!,
      current: toEur(p.market_value_in_eur ?? ''),
      peak: toEur(p.highest_market_value_in_eur ?? ''),
    };
    tmById.set(entry.tmId, entry);
    const k = key(p.name ?? '', p.country_of_citizenship ?? '');
    const list = byKey.get(k);
    if (list) list.push(entry);
    else byKey.set(k, [entry]);
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

  // --- Match our players ---
  const ours = (await db.execute(sql`
    SELECT id, name, nationality FROM players
  `)) as unknown as Array<{ id: string; name: string; nationality: string }>;

  const updates: Array<{ id: string; mv: number | null; pv: number | null; rf: number | null }> = [];
  let matched = 0;
  let ambiguous = 0;
  for (const p of ours) {
    const hits = byKey.get(key(p.name, p.nationality));
    if (!hits) continue;
    if (hits.length > 1) {
      ambiguous += 1;
      continue;
    }
    const tm = hits[0]!;
    matched += 1;
    updates.push({
      id: p.id,
      mv: tm.current,
      pv: tm.peak,
      rf: recordFee.get(tm.tmId) ?? null,
    });
  }
  console.log(`Matched ${matched} players (${ambiguous} skipped as ambiguous name+nationality)`);

  for (const batch of chunk(updates, 400)) {
    const tuples = batch.map(
      (u) => sql`(${u.id}::uuid, ${u.mv}::int, ${u.pv}::int, ${u.rf}::int)`
    );
    await db.execute(sql`
      UPDATE players AS p SET
        market_value_eur = v.mv,
        peak_market_value_eur = v.pv,
        record_fee_eur = v.rf
      FROM (VALUES ${sql.join(tuples, sql`, `)}) AS v(id, mv, pv, rf)
      WHERE p.id = v.id
    `);
  }
  console.log(`Wrote market values + record fees for ${updates.length} players`);

  // --- Re-tier from REAL peak market value (only where we have it) ---
  await db.execute(sql`
    WITH ranked AS (
      SELECT id, percent_rank() OVER (PARTITION BY position ORDER BY peak_market_value_eur) AS pr
      FROM players WHERE peak_market_value_eur IS NOT NULL
    )
    UPDATE players p SET market_value_tier = CASE
      WHEN r.pr >= 0.95 THEN 5
      WHEN r.pr >= 0.80 THEN 4
      WHEN r.pr >= 0.50 THEN 3
      WHEN r.pr >= 0.20 THEN 2
      ELSE 1
    END
    FROM ranked r WHERE p.id = r.id
  `);
  console.log('Re-tiered players that have a real market value. Done.');

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
