/**
 * Fix Daniel / Dani Carvajal split identity + polluted club history.
 *
 * Problems:
 *   - Real 2012–13 Leverkusen spell present in player_transfers but historically
 *     missing from player_career (API-Football /players/teams omitted the loan).
 *   - Namesake junk: Dinamo Zagreb career/stats + transfers Zagreb→Leipzig→Barcelona.
 *   - Duplicate shell "Dani Carvajal" (same api_football_id 733) held Spain WC/Euro
 *     stats + final_appearances while the real "Daniel Carvajal" row held club data.
 *     LMS odd-one-out then treated the shell as someone who never played in La Liga.
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
       FROM player_stats WHERE player_id = ${CARVAJAL_ID}::uuid AND appearances > 0) AS stat_clubs,
      (SELECT COUNT(*)::int FROM final_appearances WHERE player_id = ${CARVAJAL_ID}::uuid) AS real_finals,
      (SELECT COUNT(*)::int FROM final_appearances WHERE player_id = ${STUB_ID}::uuid) AS stub_finals,
      (SELECT COUNT(*)::int FROM player_stats WHERE player_id = ${STUB_ID}::uuid) AS stub_stats
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
    SELECT id, name, market_value_tier,
      (SELECT COUNT(*)::int FROM player_career c WHERE c.player_id = p.id) AS career,
      (SELECT COUNT(*)::int FROM player_stats s WHERE s.player_id = p.id) AS stats,
      (SELECT COUNT(*)::int FROM final_appearances f WHERE f.player_id = p.id) AS finals
    FROM players p WHERE id = ${STUB_ID}::uuid
  `)) as unknown as Array<{
    id: string;
    name: string;
    market_value_tier: number;
    career: number;
    stats: number;
    finals: number;
  }>;

  console.log(`\nWill delete ${junkCareer.length} junk career row(s):`, junkCareer);
  console.log(`Will delete ${junkStats[0]?.n ?? 0} junk stats row(s)`);
  console.log(`Will delete ${junkTransfers.length} junk transfer(s):`, junkTransfers);
  console.log(`Leverkusen career present: ${hasLeverkusenCareer[0]?.ok}`);
  console.log(`Stub to merge/demote:`, stub);
  console.log('Will: move stub finals + intl stats → real row, rename to Dani Carvajal, demote stub tier');

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

  if (stub[0]) {
    // Move finals onto the club row (unique key is name-based; keep Dani label).
    await db.execute(sql`
      UPDATE final_appearances
      SET player_id = ${CARVAJAL_ID}::uuid, player_name = 'Dani Carvajal'
      WHERE player_id = ${STUB_ID}::uuid
    `);

    // Move intl / leftover stats that don't collide on (player, league, season, team).
    await db.execute(sql`
      UPDATE player_stats AS s
      SET player_id = ${CARVAJAL_ID}::uuid
      WHERE s.player_id = ${STUB_ID}::uuid
        AND NOT EXISTS (
          SELECT 1 FROM player_stats r
          WHERE r.player_id = ${CARVAJAL_ID}::uuid
            AND r.league_id = s.league_id
            AND r.season = s.season
            AND r.team_id = s.team_id
        )
    `);
    await db.execute(sql`DELETE FROM player_stats WHERE player_id = ${STUB_ID}::uuid`);

    await db.execute(sql`
      UPDATE player_awards
      SET player_id = ${CARVAJAL_ID}::uuid, player_name = 'Dani Carvajal'
      WHERE player_id = ${STUB_ID}::uuid
    `);

    await db.execute(sql`
      UPDATE players
      SET name = 'Dani Carvajal'
      WHERE id = ${CARVAJAL_ID}::uuid
    `);

    // Demote shell so it cannot re-enter famous / LMS pools.
    await db.execute(sql`
      UPDATE players
      SET market_value_tier = 1, api_football_id = NULL
      WHERE id = ${STUB_ID}::uuid
    `);

    await db.execute(sql`
      UPDATE daily_puzzles SET answer_player_id = NULL
      WHERE answer_player_id = ${STUB_ID}::uuid
    `);

    console.log('Merged stub finals/intl into real Dani Carvajal; demoted stub to tier 1');
  }

  const after = await db.execute(sql`
    SELECT p.id, p.name, p.market_value_tier, p.api_football_id,
      (SELECT COUNT(*)::int FROM final_appearances f WHERE f.player_id = p.id) AS finals,
      (SELECT COALESCE(SUM(s.appearances),0)::int FROM player_stats s WHERE s.player_id = p.id AND s.league_id = 140) AS laliga_apps,
      (SELECT COUNT(*)::int FROM player_career c WHERE c.player_id = p.id) AS career
    FROM players p
    WHERE p.id IN (${CARVAJAL_ID}::uuid, ${STUB_ID}::uuid)
    ORDER BY p.market_value_tier DESC
  `);
  console.log('\nAFTER:', JSON.stringify(after, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
