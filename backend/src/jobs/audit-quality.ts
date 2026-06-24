/**
 * Data-quality validation — turns "looks complete" into "verified against known truths".
 * Read-only, ZERO API. Spot-checks famous players, top-scorer sanity, duplicate/merge
 * detection, and orphan/zero rows.
 *
 * Usage: DATABASE_URL=... npm run job:audit-quality
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

async function rows<T extends Record<string, unknown>>(query: ReturnType<typeof sql>): Promise<T[]> {
  return (await db.execute(query)) as unknown as T[];
}

const SPOT_CHECK_PLAYERS = [
  'Steven Gerrard',
  'Frank Lampard',
  'Thierry Henry',
  'Francesco Totti',
  'Paolo Maldini',
  'Alan Shearer',
  'Ronaldinho',
  'Del Piero',
];

// (leagueId, season-start, what we expect — for eyeballing)
const TOP_SCORER_CHECKS = [
  { leagueId: 39, season: 1995, label: 'PL 1995-96', expected: 'Alan Shearer ~31' },
  { leagueId: 39, season: 1999, label: 'PL 1999-00', expected: 'Kevin Phillips ~30' },
  { leagueId: 39, season: 2007, label: 'PL 2007-08', expected: 'Cristiano Ronaldo ~31' },
  { leagueId: 140, season: 2011, label: 'La Liga 2011-12', expected: 'Lionel Messi ~50' },
  { leagueId: 135, season: 2007, label: 'Serie A 2007-08', expected: 'Del Piero ~21' },
];

async function main() {
  console.log('\n══════════════════════════════════════════════');
  console.log('  BALL KNOWLEDGE — DATA QUALITY CHECK');
  console.log('══════════════════════════════════════════════');

  // ---------- KNOWN-PLAYER SPOT CHECKS ----------
  console.log('\n── SPOT CHECKS (famous players resolve correctly?) ──');
  for (const name of SPOT_CHECK_PLAYERS) {
    const matches = await rows<{
      name: string;
      nationality: string;
      seasons: number;
      min_s: number | null;
      max_s: number | null;
      goals: number | null;
      apps: number | null;
      clubs: string | null;
    }>(sql`
      SELECT p.name, p.nationality,
             COUNT(DISTINCT s.season)::int AS seasons,
             MIN(s.season)::int AS min_s, MAX(s.season)::int AS max_s,
             SUM(s.goals)::int AS goals, SUM(s.appearances)::int AS apps,
             STRING_AGG(DISTINCT s.team_name, ', ') AS clubs
      FROM players p
      LEFT JOIN player_stats s ON s.player_id = p.id
      WHERE p.name ILIKE ${'%' + name + '%'}
      GROUP BY p.id, p.name, p.nationality
      ORDER BY apps DESC NULLS LAST
      LIMIT 2
    `);

    if (matches.length === 0) {
      console.log(`  ❌ ${name}: NOT FOUND`);
      continue;
    }
    for (const m of matches) {
      const span = m.min_s && m.max_s ? `${m.min_s}–${m.max_s}` : 'no stats';
      const clubs = (m.clubs ?? '').split(', ').slice(0, 5).join(', ');
      console.log(
        `  ✅ ${m.name} (${m.nationality}) — ${span}, ${m.apps ?? 0} apps, ${m.goals ?? 0} gls`
      );
      console.log(`       clubs: ${clubs || '—'}`);
    }
  }

  // ---------- TOP-SCORER SANITY ----------
  console.log('\n── TOP-SCORER SANITY (value accuracy) ──');
  for (const check of TOP_SCORER_CHECKS) {
    const top = await rows<{ name: string; goals: number; apps: number }>(sql`
      SELECT p.name, SUM(s.goals)::int AS goals, SUM(s.appearances)::int AS apps
      FROM player_stats s
      JOIN players p ON p.id = s.player_id
      WHERE s.league_id = ${check.leagueId} AND s.season = ${check.season}
      GROUP BY p.id, p.name
      ORDER BY goals DESC
      LIMIT 1
    `);
    const got = top[0];
    console.log(
      `  ${check.label.padEnd(16)} got: ${got ? `${got.name} ${got.goals}g` : 'NONE'}  (expect ${check.expected})`
    );
  }

  // ---------- DUPLICATE / MERGE DETECTION ----------
  console.log('\n── DUPLICATES (possible failed merges) ──');
  const dupSummary = await rows<{ dup_names: number; dup_rows: number }>(sql`
    WITH dups AS (
      SELECT lower(name) AS n, COUNT(*)::int AS c
      FROM players GROUP BY lower(name) HAVING COUNT(*) > 1
    )
    SELECT COUNT(*)::int AS dup_names, COALESCE(SUM(c), 0)::int AS dup_rows FROM dups
  `);
  console.log(
    `  ${dupSummary[0]?.dup_names ?? 0} names appear on 2+ player rows (${dupSummary[0]?.dup_rows ?? 0} rows total)`
  );
  const topDups = await rows<{ name: string; c: number }>(sql`
    SELECT name, COUNT(*)::int AS c
    FROM players GROUP BY name HAVING COUNT(*) > 1
    ORDER BY c DESC, name ASC LIMIT 12
  `);
  if (topDups.length > 0) {
    console.log('  Worst offenders:');
    for (const d of topDups) console.log(`     ${d.c}×  ${d.name}`);
  }

  // ---------- ORPHANS / ZEROS ----------
  console.log('\n── INTEGRITY ──');
  const integrity = await rows<{
    orphan_stats: number;
    players_no_stats: number;
    stats_negative: number;
    total_players: number;
    total_stat_rows: number;
  }>(sql`
    SELECT
      (SELECT COUNT(*) FROM player_stats s WHERE NOT EXISTS (SELECT 1 FROM players p WHERE p.id = s.player_id))::int AS orphan_stats,
      (SELECT COUNT(*) FROM players p WHERE NOT EXISTS (SELECT 1 FROM player_stats s WHERE s.player_id = p.id))::int AS players_no_stats,
      (SELECT COUNT(*) FROM player_stats WHERE goals < 0 OR appearances < 0)::int AS stats_negative,
      (SELECT COUNT(*) FROM players)::int AS total_players,
      (SELECT COUNT(*) FROM player_stats)::int AS total_stat_rows
  `);
  const it = integrity[0]!;
  console.log(`  Players: ${it.total_players} · stat rows: ${it.total_stat_rows}`);
  console.log(`  ${it.orphan_stats === 0 ? '✅' : '❌'} orphan stat rows: ${it.orphan_stats}`);
  console.log(`  ${it.stats_negative === 0 ? '✅' : '❌'} negative goals/apps: ${it.stats_negative}`);
  console.log(`  ⚠️  players with no stats: ${it.players_no_stats} (FBref-only legends may legitimately have club text but check)`);

  console.log('\n══════════════════════════════════════════════\n');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
