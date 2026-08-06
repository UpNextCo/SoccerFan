/**
 * Clean name-collision pollution that inflates "most clubs played for" (and Club Chain).
 *
 * What we do (prefer keeping the known player, drop junk — per product preference):
 *   1. Delete thin unknown stub rows that share a name with a real/api-backed player.
 *   2. On high-club / same-season-collision players: drop player_career clubs with no
 *      supporting player_stats appearances (name-matched junk from other namesakes).
 *   3. In big-5 seasons with 3+ distinct clubs for one player_id, keep the top 2 by apps
 *      and delete the rest (impossible for one person; mid-season transfer maxes at 2).
 *   4. Delete garbage career seasons (season_from < 1950).
 *
 * Do NOT run graph/"component" club trims here — that deleted real clubs from
 * legitimate careers (Gervinho/Parma, Willian/Fulham, …). Prefer TM name+DOB.
 *
 * Dry-run by default. Apply with --apply.
 *
 *   npm run job:cleanup-merged-careers
 *   npm run job:cleanup-merged-careers -- --apply
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

const APPLY = process.argv.includes('--apply');

async function countClubs(playerId: string): Promise<number> {
  const rows = (await db.execute(sql`
    SELECT COUNT(DISTINCT lower(team_name))::int AS n FROM (
      SELECT team_name FROM player_career
      WHERE player_id = ${playerId}::uuid AND team_id > 0
        AND team_name !~* '\\mU\\d{1,2}'
        AND team_name !~* '\\s+(II|B)$'
      UNION
      SELECT team_name FROM player_stats
      WHERE player_id = ${playerId}::uuid AND appearances > 0 AND team_name IS NOT NULL
        AND team_name !~* '\\mU\\d{1,2}'
        AND team_name !~* '\\s+(II|B)$'
        AND league_id NOT IN (1, 4)
    ) u
  `)) as unknown as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

/** Thin stubs sharing a name with a better-identified player — safe to delete entirely. */
async function deleteUnknownStubs(): Promise<number> {
  const stubs = (await db.execute(sql`
    SELECT p.id, p.name, p.nationality, p.market_value_tier AS mvt,
           (SELECT COUNT(*)::int FROM player_stats s WHERE s.player_id = p.id) AS stats,
           (SELECT COUNT(*)::int FROM player_career c WHERE c.player_id = p.id) AS career
    FROM players p
    WHERE p.api_football_id IS NULL
      AND p.birth_date IS NULL
      AND (
        COALESCE(p.nationality, 'Unknown') IN ('Unknown', '')
        OR p.market_value_tier <= 2
      )
      AND (SELECT COUNT(*) FROM player_stats s WHERE s.player_id = p.id) <= 4
      AND EXISTS (
        SELECT 1 FROM players f
        WHERE lower(f.name) = lower(p.name)
          AND f.id <> p.id
          AND (
            f.api_football_id IS NOT NULL
            OR (f.birth_date IS NOT NULL AND f.market_value_tier >= 3)
          )
      )
    ORDER BY p.name
  `)) as unknown as Array<{
    id: string;
    name: string;
    nationality: string;
    mvt: number;
    stats: number;
    career: number;
  }>;

  console.log(`\n[1] Unknown/thin stubs sharing a known name: ${stubs.length}`);
  for (const s of stubs.slice(0, 20)) {
    console.log(`  ${s.name.padEnd(28)} mvt${s.mvt} ${s.nationality ?? '?'} stats=${s.stats} career=${s.career}`);
  }
  if (stubs.length > 20) console.log(`  … +${stubs.length - 20} more`);

  if (!APPLY || stubs.length === 0) return stubs.length;

  for (const s of stubs) {
    await db.execute(sql`UPDATE daily_puzzles SET answer_player_id = NULL WHERE answer_player_id = ${s.id}`);
    await db.execute(sql`
      UPDATE tower_prompts
      SET rule = jsonb_set(
        rule, '{validIds}',
        (SELECT COALESCE(to_jsonb(array_agg(v)), '[]'::jsonb)
         FROM jsonb_array_elements_text(rule->'validIds') AS v
         WHERE v <> ${s.id})
      )
      WHERE rule ? 'validIds' AND rule->'validIds' @> ${JSON.stringify([s.id])}::jsonb
    `);
    await db.execute(sql`DELETE FROM players WHERE id = ${s.id}::uuid`);
  }
  return stubs.length;
}

