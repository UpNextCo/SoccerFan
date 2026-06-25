/**
 * Import FBref finals JSON (scripts/fbref_finals_scrape.py) into final_appearances.
 * Matches each final's players to our players by normalized name (+ aliases), breaking
 * collisions by career appearances. Players we can't match are still stored (player_id
 * NULL) so coverage is auditable, but only matched rows are usable in puzzles.
 *
 * Usage: DATABASE_URL=... npm run job:import-finals [path/to/fbref_finals.json]
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { normalizeSearchText } from '../utils/playerSearch.js';

interface FinalRow {
  competition: string;
  season: number;
  team: string;
  won: boolean;
  player: string;
  started: boolean;
  minutes: number;
  goals: number;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  const path = process.argv[2] ?? 'fbref_finals.json';
  const rows: FinalRow[] = JSON.parse(readFileSync(path, 'utf8'));
  console.log(`Loaded ${rows.length} final-appearance rows from ${path}`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS final_appearances (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      player_id uuid REFERENCES players(id) ON DELETE CASCADE,
      player_name text NOT NULL,
      competition text NOT NULL,
      season integer NOT NULL,
      team text NOT NULL,
      started boolean NOT NULL DEFAULT false,
      minutes integer NOT NULL DEFAULT 0,
      goals integer NOT NULL DEFAULT 0,
      won boolean NOT NULL DEFAULT false,
      created_at timestamp with time zone DEFAULT now() NOT NULL
    )
  `);
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS final_appearances_unique ON final_appearances (competition, season, player_name, team)`
  );
  await db.execute(sql`CREATE INDEX IF NOT EXISTS final_appearances_player_idx ON final_appearances (player_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS final_appearances_comp_idx ON final_appearances (competition, season)`);

  // name (+ alias) -> [{id, apps}]; pick highest-apps on collision.
  const players = (await db.execute(sql`
    SELECT p.id, p.name, p.aliases,
           COALESCE((SELECT SUM(appearances) FROM player_stats s WHERE s.player_id = p.id), 0)::int AS apps
    FROM players p
  `)) as unknown as Array<{ id: string; name: string; aliases: string[]; apps: number }>;

  const byName = new Map<string, Array<{ id: string; apps: number }>>();
  const add = (key: string, id: string, apps: number) => {
    if (!key) return;
    (byName.get(key) ?? byName.set(key, []).get(key)!).push({ id, apps });
  };
  for (const p of players) {
    add(normalizeSearchText(p.name), p.id, p.apps);
    for (const a of Array.isArray(p.aliases) ? p.aliases : []) add(normalizeSearchText(a), p.id, p.apps);
  }

  function matchPlayer(name: string): string | null {
    const cands = byName.get(normalizeSearchText(name));
    if (!cands || cands.length === 0) return null;
    return cands.slice().sort((a, b) => b.apps - a.apps)[0]!.id;
  }

  let matched = 0;
  const values = rows.map((r) => {
    const playerId = matchPlayer(r.player);
    if (playerId) matched += 1;
    return { ...r, playerId };
  });
  console.log(`Matched ${matched}/${rows.length} to players (${rows.length - matched} unmatched)`);

  let upserted = 0;
  for (const batch of chunk(values, 300)) {
    const tuples = batch.map(
      (v) =>
        sql`(${v.playerId ? sql`${v.playerId}::uuid` : sql`NULL`}, ${v.player}, ${v.competition}, ${v.season}, ${v.team}, ${v.started}, ${v.minutes}, ${v.goals}, ${v.won})`
    );
    await db.execute(sql`
      INSERT INTO final_appearances (player_id, player_name, competition, season, team, started, minutes, goals, won)
      VALUES ${sql.join(tuples, sql`, `)}
      ON CONFLICT (competition, season, player_name, team) DO UPDATE SET
        player_id = EXCLUDED.player_id,
        started = EXCLUDED.started,
        minutes = EXCLUDED.minutes,
        goals = EXCLUDED.goals,
        won = EXCLUDED.won
    `);
    upserted += batch.length;
  }
  console.log(`Upserted ${upserted} final-appearance rows.`);

  // quick coverage readout
  const cov = (await db.execute(sql`
    SELECT competition, COUNT(DISTINCT season)::int AS finals, COUNT(*)::int AS appearances,
           COUNT(*) FILTER (WHERE player_id IS NOT NULL)::int AS matched,
           SUM(goals)::int AS goals
    FROM final_appearances GROUP BY competition ORDER BY competition
  `)) as unknown as Array<Record<string, unknown>>;
  console.table(cov);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
