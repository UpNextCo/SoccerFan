/**
 * Build a Transfermarkt scrape list for current EFL squad players — no fame floor.
 * tm-targets.ts is tier ≥ 3; new EFL ingest inserts at tier 2, so those players would
 * never be crawled by the default list.
 *
 * Prefers players.tm_player_id; falls back to transferdata/tm_id_map.json.
 * Output: transferdata/tm_efl_targets.json  [{ ourId, tmId, code, name, dob }]
 *
 * Usage:
 *   npx tsx src/jobs/tm-efl-targets.ts [transferdataDir]
 *   TM_TARGETS=transferdata/tm_efl_targets.json python scripts/tm_scrape_seasons.py
 */
import 'dotenv/config';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { EFL_LEAGUES } from './ingest-config.js';

const DIR = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'transferdata';
const EFL_NAMES = EFL_LEAGUES.map((l) => l.name);

type MapRow = { ourId: string; tmId: string; code: string; name: string };

async function main() {
  const mapPath = join(DIR, 'tm_id_map.json');
  const byOurId = new Map<string, MapRow>();
  if (existsSync(mapPath)) {
    const mapped = JSON.parse(readFileSync(mapPath, 'utf8')) as MapRow[];
    for (const row of mapped) byOurId.set(row.ourId, row);
  }

  const nameList = sql.join(EFL_NAMES.map((n) => sql`${n}`), sql`, `);
  const rows = (await db.execute(sql`
    SELECT p.id, p.name, p.tm_player_id AS "tmPlayerId", p.birth_date::text AS dob
    FROM players p
    WHERE p.current_league IN (${nameList})
    ORDER BY p.name, p.id
  `)) as unknown as Array<{ id: string; name: string; tmPlayerId: string | null; dob: string | null }>;

  const targets: Array<{ ourId: string; tmId: string; code: string; name: string; dob: string }> = [];
  let missingTm = 0;
  let missingDob = 0;

  for (const row of rows) {
    const mapped = byOurId.get(row.id);
    const tmId = row.tmPlayerId || mapped?.tmId;
    if (!tmId) {
      missingTm += 1;
      continue;
    }
    if (!row.dob) {
      missingDob += 1;
      continue;
    }
    targets.push({
      ourId: row.id,
      tmId,
      code: mapped?.code || 'x',
      name: row.name,
      dob: row.dob.slice(0, 10),
    });
  }

  const outPath = join(DIR, 'tm_efl_targets.json');
  writeFileSync(outPath, JSON.stringify(targets, null, 0));
  console.log(`Current EFL squad players: ${rows.length}`);
  console.log(`Scrape targets (have TM id + DOB): ${targets.length}`);
  if (missingTm > 0) console.log(`  skipped ${missingTm} with no Transfermarkt id`);
  if (missingDob > 0) console.log(`  skipped ${missingDob} with no birth date`);
  console.log(`Wrote ${outPath}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
