/**
 * Backfill pre-Transfermarkt (≤2011) league/CL assist gaps from FBref JSON.
 *
 * The Transfermarkt backfill (backfill-assists-tm) fixes 2012+, but the dump starts at 2012/13,
 * leaving the 2010 & 2011 seasons (and a few older ones FBref has) still broken. FBref's standard
 * stats carry assists for the big-5 back to ~1999 (already in fbref_penalties.json) and for the
 * Champions League back to 2010-11 (scrape fbref_cl_scrape.py → fbref_cl_backfill.json).
 *
 * We fill ONLY the broken (league, season) pairs (abnormally low assists:goals ratio) and match
 * FBref → our players by normalized name SCOPED to that league-season (so same-name collisions
 * across eras can't cross-contaminate).
 *
 * Usage: DATABASE_URL=... npx tsx src/jobs/backfill-assists-fbref.ts [file1.json file2.json ...]
 *        (defaults to fbref_penalties.json + fbref_cl_backfill.json when present)
 */
import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

interface FbrefRow { player: string; leagueId: number; season: number; goals?: number; assists?: number; }

function norm(name: string): string {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function main() {
  const args = process.argv.slice(2);
  const files = (args.length ? args : ['fbref_penalties.json', 'fbref_cl_backfill.json']).filter((f) => existsSync(f));
  if (files.length === 0) { console.log('No FBref JSON files found.'); process.exit(0); }
  console.log('Reading:', files.join(', '));

  // FBref assists aggregated by `${league}|${season}|${normName}`.
  const fb = new Map<string, number>();
  for (const file of files) {
    const rows = JSON.parse(readFileSync(file, 'utf8')) as FbrefRow[];
    for (const r of rows) {
      const a = Number(r.assists) || 0;
      if (a <= 0) continue;
      const key = `${r.leagueId}|${r.season}|${norm(r.player)}`;
      fb.set(key, (fb.get(key) ?? 0) + a);
    }
  }
  console.log(`${fb.size} FBref (league,season,name) assist totals`);

  // Broken (league, season) pairs.
  const ratioRows = (await db.execute(sql`
    SELECT league_id, season, SUM(assists)::int AS a, SUM(goals)::int AS g FROM player_stats
    WHERE league_id IN (39, 140, 135, 78, 61, 2, 3)
    GROUP BY league_id, season
    HAVING SUM(goals) > 50 AND SUM(assists) < 0.2 * SUM(goals)
  `)) as unknown as Array<{ league_id: number; season: number; a: number; g: number }>;
  const gapSet = new Set(ratioRows.map((r) => `${r.league_id}|${r.season}`));
  console.log(`${gapSet.size} broken league-seasons still:`, ratioRows.map((r) => `${r.league_id}/${r.season}`).join(', '));

  // Our rows for those seasons → best (max-apps) row per (player, league, season) + its name.
  const rows = (await db.execute(sql`
    SELECT s.id, s.player_id, s.league_id, s.season, s.appearances, p.name
    FROM player_stats s JOIN players p ON p.id = s.player_id
    WHERE s.league_id IN (39, 140, 135, 78, 61, 2, 3)
  `)) as unknown as Array<{ id: string; player_id: string; league_id: number; season: number; appearances: number; name: string }>;

  // For each (league, season, normName) keep the row with the most apps.
  const best = new Map<string, { id: string; apps: number }>();
  for (const r of rows) {
    if (!gapSet.has(`${r.league_id}|${r.season}`)) continue;
    const key = `${r.league_id}|${r.season}|${norm(r.name)}`;
    const cur = best.get(key);
    if (!cur || r.appearances > cur.apps) best.set(key, { id: r.id, apps: r.appearances });
  }

  const updates: Array<{ id: string; assists: number }> = [];
  for (const [key, assists] of fb) {
    const target = best.get(key);
    if (target) updates.push({ id: target.id, assists });
  }
  console.log(`${updates.length} player_stats rows to update`);

  let done = 0;
  for (let i = 0; i < updates.length; i += 500) {
    const batch = updates.slice(i, i + 500);
    const values = sql.join(batch.map((u) => sql`(${u.id}::uuid, ${u.assists}::int)`), sql`, `);
    await db.execute(sql`
      UPDATE player_stats AS s SET assists = v.a
      FROM (VALUES ${values}) AS v(id, a)
      WHERE s.id = v.id
    `);
    done += batch.length;
  }
  console.log(`Updated ${done} rows.`);
  process.exit(0);
}

main();
