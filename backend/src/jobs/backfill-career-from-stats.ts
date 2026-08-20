/**
 * Backfill missing `player_career` club spells from `player_stats`.
 *
 * API-Football `/players/teams` often omits whole senior spells — short loans (Kane→Millwall /
 * Leicester) and legend gaps (Anelka missing Arsenal/RM/PSG/Liverpool). Stats usually still have
 * those clubs by name — resolve each name to a `teams.id` and insert any (player, club) not
 * already present. Contiguous seasons only, so a later return does not invent the years between.
 *
 *   DATABASE_URL=... npm run job:backfill-career-from-stats
 *   DATABASE_URL=... npm run job:backfill-career-from-stats -- --dry-run
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { playerCareer } from '../db/schema.js';
import { clubCareerOnlySql, youthOrReserveSideSql } from '../utils/nationalTeam.js';
import { statsClubSeasonCte } from '../utils/statsClubEvidence.js';

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
  // Per-season evidence (same resolution as every other stats-club job), then collapse
  // contiguous years so a 2011 loan and a 2018 return stay two spells — a min/max range
  // would invent Club Chain teammates for every year in between.
  const rows = (await db.execute(sql`
    WITH ${statsClubSeasonCte()},
    contiguous AS (
      SELECT
        player_id,
        team_id,
        team_name,
        season,
        apps,
        season - ROW_NUMBER() OVER (PARTITION BY player_id, team_id ORDER BY season) AS grp
      FROM stats_club_season
      WHERE NOT ${youthOrReserveSideSql(sql`team_name`)}
    )
    SELECT
      c.player_id,
      c.team_id,
      c.team_name,
      MIN(c.season)::int AS season_from,
      MAX(c.season)::int AS season_to,
      SUM(c.apps)::int AS apps,
      p.name AS player_name
    FROM contiguous c
    JOIN players p ON p.id = c.player_id
    WHERE NOT EXISTS (
      SELECT 1 FROM player_career pc
      WHERE pc.player_id = c.player_id
        AND (pc.team_id = c.team_id OR lower(pc.team_name) = lower(c.team_name))
    )
    GROUP BY c.player_id, c.team_id, c.team_name, c.grp, p.name, p.market_value_tier
    ORDER BY p.market_value_tier DESC NULLS LAST, SUM(c.apps) DESC
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

  for (const name of ['Harry Kane', 'Nicolas Anelka', 'Juan Verón', 'Andy Robertson', 'Morgan Rogers']) {
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
    WHERE p.name IN ('Harry Kane', 'Nicolas Anelka', 'Juan Verón', 'Morgan Rogers')
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
    WHERE p.name IN ('Harry Kane', 'Nicolas Anelka', 'Juan Verón', 'Morgan Rogers')
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
