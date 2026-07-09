/**
 * Ingest international_caps from Transfermarkt players.csv into player_extra_stats,
 * matched via players.tm_player_id (run job:map-tm-players first if needed).
 *
 * Only trusts caps in [INTL_CAPS_TRUST_MIN, INTL_CAPS_SANITY_MAX] (30–280).
 * Merges by GREATEST — never lowers an existing wiki/API figure.
 *
 * Note: the Kaggle dump often leaves caps blank for retired legends (Terry, Lampard).
 * Pair this with job:ingest-national-caps for the 30–99 England band.
 *
 * Usage:
 *   DATABASE_URL=... npm run job:ingest-tm-caps
 *   DATABASE_URL=... npm run job:ingest-tm-caps -- --dry
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { INTL_CAPS_SANITY_MAX, INTL_CAPS_TRUST_MIN } from '../services/statMetrics.js';

const DIR = process.argv[2] && !process.argv[2].startsWith('-')
  ? process.argv[2]
  : (process.env.TM_DIR ?? 'transferdata');

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

async function main() {
  const dry = process.argv.includes('--dry');
  console.log(`Loading ${DIR}/players.csv...`);
  const tm = parseCsv(readFileSync(`${DIR}/players.csv`, 'utf8'));
  const capsByTm = new Map<string, number>();
  let filled = 0;
  let trusted = 0;
  for (const r of tm) {
    const id = r.player_id?.trim();
    if (!id) continue;
    const caps = Number(r.international_caps ?? '') || 0;
    if (caps > 0) filled += 1;
    if (caps >= INTL_CAPS_TRUST_MIN && caps <= INTL_CAPS_SANITY_MAX) {
      capsByTm.set(id, caps);
      trusted += 1;
    }
  }
  console.log(`TM rows with any caps: ${filled}; trusted ${INTL_CAPS_TRUST_MIN}–${INTL_CAPS_SANITY_MAX}: ${trusted}`);

  const mapped = (await db.execute(sql`
    SELECT id, name, tm_player_id
    FROM players
    WHERE tm_player_id IS NOT NULL
  `)) as unknown as Array<{ id: string; name: string; tm_player_id: string }>;

  const updates: Array<{ id: string; name: string; caps: number }> = [];
  for (const p of mapped) {
    const caps = capsByTm.get(p.tm_player_id);
    if (caps == null) continue;
    updates.push({ id: p.id, name: p.name, caps });
  }
  console.log(`Matched ${updates.length} of our players with trusted TM caps`);

  const samples = [...updates]
    .sort((a, b) => b.caps - a.caps)
    .slice(0, 10);
  for (const s of samples) console.log(`  ${s.name}: ${s.caps}`);

  // Spot-check legends that are often blank in the dump.
  for (const name of ['John Terry', 'Frank Lampard', 'David Beckham', 'Ryan Giggs', 'Harry Kane', 'Kyle Walker']) {
    const u = updates.find((x) => x.name === name);
    const row = mapped.find((x) => x.name === name);
    console.log(
      `  check ${name}: tm_id=${row?.tm_player_id ?? 'unmapped'} caps=${u?.caps ?? '(none/blank in dump)'}`
    );
  }

  if (dry) {
    console.log('\n--dry: no writes.');
    process.exit(0);
  }

  let written = 0;
  for (let i = 0; i < updates.length; i += 200) {
    const batch = updates.slice(i, i + 200);
    const tuples = batch.map((u) => sql`(${u.id}::uuid, ${u.caps})`);
    await db.execute(sql`
      INSERT INTO player_extra_stats AS p (player_id, intl_caps)
      VALUES ${sql.join(tuples, sql`, `)}
      ON CONFLICT (player_id) DO UPDATE SET
        intl_caps = CASE
          WHEN EXCLUDED.intl_caps >= ${INTL_CAPS_TRUST_MIN}
            AND EXCLUDED.intl_caps <= ${INTL_CAPS_SANITY_MAX}
            THEN GREATEST(p.intl_caps, EXCLUDED.intl_caps)
          ELSE p.intl_caps
        END,
        updated_at = now()
    `);
    written += batch.length;
  }
  console.log(`Wrote/merged caps for ${written} players.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
