/**
 * Build the crawl target list: mapped players (tm_id_map.json) that are game-relevant (fame-floored)
 * and have a birth date, ordered by fame. Output: transferdata/tm_targets.json
 * [{ ourId, tmId, code, name, dob }]
 *
 * Usage: npx tsx src/jobs/tm-targets.ts [transferdataDir]
 */
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

const DIR = process.argv[2] ?? 'transferdata';

async function main() {
  const map = JSON.parse(readFileSync(join(DIR, 'tm_id_map.json'), 'utf8')) as Array<{ ourId: string; tmId: string; code: string; name: string }>;
  const byOurId = new Map(map.map((m) => [m.ourId, m]));

  // Fame floor: real value tier OR a major final OR an individual award. Ordered by fame.
  const rows = (await db.execute(sql`
    SELECT p.id, p.birth_date::text AS dob,
      (p.market_value_tier * 10
        + LEAST(COALESCE((SELECT COUNT(*) FROM final_appearances f WHERE f.player_id = p.id), 0), 6) * 4
        + LEAST(COALESCE((SELECT COUNT(*) FROM player_awards a WHERE a.player_id = p.id), 0), 4) * 6) AS fame
    FROM players p
    WHERE p.birth_date IS NOT NULL
      AND (p.market_value_tier >= 3
           OR EXISTS (SELECT 1 FROM final_appearances f WHERE f.player_id = p.id)
           OR EXISTS (SELECT 1 FROM player_awards a WHERE a.player_id = p.id))
    ORDER BY fame DESC, p.id
  `)) as unknown as Array<{ id: string; dob: string; fame: number }>;

  const targets: Array<{ ourId: string; tmId: string; code: string; name: string; dob: string }> = [];
  for (const r of rows) {
    const m = byOurId.get(r.id);
    if (!m) continue; // not mapped to a TM id
    targets.push({ ourId: r.id, tmId: m.tmId, code: m.code, name: m.name, dob: r.dob.slice(0, 10) });
  }

  writeFileSync(join(DIR, 'tm_targets.json'), JSON.stringify(targets, null, 0));
  console.log(`Fame-floored + mapped targets: ${targets.length}`);
  console.log(`Wrote ${join(DIR, 'tm_targets.json')}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