/**
 * Players with strong merge smell only — not every journeyman with 12+ real clubs.
 *  • ≥3 clubs in one league-season (impossible), or
 *  • ≥4 big-5 clubs across leagues in one season, or
 *  • mononym / very short name with ≥12 senior clubs
 */
async function pollutedPlayerIds(): Promise<string[]> {
  const rows = (await db.execute(sql`
    WITH club_n AS (
      SELECT player_id, COUNT(DISTINCT lower(team_name))::int AS n FROM (
        SELECT player_id, team_name FROM player_career WHERE team_id > 0
        UNION
        SELECT player_id, team_name FROM player_stats
        WHERE appearances > 0 AND team_name IS NOT NULL AND league_id NOT IN (1, 4)
      ) u GROUP BY player_id
    ),
    same_league_collision AS (
      SELECT DISTINCT player_id
      FROM player_stats
      WHERE appearances > 0 AND league_id IN (39, 140, 135, 78, 61)
      GROUP BY player_id, league_id, season
      HAVING COUNT(DISTINCT team_name) >= 3
    ),
    cross_league_collision AS (
      SELECT DISTINCT player_id
      FROM player_stats
      WHERE appearances > 0 AND league_id IN (39, 140, 135, 78, 61)
      GROUP BY player_id, season
      HAVING COUNT(DISTINCT team_name) >= 4
    )
    SELECT DISTINCT p.id
    FROM players p
    LEFT JOIN club_n c ON c.player_id = p.id
    WHERE p.id IN (SELECT player_id FROM same_league_collision)
       OR p.id IN (SELECT player_id FROM cross_league_collision)
       OR (
         COALESCE(c.n, 0) >= 12
         AND (position(' ' in p.name) = 0 OR length(p.name) <= 6)
       )
  `)) as unknown as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

/**
 * Drop career clubs with zero supporting stats apps (fuzzy name match).
 * Keeps the known player's tracked-league path; drops namesake career API junk.
 */
async function stripUnbackedCareer(playerIds: string[]): Promise<number> {
  if (playerIds.length === 0) return 0;
  const before = (await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM player_career
    WHERE player_id IN (${sql.join(playerIds.map((id) => sql`${id}::uuid`), sql`, `)})
      AND team_id > 0
      AND NOT EXISTS (
        SELECT 1 FROM player_stats s
        WHERE s.player_id = player_career.player_id
          AND COALESCE(s.appearances, 0) > 0
          AND s.team_name IS NOT NULL
          AND (
            lower(s.team_name) = lower(player_career.team_name)
            OR lower(s.team_name) LIKE '%' || lower(player_career.team_name) || '%'
            OR lower(player_career.team_name) LIKE '%' || lower(s.team_name) || '%'
          )
      )
  `)) as unknown as Array<{ n: number }>;
  const n = before[0]?.n ?? 0;
  console.log(`\n[2] Unbacked career rows to delete: ${n}`);

  if (!APPLY || n === 0) return n;

  await db.execute(sql`
    DELETE FROM player_career
    WHERE player_id IN (${sql.join(playerIds.map((id) => sql`${id}::uuid`), sql`, `)})
      AND team_id > 0
      AND NOT EXISTS (
        SELECT 1 FROM player_stats s
        WHERE s.player_id = player_career.player_id
          AND COALESCE(s.appearances, 0) > 0
          AND s.team_name IS NOT NULL
          AND (
            lower(s.team_name) = lower(player_career.team_name)
            OR lower(s.team_name) LIKE '%' || lower(player_career.team_name) || '%'
            OR lower(player_career.team_name) LIKE '%' || lower(s.team_name) || '%'
          )
      )
  `);
  return n;
}

/**
 * Impossible same-league multi-club seasons (≥3 clubs in one league-season), and
 * extreme cross-league stacks (≥4 big-5 clubs in one season). Keep the top rows by apps.
 */
async function stripSameSeasonCollisions(): Promise<number> {
  const doomed = (await db.execute(sql`
    WITH same_league AS (
      SELECT id, player_id, season, league_id, team_name, appearances,
             ROW_NUMBER() OVER (
               PARTITION BY player_id, league_id, season
               ORDER BY appearances DESC, goals DESC, team_name
             ) AS rn
      FROM player_stats
      WHERE appearances > 0 AND league_id IN (39, 140, 135, 78, 61)
        AND (player_id, league_id, season) IN (
          SELECT player_id, league_id, season FROM player_stats
          WHERE appearances > 0 AND league_id IN (39, 140, 135, 78, 61)
          GROUP BY player_id, league_id, season
          HAVING COUNT(DISTINCT team_name) >= 3
        )
    ),
    cross_league AS (
      SELECT id, player_id, season, league_id, team_name, appearances,
             ROW_NUMBER() OVER (
               PARTITION BY player_id, season
               ORDER BY appearances DESC, goals DESC, team_name
             ) AS rn
      FROM player_stats
      WHERE appearances > 0 AND league_id IN (39, 140, 135, 78, 61)
        AND (player_id, season) IN (
          SELECT player_id, season FROM player_stats
          WHERE appearances > 0 AND league_id IN (39, 140, 135, 78, 61)
          GROUP BY player_id, season
          HAVING COUNT(DISTINCT team_name) >= 4
        )
    )
    SELECT id, player_id, season, team_name, appearances FROM same_league WHERE rn > 2
    UNION
    SELECT id, player_id, season, team_name, appearances FROM cross_league WHERE rn > 2
  `)) as unknown as Array<{
    id: string;
    player_id: string;
    season: number;
    team_name: string;
    appearances: number;
  }>;

  console.log(`\n[3] Impossible same-season stats rows to delete: ${doomed.length}`);
  for (const r of doomed.slice(0, 15)) {
    console.log(`  ${r.player_id.slice(0, 8)}… ${r.season} ${r.team_name}(${r.appearances})`);
  }

  if (!APPLY || doomed.length === 0) return doomed.length;

  const ids = [...new Set(doomed.map((r) => r.id))];
  const chunk = 200;
  for (let i = 0; i < ids.length; i += chunk) {
    const slice = ids.slice(i, i + chunk);
    await db.execute(sql`
      DELETE FROM player_stats
      WHERE id IN (${sql.join(slice.map((id) => sql`${id}::uuid`), sql`, `)})
    `);
  }
  return doomed.length;
}

async function stripGarbageSeasons(): Promise<number> {
  const rows = (await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM player_career
    WHERE team_id > 0 AND (season_from < 1950 OR season_from > 2030)
  `)) as unknown as Array<{ n: number }>;
  const n = rows[0]?.n ?? 0;
  console.log(`\n[4] Garbage career seasons (<1950 or >2030): ${n}`);
  if (!APPLY || n === 0) return n;
  await db.execute(sql`
    DELETE FROM player_career
    WHERE team_id > 0 AND (season_from < 1950 OR season_from > 2030)
  `);
  return n;
}

