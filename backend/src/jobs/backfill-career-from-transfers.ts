/**
 * Backfill missing `player_career` club spells from `player_transfers`.
 *
 * API-Football `/players/teams` often omits loan / short spells (Lukaku→Roma,
 * Vermaelen→Waalwijk, Kane→Norwich, …). Transfers already have those destinations —
 * this job inserts any (player, club) that appears as a transfer destination but is
 * absent from player_career, excluding national / youth-national sides.
 *
 *   DATABASE_URL=... npx tsx src/jobs/backfill-career-from-transfers.ts
 *   DATABASE_URL=... npx tsx src/jobs/backfill-career-from-transfers.ts --dry-run
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { playerCareer } from '../db/schema.js';
import { clubCareerOnlySql } from '../utils/nationalTeam.js';

const dryRun = process.argv.includes('--dry-run');

/** Transfers dated before this are feed placeholders, not history — see the query below. */
const MIN_PLAUSIBLE_TRANSFER_DATE = '1970-01-01';

type MissingSpell = {
  player_id: string;
  team_id: number;
  team_name: string;
  season_from: number;
  season_to: number;
};

async function loadMissingSpells(): Promise<MissingSpell[]> {
  // One spell per (player, destination club): first join year → leave year (or join year).
  const rows = (await db.execute(sql`
    WITH dest AS (
      SELECT
        t.player_id,
        t.to_team_id AS team_id,
        t.to_team_name AS team_name,
        t.transfer_date AS join_date,
        (
          SELECT MIN(x.transfer_date)
          FROM player_transfers x
          WHERE x.player_id = t.player_id
            AND x.from_team_id = t.to_team_id
            AND x.transfer_date IS NOT NULL
            AND t.transfer_date IS NOT NULL
            AND x.transfer_date > t.transfer_date
        ) AS leave_date
      FROM player_transfers t
      WHERE t.to_team_id > 0
        AND t.to_team_name IS NOT NULL
        AND t.to_team_name <> ''
        AND t.transfer_date IS NOT NULL
        -- The feed uses 1926-01-01 as a "date unknown" placeholder on otherwise modern moves
        -- (Charlotte -> Standard Liège, Mazatlán -> Tigres). Taken literally it produced club
        -- spells running 1926 to today, which in Club Chain makes a player a team-mate of
        -- everyone who ever wore the shirt.
        AND t.transfer_date >= ${MIN_PLAUSIBLE_TRANSFER_DATE}
    ),
    first_join AS (
      SELECT DISTINCT ON (player_id, team_id)
        player_id,
        team_id,
        team_name,
        join_date,
        leave_date
      FROM dest
      ORDER BY player_id, team_id, join_date ASC
    )
    SELECT
      fj.player_id,
      fj.team_id,
      fj.team_name,
      EXTRACT(YEAR FROM fj.join_date)::int AS season_from,
      COALESCE(
        EXTRACT(YEAR FROM fj.leave_date)::int,
        EXTRACT(YEAR FROM fj.join_date)::int
      ) AS season_to
    FROM first_join fj
    WHERE NOT EXISTS (
      SELECT 1 FROM player_career pc
      WHERE pc.player_id = fj.player_id AND pc.team_id = fj.team_id
    )
      AND ${clubCareerOnlySql('fj')}
  `)) as unknown as MissingSpell[];

  return rows.map((r) => ({
    ...r,
    season_to: Math.max(r.season_to, r.season_from),
  }));
}

async function main() {
  const missing = await loadMissingSpells();
  console.log(`Missing career spells from transfers: ${missing.length}`);

  const sample = missing.slice(0, 15);
  for (const m of sample) {
    console.log(
      `  ${m.player_id.slice(0, 8)}… → ${m.team_name} (${m.season_from}–${m.season_to})`
    );
  }
  if (missing.length > sample.length) console.log(`  … +${missing.length - sample.length} more`);

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

  // Spot-check Lukaku / Vermaelen
  const checks = (await db.execute(sql`
    SELECT p.name, pc.team_name, pc.season_from, pc.season_to
    FROM player_career pc
    JOIN players p ON p.id = pc.player_id
    WHERE p.name IN ('Romelu Lukaku', 'Thomas Vermaelen')
      AND pc.team_name IN ('AS Roma', 'Waalwijk', 'Roma')
    ORDER BY p.name, pc.season_from
  `)) as unknown as Array<{ name: string; team_name: string; season_from: number; season_to: number }>;
  console.log('Spot checks:', checks);

  console.log(`Done — ${upserted} career spells backfilled from transfers`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
