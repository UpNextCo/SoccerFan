/**
 * Wipe duplicate Dani Carvajal shell and keep the Real Madrid row as the only identity.
 *
 * Real:  579bd71e-fb93-40a9-b4aa-0cadf44aaa00  (club stats, API/TM ids)
 * Stub:  b37a24c9-edc5-4c8f-9419-b2d449a48a73  (WC squad links, intl extra_stats, 0 clubs)
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

async function countRefs(id: string) {
  const rows = (await db.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM player_stats WHERE player_id = ${id}::uuid) AS stats,
      (SELECT COUNT(*)::int FROM player_career WHERE player_id = ${id}::uuid) AS career,
      (SELECT COUNT(*)::int FROM player_transfers WHERE player_id = ${id}::uuid) AS transfers,
      (SELECT COUNT(*)::int FROM final_appearances WHERE player_id = ${id}::uuid) AS finals,
      (SELECT COUNT(*)::int FROM player_awards WHERE player_id = ${id}::uuid) AS awards,
      (SELECT COUNT(*)::int FROM player_extra_stats WHERE player_id = ${id}::uuid) AS extra,
      (SELECT COUNT(*)::int FROM wc_squads WHERE player_id = ${id}::uuid) AS wc_squads,
      (SELECT COUNT(*)::int FROM wc_match_events
        WHERE player_id = ${id}::uuid OR assist_player_id = ${id}::uuid) AS wc_events,
      (SELECT COUNT(*)::int FROM daily_puzzles WHERE answer_player_id = ${id}::uuid) AS daily_answers,
      (SELECT COUNT(*)::int FROM daily_puzzles
        WHERE puzzle_json::text LIKE ${'%' + id + '%'}
           OR answer_json::text LIKE ${'%' + id + '%'}) AS puzzle_json_refs
  `)) as unknown as Array<Record<string, number>>;
  return rows[0]!;
}

async function main() {
  const real = (await db.execute(sql`
    SELECT id, name, current_club, api_football_id, tm_player_id, market_value_tier
    FROM players WHERE id = ${CARVAJAL_ID}::uuid
  `)) as unknown as Array<Record<string, unknown>>;
  const stub = (await db.execute(sql`
    SELECT id, name, current_club, api_football_id, tm_player_id, market_value_tier
    FROM players WHERE id = ${STUB_ID}::uuid
  `)) as unknown as Array<Record<string, unknown>>;

  if (!real[0]) throw new Error('Real Dani Carvajal row missing');
  console.log('REAL:', real[0]);
  console.log('STUB:', stub[0] ?? '(already gone)');
  console.log('REAL refs:', await countRefs(CARVAJAL_ID));
  if (stub[0]) console.log('STUB refs:', await countRefs(STUB_ID));

  const junkCareer = (await db.execute(sql`
    SELECT id, team_name, season_from, season_to FROM player_career
    WHERE player_id = ${CARVAJAL_ID}::uuid
      AND (lower(team_name) LIKE '%zagreb%' OR team_id IN (620, 173, 529))
  `)) as unknown as Array<{ id: string; team_name: string }>;

  const hasLeverkusenCareer = (await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM player_career
      WHERE player_id = ${CARVAJAL_ID}::uuid AND team_id = ${LEVERKUSEN_TEAM_ID}
    ) AS ok
  `)) as unknown as Array<{ ok: boolean }>;

  const stubExtra = stub[0]
    ? ((await db.execute(sql`
        SELECT intl_caps, tm_intl_caps, intl_goals, tm_intl_goals, tm_career_goals, tm_career_apps
        FROM player_extra_stats WHERE player_id = ${STUB_ID}::uuid
      `)) as unknown as Array<Record<string, number | null>>)
    : [];

  console.log(`\nJunk Zagreb career rows on real: ${junkCareer.length}`);
  console.log(`Leverkusen career present: ${hasLeverkusenCareer[0]?.ok}`);
  console.log('Stub extra_stats:', stubExtra[0] ?? null);
  console.log(
    '\nPlan: move stub refs → real, rewrite puzzle JSON ids, clean junk, ensure Leverkusen, DELETE stub'
  );

  if (!APPLY) {
    console.log('\nDry run — pass --apply to write');
    return;
  }

  // --- clean polluted clubs on the real row ---
  if (junkCareer.length > 0) {
    await db.execute(sql`
      DELETE FROM player_career
      WHERE player_id = ${CARVAJAL_ID}::uuid
        AND (lower(team_name) LIKE '%zagreb%' OR team_id IN (620, 173, 529))
    `);
  }
  await db.execute(sql`
    DELETE FROM player_stats
    WHERE player_id = ${CARVAJAL_ID}::uuid
      AND (
        lower(COALESCE(team_name, '')) LIKE '%zagreb%'
        OR team_id IN (620, 173, 529)
      )
  `);
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
    // Finals / awards
    await db.execute(sql`
      UPDATE final_appearances
      SET player_id = ${CARVAJAL_ID}::uuid, player_name = 'Dani Carvajal'
      WHERE player_id = ${STUB_ID}::uuid
        AND NOT EXISTS (
          SELECT 1 FROM final_appearances r
          WHERE r.player_id = ${CARVAJAL_ID}::uuid
            AND r.competition = final_appearances.competition
            AND r.season = final_appearances.season
        )
    `);
    await db.execute(sql`DELETE FROM final_appearances WHERE player_id = ${STUB_ID}::uuid`);

    await db.execute(sql`
      UPDATE player_awards
      SET player_id = ${CARVAJAL_ID}::uuid, player_name = 'Dani Carvajal'
      WHERE player_id = ${STUB_ID}::uuid
    `);

    // Club / intl stats that don't collide
    await db.execute(sql`
      UPDATE player_stats AS s
      SET player_id = ${CARVAJAL_ID}::uuid
      WHERE s.player_id = ${STUB_ID}::uuid
        AND NOT EXISTS (
          SELECT 1 FROM player_stats r
          WHERE r.player_id = ${CARVAJAL_ID}::uuid
            AND r.league_id = s.league_id
            AND r.season = s.season
            AND COALESCE(r.team_id, -1) = COALESCE(s.team_id, -1)
        )
    `);
    await db.execute(sql`DELETE FROM player_stats WHERE player_id = ${STUB_ID}::uuid`);

    await db.execute(sql`
      UPDATE player_career SET player_id = ${CARVAJAL_ID}::uuid
      WHERE player_id = ${STUB_ID}::uuid
        AND NOT EXISTS (
          SELECT 1 FROM player_career r
          WHERE r.player_id = ${CARVAJAL_ID}::uuid
            AND COALESCE(r.team_id, -1) = COALESCE(player_career.team_id, -1)
            AND r.season_from = player_career.season_from
        )
    `);
    await db.execute(sql`DELETE FROM player_career WHERE player_id = ${STUB_ID}::uuid`);

    await db.execute(sql`
      UPDATE player_transfers SET player_id = ${CARVAJAL_ID}::uuid
      WHERE player_id = ${STUB_ID}::uuid
    `);

    // WC / events
    await db.execute(sql`
      UPDATE wc_squads SET player_id = ${CARVAJAL_ID}::uuid
      WHERE player_id = ${STUB_ID}::uuid
        AND NOT EXISTS (
          SELECT 1 FROM wc_squads r
          WHERE r.player_id = ${CARVAJAL_ID}::uuid
            AND r.year = wc_squads.year
            AND r.country = wc_squads.country
        )
    `);
    await db.execute(sql`UPDATE wc_squads SET player_id = NULL WHERE player_id = ${STUB_ID}::uuid`);

    await db.execute(sql`
      UPDATE wc_match_events SET player_id = ${CARVAJAL_ID}::uuid
      WHERE player_id = ${STUB_ID}::uuid
    `);
    await db.execute(sql`
      UPDATE wc_match_events SET assist_player_id = ${CARVAJAL_ID}::uuid
      WHERE assist_player_id = ${STUB_ID}::uuid
    `);

    // Merge intl / TM extra_stats onto real (prefer non-null from either side)
    const realExtra = (await db.execute(sql`
      SELECT player_id FROM player_extra_stats WHERE player_id = ${CARVAJAL_ID}::uuid
    `)) as unknown as Array<{ player_id: string }>;

    if (stubExtra[0]) {
      if (!realExtra[0]) {
        await db.execute(sql`
          UPDATE player_extra_stats SET player_id = ${CARVAJAL_ID}::uuid
          WHERE player_id = ${STUB_ID}::uuid
        `);
      } else {
        await db.execute(sql`
          UPDATE player_extra_stats AS real
          SET
            intl_caps = COALESCE(real.intl_caps, stub.intl_caps),
            tm_intl_caps = COALESCE(real.tm_intl_caps, stub.tm_intl_caps),
            intl_goals = COALESCE(real.intl_goals, stub.intl_goals),
            tm_intl_goals = COALESCE(real.tm_intl_goals, stub.tm_intl_goals),
            tm_career_goals = COALESCE(real.tm_career_goals, stub.tm_career_goals),
            tm_career_apps = COALESCE(real.tm_career_apps, stub.tm_career_apps)
          FROM player_extra_stats AS stub
          WHERE real.player_id = ${CARVAJAL_ID}::uuid
            AND stub.player_id = ${STUB_ID}::uuid
        `);
        await db.execute(sql`DELETE FROM player_extra_stats WHERE player_id = ${STUB_ID}::uuid`);
      }
    }

    // Rewrite puzzle / answer JSON that still embeds the stub UUID
    await db.execute(sql`
      UPDATE daily_puzzles
      SET
        puzzle_json = replace(puzzle_json::text, ${STUB_ID}, ${CARVAJAL_ID})::jsonb,
        answer_json = CASE
          WHEN answer_json IS NULL THEN NULL
          ELSE replace(answer_json::text, ${STUB_ID}, ${CARVAJAL_ID})::jsonb
        END,
        answer_player_id = CASE
          WHEN answer_player_id = ${STUB_ID}::uuid THEN ${CARVAJAL_ID}::uuid
          ELSE answer_player_id
        END
      WHERE puzzle_json::text LIKE ${'%' + STUB_ID + '%'}
         OR answer_json::text LIKE ${'%' + STUB_ID + '%'}
         OR answer_player_id = ${STUB_ID}::uuid
    `);

    // Canonical name / search on real
    await db.execute(sql`
      UPDATE players
      SET
        name = 'Dani Carvajal',
        aliases = '["Daniel Carvajal","Dani Carvajal","Carvajal"]'::jsonb,
        search_text = lower('Dani Carvajal Daniel Carvajal Carvajal Real Madrid Spain Defender'),
        current_club = 'Real Madrid',
        current_league = 'La Liga'
      WHERE id = ${CARVAJAL_ID}::uuid
    `);

    // Wipe stub (cascades dependent FKs; nulls set-null WC leftovers)
    await db.execute(sql`DELETE FROM players WHERE id = ${STUB_ID}::uuid`);
    console.log('Deleted stub player', STUB_ID);
  }

  const afterPlayers = await db.execute(sql`
    SELECT id, name, current_club, current_league, api_football_id, tm_player_id, market_value_tier
    FROM players
    WHERE id = ${CARVAJAL_ID}::uuid
       OR name ILIKE ${'%carvajal%'}
    ORDER BY name, id
  `);
  console.log('\nPlayers after:', afterPlayers);
  console.log('REAL refs after:', await countRefs(CARVAJAL_ID));

  const health = await db.execute(sql`
    SELECT
      (SELECT COALESCE(SUM(appearances),0)::int FROM player_stats
        WHERE player_id = ${CARVAJAL_ID}::uuid AND league_id = 140) AS liga_apps,
      (SELECT COALESCE(SUM(appearances),0)::int FROM player_stats
        WHERE player_id = ${CARVAJAL_ID}::uuid AND league_id = 2) AS cl_apps,
      (SELECT COALESCE(SUM(appearances),0)::int FROM player_stats
        WHERE player_id = ${CARVAJAL_ID}::uuid) AS total_apps,
      (SELECT COUNT(*)::int FROM final_appearances WHERE player_id = ${CARVAJAL_ID}::uuid) AS finals,
      (SELECT COUNT(*)::int FROM wc_squads WHERE player_id = ${CARVAJAL_ID}::uuid) AS wc_squads,
      (SELECT intl_caps FROM player_extra_stats WHERE player_id = ${CARVAJAL_ID}::uuid) AS intl_caps,
      (SELECT tm_intl_caps FROM player_extra_stats WHERE player_id = ${CARVAJAL_ID}::uuid) AS tm_intl_caps,
      (SELECT json_agg(json_build_object('team', team_name, 'from', season_from, 'to', season_to) ORDER BY season_from)
        FROM player_career WHERE player_id = ${CARVAJAL_ID}::uuid) AS career
  `);
  console.log('Health:', JSON.stringify(health, null, 2));

  const sat = await db.execute(sql`
    SELECT date, puzzle_json->'rounds'->4 AS round4
    FROM daily_puzzles
    WHERE mode_id = 'one_more' AND date = '2026-08-15'
  `);
  console.log('Sat one_more round4 after rewrite:', JSON.stringify(sat, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
