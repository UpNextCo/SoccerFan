/**
 * Full data-contamination report. Read-only, ZERO API. Checks every field the game
 * generators depend on and flags cross-source pollution (team_name variants, bad
 * nationalities, honour-string drift, duplicate residue, impossible stats).
 *
 * Usage: DATABASE_URL=... npm run job:audit-contamination
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

async function rows<T extends Record<string, unknown>>(q: ReturnType<typeof sql>): Promise<T[]> {
  return (await db.execute(q)) as unknown as T[];
}
async function one<T extends Record<string, unknown>>(q: ReturnType<typeof sql>): Promise<T> {
  return (await rows<T>(q))[0]!;
}
function mark(ok: boolean): string {
  return ok ? '✅' : '⚠️ ';
}

async function main() {
  console.log('\n══════════════════════════════════════════════');
  console.log('  DATA CONTAMINATION REPORT');
  console.log('══════════════════════════════════════════════');

  // ---------- CLUBS (player_stats.team_name) ----------
  const clubs = await one<{
    distinct_teams: number;
    prefixed: number;
    prefixed_rows: number;
    reserves: number;
    unmatched: number;
    unmatched_rows: number;
  }>(sql`
    WITH cleaned AS (
      SELECT team_name,
             regexp_replace(team_name, '^[a-z]{2,3} ', '') AS stripped,
             COUNT(*)::int AS n
      FROM player_stats WHERE team_name IS NOT NULL
      GROUP BY team_name
    ),
    matched AS (
      SELECT c.*, EXISTS (
        SELECT 1 FROM teams t
        WHERE lower(t.name_norm) = lower(translate(c.stripped,
          'àáâãäåçèéêëìíîïñòóôõöùúûüýÿ','aaaaaaceeeeiiiinooooouuuuyy'))
          OR lower(t.name) = lower(c.stripped)
      ) AS in_registry
      FROM cleaned c
    )
    SELECT
      (SELECT COUNT(*) FROM cleaned)::int AS distinct_teams,
      (SELECT COUNT(*) FROM cleaned WHERE team_name ~ '^[a-z]{2,3} ')::int AS prefixed,
      (SELECT COALESCE(SUM(n),0) FROM cleaned WHERE team_name ~ '^[a-z]{2,3} ')::int AS prefixed_rows,
      (SELECT COUNT(*) FROM cleaned WHERE team_name ~ '( II| B| C| U19| U21| U23)$')::int AS reserves,
      (SELECT COUNT(*) FROM matched WHERE NOT in_registry)::int AS unmatched,
      (SELECT COALESCE(SUM(n),0) FROM matched WHERE NOT in_registry)::int AS unmatched_rows
  `);

  console.log('\n── CLUBS (player_stats.team_name) ──────────────');
  console.log(`   ${clubs.distinct_teams} distinct club strings`);
  console.log(`${mark(clubs.prefixed === 0)} ${clubs.prefixed} have country-code prefixes (${clubs.prefixed_rows} rows)`);
  console.log(`   ${clubs.reserves} look like reserve/youth sides`);
  console.log(`${mark(clubs.unmatched_rows < 2000)} ${clubs.unmatched} club strings (${clubs.unmatched_rows} rows) don't map to the teams registry`);

  const topUnmatched = await rows<{ stripped: string; n: number }>(sql`
    WITH cleaned AS (
      SELECT regexp_replace(team_name, '^[a-z]{2,3} ', '') AS stripped, COUNT(*)::int AS n
      FROM player_stats WHERE team_name IS NOT NULL GROUP BY team_name
    )
    SELECT stripped, SUM(n)::int AS n FROM cleaned c
    WHERE NOT EXISTS (
      SELECT 1 FROM teams t WHERE lower(t.name) = lower(c.stripped)
        OR lower(t.name_norm) = lower(translate(c.stripped,'àáâãäåçèéêëìíîïñòóôõöùúûüýÿ','aaaaaaceeeeiiiinooooouuuuyy'))
    )
    GROUP BY stripped ORDER BY n DESC LIMIT 25
  `);
  console.log('   Top unmatched clubs (need alias → canonical):');
  for (const r of topUnmatched) console.log(`     ${String(r.n).padStart(5)}  ${r.stripped}`);

  // ---------- NATIONALITY ----------
  const nat = await one<{ distinct_nats: number; unknown_rows: number; lowercase: number }>(sql`
    SELECT
      (SELECT COUNT(DISTINCT nationality) FROM players)::int AS distinct_nats,
      (SELECT COUNT(*) FROM players WHERE nationality IS NULL OR nationality = '' OR nationality = 'Unknown')::int AS unknown_rows,
      (SELECT COUNT(DISTINCT nationality) FROM players WHERE nationality ~ '^[a-z]')::int AS lowercase
  `);
  console.log('\n── NATIONALITY (players) ───────────────────────');
  console.log(`   ${nat.distinct_nats} distinct nationalities`);
  console.log(`${mark(nat.unknown_rows < 500)} ${nat.unknown_rows} players with Unknown/blank nationality`);
  console.log(`${mark(nat.lowercase === 0)} ${nat.lowercase} lowercase/odd nationality values`);

  // ---------- POSITION / LEAGUE ----------
  const pos = await rows<{ position: string; n: number }>(sql`SELECT position, COUNT(*)::int n FROM players GROUP BY position ORDER BY n DESC`);
  console.log('\n── POSITION (players) ──────────────────────────');
  console.log(`${mark(pos.length <= 6)} ${pos.length} distinct: ${pos.map((p) => `${p.position}(${p.n})`).join(', ')}`);

  const lg = await rows<{ league_name: string; n: number }>(sql`SELECT league_name, COUNT(*)::int n FROM player_stats GROUP BY league_name ORDER BY n DESC`);
  console.log('\n── LEAGUES (player_stats) ──────────────────────');
  console.log(`   ${lg.length} distinct league names:`);
  for (const r of lg) console.log(`     ${String(r.n).padStart(7)}  ${r.league_name}`);

  // ---------- HONOURS (competition strings) ----------
  const honours = await rows<{ competition: string; winners: number }>(sql`
    SELECT competition, COUNT(DISTINCT player_id)::int AS winners
    FROM player_honours WHERE placement ILIKE '%winner%'
    GROUP BY competition ORDER BY winners DESC LIMIT 20
  `);
  console.log('\n── HONOURS (top competitions by winners) ───────');
  for (const r of honours) console.log(`     ${String(r.winners).padStart(5)}  ${r.competition}`);

  // ---------- DUPLICATE RESIDUE ----------
  const dup = await one<{ name_nat: number; with_dob: number }>(sql`
    SELECT
      (SELECT COUNT(*) FROM (SELECT lower(trim(name)) ln, nationality FROM players GROUP BY 1,2 HAVING COUNT(*)>1) a)::int AS name_nat,
      (SELECT COUNT(*) FROM (SELECT birth_date, nationality FROM players WHERE birth_date IS NOT NULL GROUP BY 1,2 HAVING COUNT(*)>1) b)::int AS with_dob
  `);
  console.log('\n── DUPLICATE RESIDUE ───────────────────────────');
  console.log(`   ${dup.name_nat} same name+nationality clusters (mostly different people)`);
  console.log(`   ${dup.with_dob} same DOB+nationality clusters (twins/siblings or residual dups)`);

  // ---------- STATS SANITY ----------
  const stats = await one<{ impossible_apps: number; neg: number; ext_mismatch: number }>(sql`
    SELECT
      (SELECT COUNT(*) FROM player_stats WHERE appearances > 60)::int AS impossible_apps,
      (SELECT COUNT(*) FROM player_stats WHERE goals < 0 OR assists < 0 OR appearances < 0)::int AS neg,
      (SELECT COUNT(*) FROM player_stats s JOIN players p ON p.id=s.player_id
        WHERE s.external_player_id IS NOT NULL AND p.external_id IS NOT NULL
          AND s.external_player_id <> p.external_id)::int AS ext_mismatch
  `);
  console.log('\n── STATS SANITY (player_stats) ─────────────────');
  console.log(`${mark(stats.impossible_apps === 0)} ${stats.impossible_apps} rows with >60 appearances in a season`);
  console.log(`${mark(stats.neg === 0)} ${stats.neg} rows with negative goals/assists/apps`);
  console.log(`${mark(stats.ext_mismatch === 0)} ${stats.ext_mismatch} rows whose external id disagrees with the player's`);

  console.log('\n══════════════════════════════════════════════\n');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
