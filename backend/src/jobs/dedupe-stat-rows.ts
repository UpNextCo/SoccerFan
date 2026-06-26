/**
 * Collapse duplicate player_stats rows for the SAME (player, league, season, club).
 * These arise because different sources/spellings get different synthetic team_ids, so
 * two rows for one real club-season coexist under the unique key and double-count totals.
 *
 * Run AFTER canonicalize-teams (which unifies the team_name spellings). For each duplicate
 * group we keep one row and merge each stat field as the MAX (the two rows are the SAME
 * appearances measured by two sources — we take the most complete, never the sum).
 *
 * Pure DB. DRY RUN by default; pass "apply" to write.
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

const APPLY = process.argv.includes('apply') || process.env.APPLY === '1';

interface Group {
  ids: string[];
  appearances: number; minutes: number; goals: number; assists: number;
  yellow_cards: number; red_cards: number;
  clean_sheets: number | null; saves: number | null; fouls_committed: number | null; tackles: number | null;
}

async function main() {
  console.log(`Dedupe duplicate stat rows — ${APPLY ? 'APPLY (writing)' : 'DRY RUN'}\n`);

  const groups = (await db.execute(sql`
    SELECT array_agg(id) AS ids,
      MAX(appearances) AS appearances, MAX(minutes) AS minutes, MAX(goals) AS goals,
      MAX(assists) AS assists, MAX(yellow_cards) AS yellow_cards, MAX(red_cards) AS red_cards,
      MAX(clean_sheets) AS clean_sheets, MAX(saves) AS saves,
      MAX(fouls_committed) AS fouls_committed, MAX(tackles) AS tackles
    FROM player_stats
    WHERE team_name IS NOT NULL
    GROUP BY player_id, league_id, season, team_name
    HAVING COUNT(*) > 1
  `)) as unknown as Group[];

  const excess = groups.reduce((s, g) => s + (g.ids.length - 1), 0);
  console.log(`${groups.length} duplicate club-season groups · ${excess} rows to remove`);

  if (!APPLY) {
    console.log('\n(DRY RUN — re-run with "apply" to write.)');
    process.exit(0);
  }

  let merged = 0;
  for (const g of groups) {
    const [keep, ...drop] = g.ids;
    await db.execute(sql`
      UPDATE player_stats SET
        appearances = ${g.appearances}, minutes = ${g.minutes}, goals = ${g.goals},
        assists = ${g.assists}, yellow_cards = ${g.yellow_cards}, red_cards = ${g.red_cards},
        clean_sheets = ${g.clean_sheets}, saves = ${g.saves},
        fouls_committed = ${g.fouls_committed}, tackles = ${g.tackles}
      WHERE id = ${keep}
    `);
    if (drop.length) {
      const list = sql.join(drop.map((d) => sql`${d}::uuid`), sql`, `);
      await db.execute(sql`DELETE FROM player_stats WHERE id IN (${list})`);
    }
    merged += 1;
  }
  console.log(`Merged ${merged} groups, removed ${excess} duplicate rows.`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
