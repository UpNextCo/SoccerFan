/**
 * Backfill missing peak_market_value_eur:
 *   1) From Transfermarkt Kaggle dump (players.csv highest_market_value_in_eur) for rows
 *      that already have tm_player_id but a null/0 peak.
 *   2) Curated overrides for legends the dump dropped (Ronaldinho, Zidane, Henry, …)
 *      or whose stored peak is a late-career remnant (e.g. Raúl €350k).
 *
 * Then re-tiers from absolute peak (same thresholds as import-transfermarkt).
 *
 *   npx tsx src/jobs/backfill-peak-values.ts
 *   npx tsx src/jobs/backfill-peak-values.ts --apply
 *   npx tsx src/jobs/backfill-peak-values.ts transferdata --apply
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

const APPLY = process.argv.includes('--apply');
const DIR = process.argv.slice(2).find((a) => a !== '--apply') ?? 'transferdata';

/**
 * Transfermarkt-era peak values (€) for legends missing from / under-covered by the
 * current Kaggle dump. Prefer official TM personal records where known (Ronaldinho €80m);
 * otherwise the best-documented TM high from the mid-2000s valuation history.
 *
 * Matched by exact players.name (plus optional tm_player_id when set).
 */
const CURATED: Array<{ name: string; peakEur: number; tmId?: string; dob?: string }> = [
  // World-record / Ballon d'Or era
  { name: 'Ronaldinho', peakEur: 80_000_000, tmId: '3373', dob: '1980-03-21' },
  { name: 'Kaká', peakEur: 70_000_000, tmId: '3366', dob: '1982-04-22' },
  { name: 'Thierry Henry', peakEur: 75_000_000, tmId: '3207', dob: '1977-08-17' },
  { name: 'Zinédine Zidane', peakEur: 45_000_000, tmId: '3111', dob: '1972-06-23' },
  { name: 'Luís Figo', peakEur: 65_000_000, tmId: '3446', dob: '1972-11-04' },
  { name: 'Rivaldo', peakEur: 45_000_000, tmId: '3372', dob: '1972-04-19' },
  { name: 'Roberto Carlos', peakEur: 32_000_000, tmId: '7518', dob: '1973-04-10' },
  { name: 'Paolo Maldini', peakEur: 25_000_000, tmId: '5803', dob: '1968-06-26' },
  { name: 'Raúl', peakEur: 55_000_000, tmId: '7349', dob: '1977-06-27' }, // dump remnant was €350k

  // 90s / early-00s icons (TM coverage thin or absent)
  { name: 'Ronaldo', peakEur: 80_000_000, dob: '1976-09-22' }, // Brazilian Ronaldo
  { name: 'Andriy Shevchenko', peakEur: 52_000_000, tmId: '3522' },
  { name: 'Ruud van Nistelrooy', peakEur: 40_000_000 },
  { name: 'Alessandro Del Piero', peakEur: 45_000_000, tmId: '4289' },
  { name: 'Francesco Totti', peakEur: 40_000_000, tmId: '5958' },
  { name: 'Alessandro Nesta', peakEur: 40_000_000, tmId: '4171' },
  { name: 'Fabio Cannavaro', peakEur: 30_000_000, tmId: '5775' },
  { name: 'Pavel Nedvěd', peakEur: 45_000_000, tmId: '3603' },
  { name: 'Filippo Inzaghi', peakEur: 30_000_000, tmId: '5821' },
  { name: 'Clarence Seedorf', peakEur: 30_000_000 },
  { name: 'Edgar Davids', peakEur: 25_000_000, tmId: '5758' },
  { name: 'Lilian Thuram', peakEur: 25_000_000, tmId: '3521' },
  { name: 'Cafú', peakEur: 20_000_000, tmId: '5937' },
  { name: 'Dennis Bergkamp', peakEur: 25_000_000, tmId: '3187' },
  { name: 'Patrick Vieira', peakEur: 40_000_000 },
  { name: 'Roy Keane', peakEur: 25_000_000 },
  { name: 'Paul Scholes', peakEur: 25_000_000 },
  { name: 'Ryan Giggs', peakEur: 20_000_000 },
  { name: 'Michael Owen', peakEur: 50_000_000 },
  { name: 'Deco', peakEur: 35_000_000 },
  { name: 'Samuel Eto\'o', peakEur: 65_000_000 },
  { name: 'Claude Makelele', peakEur: 20_000_000, tmId: '4182' },
  { name: 'Robert Pirès', peakEur: 25_000_000, tmId: '3185' },
  { name: 'Henrik Larsson', peakEur: 20_000_000, tmId: '3514' },
  { name: 'Edwin van der Sar', peakEur: 15_000_000, tmId: '3516' },
  { name: 'Oliver Kahn', peakEur: 20_000_000, tmId: '206' },
  { name: 'Fabien Barthez', peakEur: 15_000_000, tmId: '3289' },
  { name: 'Marcel Desailly', peakEur: 20_000_000, tmId: '3154' },
  { name: 'Didier Deschamps', peakEur: 15_000_000, tmId: '75553' },
  { name: 'Fernando Hierro', peakEur: 20_000_000, tmId: '7513' },
  { name: 'Davor Šuker', peakEur: 20_000_000, tmId: '1407' },
  { name: 'Hristo Stoichkov', peakEur: 20_000_000, tmId: '7938' },
  { name: 'Frank Rijkaard', peakEur: 15_000_000, tmId: '70667' },
  { name: 'Franco Baresi', peakEur: 10_000_000, tmId: '42049' },
  { name: 'Lothar Matthäus', peakEur: 15_000_000, tmId: '1527' },
  { name: 'Roberto Baggio', peakEur: 25_000_000 },
  { name: 'Gianfranco Zola', peakEur: 15_000_000 },
  { name: 'Eric Cantona', peakEur: 15_000_000 },
  { name: 'Alan Shearer', peakEur: 25_000_000 },
  { name: 'Gabriel Batistuta', peakEur: 30_000_000 },
  { name: 'Juan Sebastián Verón', peakEur: 40_000_000 },
  { name: 'Hernán Crespo', peakEur: 40_000_000 },
  { name: 'Adrian Mutu', peakEur: 25_000_000 },
  { name: 'Christian Vieri', peakEur: 45_000_000 },
  { name: 'Alessandro Costacurta', peakEur: 12_000_000, tmId: '10055' },
  { name: 'Gianluca Zambrotta', peakEur: 25_000_000 },
  { name: 'Andrea Pirlo', peakEur: 36_000_000, tmId: '5817' }, // already often filled; safe if null
  { name: 'Gennaro Gattuso', peakEur: 20_000_000 },
  { name: 'Marco Materazzi', peakEur: 15_000_000 },
  { name: 'Lúcio', peakEur: 25_000_000 },
  { name: 'Adriano', peakEur: 45_000_000 },
  { name: 'Robinho', peakEur: 50_000_000 },
];

