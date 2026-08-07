/**
 * Fix Daniel Carvajal's polluted / incomplete club history.
 *
 * Problems found 2026-08-07 (Draft XI Bayer Leverkusen chip):
 *   - Real 2012–13 Leverkusen spell present in player_transfers but missing from
 *     player_career + player_stats (API-Football /players/teams omitted the loan).
 *   - Namesake junk: Dinamo Zagreb career/stats + transfers Zagreb→Leipzig→Barcelona.
 *   - Duplicate shell "Dani Carvajal" shares api_football_id 733 (kept — it holds
 *     Spain WC/Euro intl rows; not safe to delete blindly).
 *
 *   npx tsx src/jobs/fix-carvajal-leverkusen.ts
 *   npx tsx src/jobs/fix-carvajal-leverkusen.ts --apply
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { playerCareer } from '../db/schema.js';

const APPLY = process.argv.includes('--apply');
const CARVAJAL_ID = '579bd71e-fb93-40a9-b4aa-0cadf44aaa00';
const STUB_ID = 'b37a24c9-edc5-4c8f-9419-b2d449a48a73';
const LEVERKUSEN_TEAM_ID = 168;

async function main() {
  const before = await db.execute(sql`
    SELECT
      (SELECT json_agg(json_build_object('team', team_name, 'from', season_from, 'to', season_to) ORDER BY season_from)
       FROM player_career WHERE player_id = ${CARVAJAL_ID}::uuid) AS career,
      (SELECT json_agg(json_build_object('date', transfer_date, 'from', from_team_name, 'to', to_team_name, 'type', transfer_type) ORDER BY transfer_date)
       FROM player_transfers WHERE player_id = ${CARVAJAL_ID}::uuid) AS transfers,
      (SELECT json_agg(DISTINCT team_name)
       FROM player_stats WHERE player_id = ${CARVAJAL_ID}::uuid AND appearances > 0) AS stat_clubs
  `);
  console.log('BEFORE:', JSON.stringify(before, null, 2));

  const junkCareer = (await db.execute(sql`
    SELECT id, team_name, season_from, season_to FROM player_career
    WHERE player_id = ${CARVAJAL_ID}::uuid
      AND (lower(team_name) LIKE '%zagreb%' OR team_id IN (620, 173, 529))
  `)) as unknown as Array<{ id: string; team_name: string; season_from: number; season_to: number }>;

  const junkStats = (await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM player_stats
    WHERE player_id = ${CARVAJAL_ID}::uuid
      AND (
        lower(COALESCE(team_name, '')) LIKE '%zagreb%'
        OR team_id IN (620, 173, 529)
      )
  `)) as unknown as Array<{ n: number }>;

  const junkTransfers = (await db.execute(sql`
    SELECT id, transfer_date, from_team_name, to_team_name FROM player_transfers
    WHERE player_id = ${CARVAJAL_ID}::uuid
      AND (
        lower(COALESCE(from_team_name, '')) LIKE '%zagreb%'
        OR lower(COALESCE(to_team_name, '')) LIKE '%zagreb%'
        OR to_team_id IN (173, 529)
        OR from_team_id IN (620, 173)
      )
  `)) as unknown as Array<{
    id: string;
    transfer_date: string;
    from_team_name: string;
    to_team_name: string;
  }>;

  const hasLeverkusenCareer = (await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM player_career
      WHERE player_id = ${CARVAJAL_ID}::uuid AND team_id = ${LEVERKUSEN_TEAM_ID}
    ) AS ok
  `)) as unknown as Array<{ ok: boolean }>;

  const stub = (await db.execute(sql`
    SELECT id, name,
      (SELECT COUNT(*)::int FROM player_career c WHERE c.player_id = p.id) AS career,
      (SELECT COUNT(*)::int FROM player_stats s WHERE s.player_id = p.id) AS stats
    FROM players p WHERE id = ${STUB_ID}::uuid
  `)) as unknown as Array<{ id: string; name: string; career: number; stats: number }>;

  console.log(`\nWill delete ${junkCareer.length} junk career row(s):`, junkCareer);
  console.log(`Will delete ${junkStats[0]?.n ?? 0} junk stats row(s)`);
  console.log(`Will delete ${junkTransfers.length} junk transfer(s):`, junkTransfers);
  console.log(`Leverkusen career present: ${hasLeverkusenCareer[0]?.ok}`);
  console.log(`Empty stub:`, stub);

  if (!APPLY) {
    console.log('\nDry run — pass --apply to write');
    return;
  }

  if (junkCareer.length > 0) {
    await db.execute(sql`
      DELETE FROM player_career
      WHERE player_id = ${CARVAJAL_ID}::uuid
        AND (lower(team_name) LIKE '%zagreb%' OR team_id IN (620, 173, 529))
    `);
  }

  if ((junkStats[0]?.n ?? 0) > 0) {
    await db.execute(sql`
      DELETE FROM player_stats
      WHERE player_id = ${CARVAJAL_ID}::uuid
        AND (
          lower(COALESCE(team_name, '')) LIKE '%zagreb%'
          OR team_id IN (620, 173, 529)
        )
    `);
  }

  if (junkTransfers.length > 0) {
    await db.execute(sql`
      DELETE FROM player_transfers
      WHERE player_id = ${CARVAJAL_ID}::uuid
        AND (
          lower(COALESCE(from_team_name, '')) LIKE '%zagreb%'
          OR lower(COALESCE(to_team_name, '')) LIKE '%zagreb%'
          OR to_team_id IN (173, 529)
          OR from_team_id IN (620, 173)
        )
    `);
  }

  if (!hasLeverkusenCareer[0]?.ok) {
    await db.insert(playerCareer).values({
      playerId: CARVAJAL_ID,
      teamId: LEVERKUSEN_TEAM_ID,
      teamName: 'Bayer Leverkusen',
      seasonFrom: 2012,
      seasonTo: 2013,
      updatedAt: new Date(),
    });
    console.log('Inserted Bayer Leverkusen career 2012–2013');
  }

  // Safe stub delete: empty shell, same api id as the real row, no career/stats.
  if (stub[0] && stub[0].career === 0 && stub[0].stats === 0) {
    await db.execute(sql`UPDATE daily_puzzles SET answer_player_id = NULL WHERE answer_player_id = ${STUB_ID}`);
    await db.execute(sql`DELETE FROM players WHERE id = ${STUB_ID}::uuid`);
    console.log(`Deleted empty stub ${stub[0].name}`);
  }

  const eligibility = await db.execute(sql`
    SELECT
      EXISTS (
        SELECT 1 FROM player_stats m
        WHERE m.player_id = ${CARVAJAL_ID}::uuid
          AND m.team_name = 'Bayer Leverkusen' AND m.appearances > 0
      ) AS stats_ok,
      EXISTS (
        SELECT 1 FROM player_career c
        WHERE c.player_id = ${CARVAJAL_ID}::uuid
          AND c.team_name = 'Bayer Leverkusen' AND c.team_id > 0
      ) AS career_ok,
      (
        SELECT json_agg(json_build_object('team', team_name, 'from', season_from, 'to', season_to) ORDER BY season_from)
        FROM player_career WHERE player_id = ${CARVAJAL_ID}::uuid
      ) AS career,
      (
        SELECT json_agg(json_build_object('date', transfer_date, 'from', from_team_name, 'to', to_team_name) ORDER BY transfer_date)
        FROM player_transfers WHERE player_id = ${CARVAJAL_ID}::uuid
      ) AS transfers
  `);
  console.log('\nAFTER / Draft eligibility:', JSON.stringify(eligibility, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
