/**
 * Import career penalty-goal totals from the FBref backfill JSON (scripts/fbref_backfill.py,
 * which now carries a `penalties` field per league-season). FBref has penalties for the Big-5
 * leagues across ALL eras (1995+), so this is the era-complete source for the "penalty goals"
 * category — unlike the Transfermarkt event count, which only covers ~2012+ and undercounts
 * pre-2010 legends (Lampard, Shearer, Henry…).
 *
 * Sums penalties per player across all seasons, matches to EXISTING players by normalised name
 * (we only attribute to players we already hold; ambiguous/unknown names are skipped), and writes
 * player_extra_stats.fbref_penalties.
 *
 * Usage: DATABASE_URL=... npx tsx src/jobs/import-fbref-penalties.ts [fbref_penalties.json]
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { normalizeSearchText } from '../utils/playerSearch.js';

interface FbrefRow { player: string; leagueId: number; penalties?: number }

// FBref league id (= our api-football id) → the per-league column it feeds.
const LEAGUE_COL: Record<number, 'pl' | 'laliga' | 'seriea' | 'bundesliga' | 'ligue1'> = {
  39: 'pl', 140: 'laliga', 135: 'seriea', 78: 'bundesliga', 61: 'ligue1',
};

interface Pens { pl: number; laliga: number; seriea: number; bundesliga: number; ligue1: number; }
const blank = (): Pens => ({ pl: 0, laliga: 0, seriea: 0, bundesliga: 0, ligue1: 0 });

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  for (const c of ['fbref_penalties', 'pl_penalties', 'laliga_penalties', 'seriea_penalties', 'bundesliga_penalties', 'ligue1_penalties']) {
    await db.execute(sql`ALTER TABLE player_extra_stats ADD COLUMN IF NOT EXISTS ${sql.raw(c)} integer NOT NULL DEFAULT 0`);
  }

  const path = process.argv[2] ?? 'fbref_penalties.json';
  const rows: FbrefRow[] = JSON.parse(readFileSync(path, 'utf8'));
  console.log(`Loaded ${rows.length} FBref rows from ${path}`);

  // Penalties PER LEAGUE per normalised player name.
  const byName = new Map<string, Pens>();
  for (const r of rows) {
    const pens = Number(r.penalties ?? 0) || 0;
    if (pens <= 0) continue;
    const which = LEAGUE_COL[r.leagueId];
    if (!which) continue;
    const key = normalizeSearchText(r.player);
    if (!key) continue;
    const p = byName.get(key) ?? blank();
    p[which] += pens;
    byName.set(key, p);
  }
  console.log(`${byName.size} players have >=1 FBref penalty`);

  // Match to EXISTING players by normalised name. Ambiguous names (e.g. two "Bruno Fernandes")
  // resolve to the strongest career row — most apps, then has API-Football / TM id.
  const existing = (await db.execute(sql`
    SELECT p.id, p.name, p.api_football_id, p.tm_player_id,
           COALESCE(SUM(s.appearances), 0)::int AS apps
    FROM players p
    LEFT JOIN player_stats s ON s.player_id = p.id
    GROUP BY p.id
  `)) as unknown as Array<{
    id: string;
    name: string;
    api_football_id: number | null;
    tm_player_id: string | null;
    apps: number;
  }>;
  const candsByName = new Map<string, typeof existing>();
  for (const p of existing) {
    const k = normalizeSearchText(p.name);
    const arr = candsByName.get(k) ?? [];
    arr.push(p);
    candsByName.set(k, arr);
  }

  const updates: Array<{ id: string; p: Pens }> = [];
  let ambiguousResolved = 0;
  let unmatched = 0;
  for (const [name, p] of byName) {
    const cands = candsByName.get(name);
    if (!cands?.length) { unmatched += 1; continue; }
    if (cands.length > 1) {
      cands.sort((a, b) => {
        if (b.apps !== a.apps) return b.apps - a.apps;
        const aId = a.api_football_id != null || a.tm_player_id != null ? 1 : 0;
        const bId = b.api_football_id != null || b.tm_player_id != null ? 1 : 0;
        return bId - aId;
      });
      ambiguousResolved += 1;
    }
    updates.push({ id: cands[0]!.id, p });
  }
  console.log(
    `Matched ${updates.length} players (${ambiguousResolved} ambiguous names resolved by apps, ${unmatched} unmatched skipped)`
  );

  for (const batch of chunk(updates, 300)) {
    const tuples = batch.map((u) => sql`(${u.id}::uuid, ${u.p.pl + u.p.laliga + u.p.seriea + u.p.bundesliga + u.p.ligue1}, ${u.p.pl}, ${u.p.laliga}, ${u.p.seriea}, ${u.p.bundesliga}, ${u.p.ligue1})`);
    await db.execute(sql`
      INSERT INTO player_extra_stats AS p
        (player_id, fbref_penalties, pl_penalties, laliga_penalties, seriea_penalties, bundesliga_penalties, ligue1_penalties)
      VALUES ${sql.join(tuples, sql`, `)}
      ON CONFLICT (player_id) DO UPDATE SET
        fbref_penalties = EXCLUDED.fbref_penalties, pl_penalties = EXCLUDED.pl_penalties,
        laliga_penalties = EXCLUDED.laliga_penalties, seriea_penalties = EXCLUDED.seriea_penalties,
        bundesliga_penalties = EXCLUDED.bundesliga_penalties, ligue1_penalties = EXCLUDED.ligue1_penalties,
        updated_at = now()
    `);
  }
  console.log(`Wrote per-league penalties for ${updates.length} players.`);

  for (const [label, col] of [['Premier League', 'pl_penalties'], ['La Liga', 'laliga_penalties'], ['Serie A', 'seriea_penalties']] as const) {
    const top = (await db.execute(sql`
      SELECT pl.name, e.${sql.raw(col)} v FROM player_extra_stats e JOIN players pl ON pl.id = e.player_id
      WHERE e.${sql.raw(col)} > 0 ORDER BY e.${sql.raw(col)} DESC LIMIT 8
    `)) as unknown as Array<{ name: string; v: number }>;
    console.log(`\n${label} penalties:\n  ` + top.map((t) => `${t.name}(${t.v})`).join(', '));
  }
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