/** Apply curated peak if missing/zero, or if stored peak looks like a late-career remnant. */
const SUSPICIOUS_MAX_EUR = 5_000_000;

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
    else {
      const obj: Record<string, string> = {};
      for (let i = 0; i < header.length; i += 1) obj[header[i]!] = row[i] ?? '';
      out.push(obj);
    }
    row = [];
  };
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') pushField();
    else if (c === '\n') { pushField(); pushRow(); }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { pushField(); pushRow(); }
  return out;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  const path = join(DIR, 'players.csv');
  const tmRows = parseCsv(readFileSync(path, 'utf8'));
  const highestByTm = new Map<string, number>();
  for (const r of tmRows) {
    const id = r.player_id?.trim();
    const hv = parseInt(r.highest_market_value_in_eur ?? '', 10);
    if (!id || !Number.isFinite(hv) || hv <= 0) continue;
    highestByTm.set(id, hv);
  }
  console.log(`TM dump: ${highestByTm.size} players with highest_market_value_in_eur > 0`);

  // --- 1) Dump backfill by tm_player_id ---
  const nullPeak = (await db.execute(sql`
    SELECT id, name, tm_player_id, peak_market_value_eur, market_value_tier
    FROM players
    WHERE tm_player_id IS NOT NULL
      AND (peak_market_value_eur IS NULL OR peak_market_value_eur = 0)
  `)) as unknown as Array<{
    id: string; name: string; tm_player_id: string; peak_market_value_eur: number | null; market_value_tier: number;
  }>;

  const fromDump: Array<{ id: string; name: string; peak: number; tmId: string }> = [];
  for (const p of nullPeak) {
    const peak = highestByTm.get(p.tm_player_id);
    if (!peak) continue;
    fromDump.push({ id: p.id, name: p.name, peak, tmId: p.tm_player_id });
  }
  fromDump.sort((a, b) => b.peak - a.peak);
  console.log(`\n[1] Dump backfill candidates: ${fromDump.length}`);
  for (const r of fromDump.slice(0, 20)) {
    console.log(`  ${r.name.padEnd(28)} €${(r.peak / 1e6).toFixed(1)}m  (tm ${r.tmId})`);
  }
  if (fromDump.length > 20) console.log(`  … +${fromDump.length - 20} more`);

  // --- 2) Curated overrides ---
  const curatedHits: Array<{ id: string; name: string; peak: number; before: number | null; reason: string }> = [];
  for (const c of CURATED) {
    const rows = (await db.execute(
      c.tmId
        ? sql`
            SELECT id, name, peak_market_value_eur, tm_player_id, birth_date::text AS dob
            FROM players
            WHERE tm_player_id = ${c.tmId} OR lower(name) = lower(${c.name})
            ORDER BY CASE WHEN tm_player_id = ${c.tmId} THEN 0 ELSE 1 END, market_value_tier DESC
            LIMIT 5
          `
        : c.dob
          ? sql`
              SELECT id, name, peak_market_value_eur, tm_player_id, birth_date::text AS dob
              FROM players
              WHERE lower(name) = lower(${c.name})
                 OR (lower(name) LIKE ${`%${c.name.toLowerCase()}%`} AND birth_date = ${c.dob}::date)
              ORDER BY
                CASE WHEN birth_date = ${c.dob}::date THEN 0 ELSE 1 END,
                CASE WHEN lower(name) = lower(${c.name}) THEN 0 ELSE 1 END,
                market_value_tier DESC
              LIMIT 5
            `
          : sql`
              SELECT id, name, peak_market_value_eur, tm_player_id, birth_date::text AS dob
              FROM players
              WHERE lower(name) = lower(${c.name})
              ORDER BY market_value_tier DESC
              LIMIT 5
            `
    )) as unknown as Array<{
      id: string; name: string; peak_market_value_eur: number | null; tm_player_id: string | null; dob: string | null;
    }>;

    const hit = rows.find((r) => c.tmId && r.tm_player_id === c.tmId)
      ?? rows.find((r) => c.dob && (r.dob ?? '').startsWith(c.dob))
      ?? rows.find((r) => r.name.toLowerCase() === c.name.toLowerCase());

    if (!hit) {
      console.log(`  curated MISS: ${c.name}`);
      continue;
    }
    const before = hit.peak_market_value_eur;
    const needs = before == null || before === 0 || before < SUSPICIOUS_MAX_EUR;
    if (!needs) continue;
    if (before != null && before > 0 && before >= c.peakEur) continue;
    curatedHits.push({
      id: hit.id,
      name: hit.name,
      peak: c.peakEur,
      before,
      reason: before != null && before > 0 ? `replace remnant €${(before / 1e6).toFixed(2)}m` : 'fill null',
    });
  }
  console.log(`\n[2] Curated overrides: ${curatedHits.length}`);
  for (const r of curatedHits) {
    console.log(`  ${r.name.padEnd(28)} €${(r.peak / 1e6).toFixed(0)}m  (${r.reason})`);
  }

  if (!APPLY) {
    console.log('\nDry run — pass --apply to write');
    return;
  }

  let updated = 0;
  for (const batch of chunk(fromDump, 200)) {
    const tuples = batch.map((u) => sql`(${u.id}::uuid, ${u.peak}::int)`);
    await db.execute(sql`
      UPDATE players AS p SET peak_market_value_eur = v.peak
      FROM (VALUES ${sql.join(tuples, sql`, `)}) AS v(id, peak)
      WHERE p.id = v.id
        AND (p.peak_market_value_eur IS NULL OR p.peak_market_value_eur = 0)
    `);
    updated += batch.length;
  }
  console.log(`Applied dump backfill to ${updated} players`);

  for (const batch of chunk(curatedHits, 100)) {
    const tuples = batch.map((u) => sql`(${u.id}::uuid, ${u.peak}::int)`);
    await db.execute(sql`
      UPDATE players AS p SET peak_market_value_eur = v.peak
      FROM (VALUES ${sql.join(tuples, sql`, `)}) AS v(id, peak)
      WHERE p.id = v.id
    `);
  }
  console.log(`Applied curated overrides to ${curatedHits.length} players`);

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
  console.log('Re-tiered from absolute peak market value');

  const check = await db.execute(sql`
    SELECT name, peak_market_value_eur, market_value_tier
    FROM players
    WHERE name IN (
      'Ronaldinho', 'Kaká', 'Thierry Henry', 'Zinédine Zidane', 'Raúl',
      'Rivaldo', 'Roberto Carlos', 'Paolo Maldini', 'Luís Figo', 'Ronaldo'
    )
    ORDER BY peak_market_value_eur DESC NULLS LAST, name
  `);
  console.log('\nVERIFY:', JSON.stringify(check, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
