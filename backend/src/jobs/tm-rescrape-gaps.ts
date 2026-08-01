/**
 * List players whose Transfermarkt season scrape is missing seasons we can independently prove they
 * played, and write them to transferdata/tm_rescrape.txt for scripts/tm_forget.py to requeue.
 *
 * Why they go missing: the scraper originally only understood split-season labels ("23/24"), so every
 * calendar-year competition was dropped — MLS, Brasileirão, Liga MX, J1, pre-2011 Russia, Scandinavia.
 * That cost Henry his 52 Red Bulls goals and Zlatan his LA Galaxy years. The parser is fixed, but
 * players scraped before the fix still hold the truncated version.
 *
 * The check is source-agnostic: any season present in player_stats or player_career but absent from the
 * scrape means the scrape is incomplete, whatever the cause.
 *
 * Usage:
 *   npx tsx src/jobs/tm-rescrape-gaps.ts [transferdataDir] [--min-missing N]
 *   ./.venv/bin/python scripts/tm_forget.py --ids transferdata/tm_rescrape.txt
 */
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

const DIR = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'transferdata';
const MIN_MISSING = Number(process.argv.find((a) => a.startsWith('--min-missing='))?.slice(14) ?? 1);
const OUT = join(DIR, 'tm_rescrape.txt');

interface Line { ourId: string; rows: Array<{ season: number; comp: string; apps: number }> }

async function main() {
  const text = readFileSync(join(DIR, 'tm_seasons.jsonl'), 'utf8').trim();
  const scraped = new Map<string, Set<number>>();
  for (const line of text ? text.split('\n') : []) {
    const ln = JSON.parse(line) as Line;
    if (!ln.rows.length) continue; // a failed scrape has nothing to compare against
    scraped.set(ln.ourId, new Set(ln.rows.filter((r) => r.apps > 0).map((r) => r.season)));
  }
  console.log(`scrapes with rows: ${scraped.size}`);
  if (!scraped.size) process.exit(0);

  const idArr = sql`ARRAY[${sql.join([...scraped.keys()].map((i) => sql`${i}::uuid`), sql`, `)}]`;
  const thisSeason = new Date().getUTCFullYear();
  const ours = (await db.execute(sql`
    SELECT player_id, season FROM player_stats
    WHERE player_id = ANY(${idArr}) AND league_id <> 1 AND COALESCE(appearances, 0) > 0
    UNION
    SELECT pc.player_id, gs.season
    FROM player_career pc,
         LATERAL generate_series(pc.season_from, LEAST(COALESCE(pc.season_to, pc.season_from), ${thisSeason})) AS gs(season)
    WHERE pc.player_id = ANY(${idArr}) AND pc.team_id > 0
  `)) as unknown as Array<{ player_id: string; season: number }>;

  const missing = new Map<string, Set<number>>();
  for (const row of ours) {
    if (scraped.get(row.player_id)?.has(row.season) !== false) continue;
    const seasons = missing.get(row.player_id) ?? new Set<number>();
    seasons.add(row.season);
    missing.set(row.player_id, seasons);
  }

  const needed = [...missing.entries()].filter(([, s]) => s.size >= MIN_MISSING);
  writeFileSync(OUT, needed.map(([id]) => id).join('\n') + (needed.length ? '\n' : ''));
  console.log(`missing >=${MIN_MISSING} season(s): ${needed.length}`);
  console.log(`wrote ${OUT}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