async function main() {
  console.log(APPLY ? 'APPLY mode — writing changes' : 'DRY RUN — pass --apply to write');

  const stubs = await deleteUnknownStubs();
  const polluted = await pollutedPlayerIds();
  console.log(`\nPolluted / high-club player ids: ${polluted.length}`);

  const unbacked = await stripUnbackedCareer(polluted);
  const collisions = await stripSameSeasonCollisions();
  const garbage = await stripGarbageSeasons();

  // Before/after samples for known offenders.
  const samples = [
    { name: 'Nenê', id: '2a3202f2-80f3-48e5-81bf-f12734a6d420' },
    { name: 'Emerson', id: 'fe2c9446-5d7c-4ecf-a485-9222bd845980' },
    { name: 'Adriano', id: '2de6f2f4-0ce7-463a-b000-519672153c72' },
    { name: 'Álvaro Morata', id: 'd398fd62-6208-49f8-9eb6-2aff0961d400' },
  ];
  console.log('\n[sample club counts after planned/applied cleanup]');
  for (const s of samples) {
    const n = await countClubs(s.id);
    console.log(`  ${s.name}: ${n} senior clubs`);
  }

  console.log('\nSummary:');
  console.log(`  stubs ${APPLY ? 'deleted' : 'would delete'}: ${stubs}`);
  console.log(`  unbacked career rows ${APPLY ? 'deleted' : 'would delete'}: ${unbacked}`);
  console.log(`  collision stats rows ${APPLY ? 'deleted' : 'would delete'}: ${collisions}`);
  console.log(`  garbage career rows ${APPLY ? 'deleted' : 'would delete'}: ${garbage}`);
  if (!APPLY) console.log('\nRe-run with --apply to write.');
  else {
    console.log('\nDone. Recommended follow-ups:');
    console.log('  npm run job:regenerate-draft-most-clubs');
    console.log('  npm run job:refresh-club-chain-paths');
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
