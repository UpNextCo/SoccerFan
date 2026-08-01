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
 * Second pass: the SAME scrape also carries every competition we DON'T track (domestic cups, super
 * cups, AFC/CONMEBOL football, second tiers worldwide), so we roll the whole club career up into
 * player_extra_stats.tm_career_goals / tm_career_apps. Without this, "Career Goals" summed only the
 * tracked leagues and Ronaldo showed ~600 of his 800+ club goals.
 *
 * Usage: npx tsx src/jobs/import-tm-seasons.ts [transferdataDir] [--no-recompute] [--totals-only]
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { countsForClubCareer } from '../utils/tmCompetitions.js';

const DIR = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'transferdata';
const NO_RECOMPUTE = process.argv.includes('--no-recompute');
const TOTALS_ONLY = process.argv.includes('--totals-only');

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

/**
 * Roll every senior club competition in the scrape up into one career total per player.
 * A player is only written when the scrape found senior club football — a failed scrape (no rows) or
 * an academy-only career leaves the columns NULL, which keeps them out of career categories instead
 * of ranking them on a zero.
 */
async function writeCareerTotals(lines: Line[]) {
  const totals = new Map<string, { goals: number; apps: number }>();
  for (const ln of lines) {
    let goals = 0;
    let apps = 0;
    for (const r of ln.rows) {
      if (!countsForClubCareer(r.comp)) continue;
      goals += Math.max(0, r.goals);
      apps += Math.max(0, r.apps);
    }
    if (apps <= 0) continue;
    // Re-scrapes append a second line for the same player; keep whichever run saw more football.
    const prev = totals.get(ln.ourId);
    if (!prev || apps > prev.apps) totals.set(ln.ourId, { goals, apps });
  }
  console.log(`Career totals to write: ${totals.size}`);

  const rows = [...totals.entries()];
  let written = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const tuples = batch.map(([pid, t]) => sql`(${pid}::uuid, ${t.goals}, ${t.apps})`);
    await db.execute(sql`
      INSERT INTO player_extra_stats (player_id, tm_career_goals, tm_career_apps)
      VALUES ${sql.join(tuples, sql`, `)}
      ON CONFLICT (player_id) DO UPDATE
        SET tm_career_goals = EXCLUDED.tm_career_goals,
            tm_career_apps = EXCLUDED.tm_career_apps,
            updated_at = now()
    `);
    written += batch.length;
  }
  console.log(`Wrote career totals for ${written} players.`);
}

async function main() {
  const text = readFileSync(join(DIR, 'tm_seasons.jsonl'), 'utf8').trim();
  const all = text ? text.split('\n').map((l) => JSON.parse(l) as Line) : [];

  // The scrape targets are built once and the dedupe/merge jobs retire players afterwards, so some
  // ourIds no longer exist. Their stats now live on whichever row absorbed them.
  const alive = new Set(
    ((await db.execute(sql`SELECT id FROM players`)) as unknown as Array<{ id: string }>).map((r) => r.id)
  );
  const lines = all.filter((l) => alive.has(l.ourId));
  console.log(`Scraped players: ${lines.length} (skipped ${all.length - lines.length} since merged away)`);

  if (TOTALS_ONLY) {
    await writeCareerTotals(lines);
    process.exit(0);
  }

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

  await writeCareerTotals(lines);

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
