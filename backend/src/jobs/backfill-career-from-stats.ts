/**
 * Backfill missing `player_career` club spells from `player_stats`.
 *
 * API-Football `/players/teams` often omits whole senior spells for legends (Anelka missing
 * Arsenal/RM/PSG/Liverpool; Verón with zero career rows). Stats usually still have those clubs
 * by name — resolve each name to a `teams.id` and insert any (player, club) not already present.
 *
 *   DATABASE_URL=... npm run job:backfill-career-from-stats
 *   DATABASE_URL=... npm run job:backfill-career-from-stats -- --dry-run
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { playerCareer } from '../db/schema.js';
import { clubCareerOnlySql } from '../utils/nationalTeam.js';
import { statsTeamNameKeySql } from '../utils/statsClubEvidence.js';

const dryRun = process.argv.includes('--dry-run');

type MissingSpell = {
  player_id: string;
  team_id: number;
  team_name: string;
  season_from: number;
  season_to: number;
  apps: number;
  player_name: string;
};

async function loadMissingSpells(): Promise<MissingSpell[]> {
  // Fast path: resolve team names via a one-row-per-name teams map, then anti-join career.
  // Avoids per-row correlated EXISTS against players.nationality until the candidate set is small.
  const rows = (await db.execute(sql`
    WITH nations AS (
      SELECT DISTINCT nationality AS name FROM players
      WHERE nationality IS NOT NULL AND nationality <> ''
    ),
    team_map AS (
      SELECT DISTINCT ON (lower(name))
        lower(name) AS name_key,
        id AS team_id,
        name AS team_name
      FROM teams
      WHERE id > 0
      ORDER BY lower(name), (league_id IS NOT NULL) DESC, id ASC
    ),
    stats_clubs AS (
      SELECT
        s.player_id,
        s.team_name,
        ${statsTeamNameKeySql(sql`s.team_name`)} AS name_key,
        MIN(s.season)::int AS season_from,
        MAX(s.season)::int AS season_to,
        SUM(COALESCE(s.appearances, 0))::int AS apps
      FROM player_stats s
      WHERE s.team_name IS NOT NULL
        AND s.team_name <> ''
        AND COALESCE(s.appearances, 0) > 0
      GROUP BY s.player_id, s.team_name
    ),
    resolved AS (
      SELECT
        sc.player_id,
        tm.team_id,
        tm.team_name,
        sc.season_from,
        GREATEST(sc.season_to, sc.season_from) AS season_to,
        sc.apps
      FROM stats_clubs sc
      JOIN team_map tm ON tm.name_key = sc.name_key
      WHERE NOT EXISTS (SELECT 1 FROM nations n WHERE n.name = sc.team_name)
        AND sc.team_name !~* '\\s+U\\d{1,2}(\\s+W)?$'
        AND sc.team_name !~* '\\s+(Olympics?|Olympic)$'
    )
    SELECT
      r.player_id,
      r.team_id,
      r.team_name,
      r.season_from,
      r.season_to,
      r.apps,
      p.name AS player_name
    FROM resolved r
    JOIN players p ON p.id = r.player_id
    WHERE NOT EXISTS (
      SELECT 1 FROM player_career pc
      WHERE pc.player_id = r.player_id
        AND (pc.team_id = r.team_id OR lower(pc.team_name) = lower(r.team_name))
    )
    ORDER BY p.market_value_tier DESC NULLS LAST, r.apps DESC
  `)) as unknown as MissingSpell[];

  return rows;
}

async function main() {
  const missing = await loadMissingSpells();
  console.log(`Missing career spells from stats: ${missing.length}`);

  const byPlayer = new Map<string, number>();
  for (const m of missing) byPlayer.set(m.player_name, (byPlayer.get(m.player_name) ?? 0) + 1);
  const topPlayers = [...byPlayer.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  for (const [name, n] of topPlayers) console.log(`  ${name}: +${n} clubs`);

  for (const name of ['Nicolas Anelka', 'Juan Verón']) {
    const rows = missing.filter((m) => m.player_name === name);
    console.log(
      `  check ${name}: ${rows.length ? rows.map((r) => `${r.team_name}`).join(', ') : 'nothing missing (or unresolved)'}`
    );
  }

  if (dryRun) {
    console.log('Dry run — no writes');
    return;
  }

  let upserted = 0;
  const batchSize = 500;
  for (let i = 0; i < missing.length; i += batchSize) {
    const batch = missing.slice(i, i + batchSize);
    await db
      .insert(playerCareer)
      .values(
        batch.map((m) => ({
          playerId: m.player_id,
          teamId: m.team_id,
          teamName: m.team_name,
          seasonFrom: m.season_from,
          seasonTo: m.season_to,
          updatedAt: new Date(),
        }))
      )
      .onConflictDoUpdate({
        target: [playerCareer.playerId, playerCareer.teamId, playerCareer.seasonFrom],
        set: {
          teamName: sql`excluded.team_name`,
          seasonTo: sql`excluded.season_to`,
          updatedAt: new Date(),
        },
      });
    upserted += batch.length;
    console.log(`Upserted ${upserted}/${missing.length}`);
  }

  const checks = (await db.execute(sql`
    SELECT p.name, COUNT(DISTINCT lower(pc.team_name))::int AS clubs,
           string_agg(DISTINCT pc.team_name, ', ' ORDER BY pc.team_name) AS names
    FROM players p
    JOIN player_career pc ON pc.player_id = p.id
    WHERE p.name IN ('Nicolas Anelka', 'Juan Verón')
      AND pc.team_id > 0
      AND ${clubCareerOnlySql('pc')}
    GROUP BY p.name
    ORDER BY p.name
  `)) as unknown as Array<{ name: string; clubs: number; names: string }>;
  console.log('Spot checks after backfill:');
  for (const c of checks) console.log(`  ${c.name}: ${c.clubs} — ${c.names}`);

  const metric = (await db.execute(sql`
    SELECT p.name, m.value AS clubs
    FROM players p
    JOIN (
      SELECT player_id, COUNT(DISTINCT club_key)::int AS value
      FROM (
        SELECT pc.player_id, lower(pc.team_name) AS club_key
        FROM player_career pc
        WHERE pc.team_id > 0 AND ${clubCareerOnlySql('pc')}
        UNION
        SELECT s.player_id, lower(s.team_name) AS club_key
        FROM player_stats s
        WHERE COALESCE(s.appearances, 0) > 0
          AND s.team_name IS NOT NULL AND s.team_name <> ''
          AND NOT EXISTS (
            SELECT 1 FROM players _nat
            WHERE _nat.nationality <> '' AND _nat.nationality = s.team_name
          )
          AND s.team_name !~* '\\s+U\\d{1,2}(\\s+W)?$'
          AND s.team_name !~* '\\s+(Olympics?|Olympic)$'
      ) clubs
      GROUP BY player_id
    ) m ON m.player_id = p.id
    WHERE p.name IN ('Nicolas Anelka', 'Juan Verón')
  `)) as unknown as Array<{ name: string; clubs: number }>;
  console.log('Draft most_clubs metric:');
  for (const c of metric) console.log(`  ${c.name}: ${c.clubs}`);

  console.log(`Done — ${upserted} career spells backfilled from stats`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
