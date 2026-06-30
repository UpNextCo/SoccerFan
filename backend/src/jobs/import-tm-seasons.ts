/**
 * Import the scraped Transfermarkt per-season stats (transferdata/tm_seasons.jsonl) into
 * player_stats — GAP-FILL ONLY: for each (player, league, season) we don't already have, add the
 * row (apps/goals/assists/minutes). Never touches existing rows, so career totals can't double-count.
 * Then re-derive player_extra_stats.goals_before_21 from all-era season totals + DOB.
 *
 * Only competitions we map to a tracked league id are imported (big-5, Championship, CL/EL, plus a
 * few other top divisions we hold crests for). Club name isn't on this page, so team_name is null
 * for gap-filled rows (the value here is the league/season/goals, which fixes goals-before-21 and
 * per-league career totals incl. the Championship).
 *
 * Usage: npx tsx src/jobs/import-tm-seasons.ts [transferdataDir] [--no-recompute]
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

const DIR = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'transferdata';
const NO_RECOMPUTE = process.argv.includes('--no-recompute');

// TM competition name -> { league_id, league_name }. Only tracked leagues are imported.
const COMP: Record<string, { id: number; name: string }> = {
  'premier league': { id: 39, name: 'Premier League' },
  'laliga': { id: 140, name: 'La Liga' },
  'serie a': { id: 135, name: 'Serie A' },
  'bundesliga': { id: 78, name: 'Bundesliga' },
  'ligue 1': { id: 61, name: 'Ligue 1' },
  'championship': { id: 40, name: 'Championship' },
  'uefa champions league': { id: 2, name: 'UEFA Champions League' },
  'uefa europa league': { id: 3, name: 'UEFA Europa League' },
  'uefa cup': { id: 3, name: 'UEFA Europa League' },
  'eredivisie': { id: 88, name: 'Eredivisie' },
  'liga portugal': { id: 94, name: 'Primeira Liga' },
  'liga portugal bwin': { id: 94, name: 'Primeira Liga' },
  'primeira liga': { id: 94, name: 'Primeira Liga' },
  'scottish premiership': { id: 179, name: 'Scottish Premiership' },
  'süper lig': { id: 203, name: 'Süper Lig' },
  'super lig': { id: 203, name: 'Süper Lig' },
  'major league soccer': { id: 253, name: 'Major League Soccer' },
  'saudi pro league': { id: 307, name: 'Saudi Pro League' },
};

interface Row { season: number; comp: string; apps: number; goals: number; assists: number; minutes: number }
interface Line { ourId: string; tmId: string; rows: Row[] }

async function main() {
  const text = readFileSync(join(DIR, 'tm_seasons.jsonl'), 'utf8').trim();
  const lines = text ? text.split('\n').map((l) => JSON.parse(l) as Line) : [];
  console.log(`Scraped players: ${lines.length}`);

  // Existing (player, league, season) keys so we only add genuine gaps.
  const existing = new Set<string>();
  const ex = (await db.execute(sql`SELECT player_id, league_id, season FROM player_stats`)) as unknown as Array<{ player_id: string; league_id: number; season: number }>;
  for (const r of ex) existing.add(`${r.player_id}|${r.league_id}|${r.season}`);

  type Ins = { pid: string; lid: number; lname: string; season: number; apps: number; goals: number; assists: number; minutes: number };
  const inserts: Ins[] = [];
  for (const ln of lines) {
    for (const r of ln.rows) {
      const c = COMP[r.comp.toLowerCase()];
      if (!c) continue;
      if (r.apps <= 0 && r.goals <= 0) continue;
      const key = `${ln.ourId}|${c.id}|${r.season}`;
      if (existing.has(key)) continue;
      existing.add(key);
      inserts.push({ pid: ln.ourId, lid: c.id, lname: c.name, season: r.season, apps: r.apps, goals: r.goals, assists: r.assists, minutes: r.minutes });
    }
  }
  console.log(`Gap rows to insert: ${inserts.length}`);

  let added = 0;
  for (let i = 0; i < inserts.length; i += 500) {
    const batch = inserts.slice(i, i + 500);
    const tuples = batch.map((x) => sql`(${x.pid}::uuid, ${x.lid}, ${x.lname}, ${x.season}, 0, ${x.apps}, ${x.minutes}, ${x.goals}, ${x.assists})`);
    await db.execute(sql`
      INSERT INTO player_stats (player_id, league_id, league_name, season, team_id, appearances, minutes, goals, assists)
      VALUES ${sql.join(tuples, sql`, `)}
      ON CONFLICT DO NOTHING
    `);
    added += batch.length;
  }
  console.log(`Inserted ${added} gap rows.`);

  if (!NO_RECOMPUTE) {
    // Re-derive goals before 21 from all club seasons (league_id<>1) where age at season start <= 20.
    const res = (await db.execute(sql`
      WITH gb AS (
        SELECT s.player_id, COALESCE(SUM(s.goals), 0)::int AS g
        FROM player_stats s JOIN players p ON p.id = s.player_id
        WHERE p.birth_date IS NOT NULL AND s.league_id <> 1
          AND s.season - EXTRACT(YEAR FROM p.birth_date)::int <= 20
        GROUP BY s.player_id
      )
      INSERT INTO player_extra_stats (player_id, goals_before_21)
      SELECT player_id, g FROM gb
      ON CONFLICT (player_id) DO UPDATE SET goals_before_21 = EXCLUDED.goals_before_21, updated_at = now()
      RETURNING player_id
    `)) as unknown as Array<{ player_id: string }>;
    console.log(`Recomputed goals_before_21 for ${res.length} players.`);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
