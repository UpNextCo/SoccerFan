/**
 * Readiness / "are we done?" report. Read-only, ZERO API calls.
 * Defines the finish line per data type and per game generator, with ✅/❌.
 *
 * Usage: DATABASE_URL=... npm run job:audit-readiness
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

/** Coverage targets (% of enrichable players). Tunable — not every player has data. */
const TARGETS = {
  careerPct: 85, // most pros have a club history
  transfersPct: 75, // most have at least one transfer
  honoursPct: 30, // many players legitimately have zero trophies
  // A real per-position tier spread leaves ~30% legitimately at tier 3, so "computed"
  // means tiers are spread (well over half are non-default), not literally 100%.
  marketValueSpreadPct: 50,
};

/** Minimum pool sizes a generator needs to build a puzzle today. */
const GEN = {
  guessWhoPlayers: 200,
  blindRankPool: 5, // per PL metric
  targetManPlayersPerLeague: 15,
  bingoNationalities: 6, // nationality categories with enough players
  bingoClubs: 10, // club categories with enough players
  bingoCompetitions: 3, // trophy categories with enough winners
  categoryMembers: 8, // players needed to make a category usable
  towerPlApps: 30, // players with >=100 PL apps
  towerUclWinners: 20,
  oneMoreBigSeasons: 30, // players with a 20+ goal league season
  draftPerPosition: 20,
};

const STAT_SEASONS = 16; // 2010–2025
const STAT_LEAGUES = 5;

function pct(n: number, d: number): number {
  return d === 0 ? 0 : Math.round((n / d) * 1000) / 10;
}

function mark(ok: boolean): string {
  return ok ? '✅' : '❌';
}

async function row<T extends Record<string, unknown>>(query: ReturnType<typeof sql>): Promise<T> {
  const rows = (await db.execute(query)) as unknown as T[];
  return rows[0] as T;
}

async function rows<T extends Record<string, unknown>>(query: ReturnType<typeof sql>): Promise<T[]> {
  return (await db.execute(query)) as unknown as T[];
}

async function main() {
  console.log('\n══════════════════════════════════════════════');
  console.log('  BALL KNOWLEDGE — DATA READINESS REPORT');
  console.log('══════════════════════════════════════════════');

  // ---------- DATA COMPLETENESS ----------
  const base = await row<{
    players: number;
    external_players: number;
    with_career: number;
    with_honours: number;
    with_transfers: number;
    with_stats: number;
  }>(sql`
    SELECT
      (SELECT COUNT(*) FROM players)::int AS players,
      (SELECT COUNT(*) FROM players WHERE external_id IS NOT NULL)::int AS external_players,
      (SELECT COUNT(DISTINCT player_id) FROM player_career)::int AS with_career,
      (SELECT COUNT(DISTINCT player_id) FROM player_honours)::int AS with_honours,
      (SELECT COUNT(DISTINCT player_id) FROM player_transfers)::int AS with_transfers,
      (SELECT COUNT(DISTINCT player_id) FROM player_stats)::int AS with_stats
  `);

  const eligible = base.external_players;
  const careerPct = pct(base.with_career, eligible);
  const transfersPct = pct(base.with_transfers, eligible);
  const honoursPct = pct(base.with_honours, eligible);

  const statCov = await row<{ seasons: number; leagues: number; min_s: number; max_s: number }>(sql`
    SELECT COUNT(DISTINCT season)::int AS seasons,
           COUNT(DISTINCT league_name)::int AS leagues,
           MIN(season)::int AS min_s, MAX(season)::int AS max_s
    FROM player_stats
  `);

  const teams = await row<{ teams: number; with_league: number; with_logo: number }>(sql`
    SELECT COUNT(*)::int AS teams,
           COUNT(*) FILTER (WHERE league_id IS NOT NULL)::int AS with_league,
           COUNT(*) FILTER (WHERE logo_url IS NOT NULL AND logo_url <> '')::int AS with_logo
    FROM teams
  `);

  const mv = await row<{ non_default: number; total: number }>(sql`
    SELECT COUNT(*) FILTER (WHERE market_value_tier <> 3)::int AS non_default,
           COUNT(*)::int AS total
    FROM players
  `);
  const marketPct = pct(mv.non_default, mv.total);

  const statsOk = statCov.seasons >= STAT_SEASONS && statCov.leagues >= STAT_LEAGUES;
  const logoPct = pct(teams.with_logo, teams.teams);

  console.log('\n── DATA COMPLETENESS ──────────────────────────');
  console.log(`Players: ${base.players} total · ${eligible} with external id`);
  console.log(
    `${mark(statsOk)} Stats        ${statCov.min_s}–${statCov.max_s} · ${statCov.seasons}/${STAT_SEASONS} seasons · ${statCov.leagues}/${STAT_LEAGUES} leagues`
  );
  console.log(
    `${mark(careerPct >= TARGETS.careerPct)} Career       ${careerPct}% (${base.with_career}/${eligible}) · target ${TARGETS.careerPct}% · ${eligible - base.with_career} remaining`
  );
  console.log(
    `${mark(transfersPct >= TARGETS.transfersPct)} Transfers    ${transfersPct}% (${base.with_transfers}/${eligible}) · target ${TARGETS.transfersPct}% · ${eligible - base.with_transfers} remaining`
  );
  console.log(
    `${mark(honoursPct >= TARGETS.honoursPct)} Trophies     ${honoursPct}% (${base.with_honours}/${eligible}) · target ${TARGETS.honoursPct}% (many have none)`
  );
  console.log(
    `${mark(logoPct >= 99)} Team crests  ${logoPct}% logos (${teams.with_logo}/${teams.teams}) · ${teams.with_league} mapped to a league`
  );
  console.log(
    `${mark(marketPct >= TARGETS.marketValueSpreadPct)} Market value ${marketPct}% tiered (${mv.non_default}/${mv.total} non-default) · run job:market-value if ❌`
  );

  // ---------- GENERATOR READINESS ----------
  const pl = await row<{ goals_pool: number; assists_pool: number; apps_pool: number }>(sql`
    WITH pl AS (
      SELECT player_id, SUM(goals)::int AS g, SUM(assists)::int AS a, SUM(appearances)::int AS ap
      FROM player_stats WHERE league_id = 39 GROUP BY player_id
    )
    SELECT
      COUNT(*) FILTER (WHERE g >= 5)::int AS goals_pool,
      COUNT(*) FILTER (WHERE a >= 3)::int AS assists_pool,
      COUNT(*) FILTER (WHERE ap >= 20)::int AS apps_pool
    FROM pl
  `);

  const leagueDepth = await rows<{ league_name: string; goals_players: number }>(sql`
    SELECT league_name, COUNT(*) FILTER (WHERE g > 0)::int AS goals_players
    FROM (
      SELECT league_name, player_id, SUM(goals)::int AS g
      FROM player_stats GROUP BY league_name, player_id
    ) t
    GROUP BY league_name ORDER BY league_name
  `);

  const bingo = await row<{ nationalities: number; clubs: number; competitions: number }>(sql`
    SELECT
      (SELECT COUNT(*) FROM (
        SELECT nationality FROM players WHERE external_id IS NOT NULL
        GROUP BY nationality HAVING COUNT(*) >= ${GEN.categoryMembers}
      ) n)::int AS nationalities,
      (SELECT COUNT(*) FROM (
        SELECT team_id FROM player_career
        GROUP BY team_id HAVING COUNT(DISTINCT player_id) >= ${GEN.categoryMembers}
      ) c)::int AS clubs,
      (SELECT COUNT(*) FROM (
        SELECT competition FROM player_honours WHERE placement ILIKE '%winner%'
        GROUP BY competition HAVING COUNT(DISTINCT player_id) >= ${GEN.categoryMembers}
      ) t)::int AS competitions
  `);

  const tower = await row<{ pl_apps: number; ucl_winners: number }>(sql`
    SELECT
      (SELECT COUNT(*) FROM (
        SELECT player_id, SUM(appearances)::int AS ap FROM player_stats
        WHERE league_id = 39 GROUP BY player_id HAVING SUM(appearances) >= 100
      ) a)::int AS pl_apps,
      (SELECT COUNT(DISTINCT player_id) FROM player_honours
        WHERE competition ILIKE '%champions league%' AND placement ILIKE '%winner%')::int AS ucl_winners
  `);

  const oneMore = await row<{ big_seasons: number }>(sql`
    SELECT COUNT(DISTINCT player_id)::int AS big_seasons
    FROM player_stats WHERE goals >= 20
  `);

  const positions = await rows<{ position: string; n: number }>(sql`
    SELECT position, COUNT(*)::int AS n FROM players WHERE external_id IS NOT NULL
    GROUP BY position ORDER BY position
  `);

  const guessWhoOk = eligible >= GEN.guessWhoPlayers;
  const blindOk =
    pl.goals_pool >= GEN.blindRankPool &&
    pl.assists_pool >= GEN.blindRankPool &&
    pl.apps_pool >= GEN.blindRankPool;
  const targetOk = leagueDepth.every((l) => l.goals_players >= GEN.targetManPlayersPerLeague);
  const bingoOk =
    bingo.nationalities >= GEN.bingoNationalities &&
    bingo.clubs >= GEN.bingoClubs &&
    bingo.competitions >= GEN.bingoCompetitions;
  const towerOk = tower.pl_apps >= GEN.towerPlApps && tower.ucl_winners >= GEN.towerUclWinners;
  const oneMoreOk = oneMore.big_seasons >= GEN.oneMoreBigSeasons;
  const draftOk =
    positions.length >= 4 &&
    positions.every((p) => p.n >= GEN.draftPerPosition) &&
    marketPct >= TARGETS.marketValueSpreadPct; // needs a real value signal to rank

  console.log('\n── GENERATOR READINESS (can we build it today?) ──');
  console.log(`${mark(guessWhoOk)} Guess Who      ${eligible} eligible players`);
  console.log(
    `${mark(targetOk)} Target Man     scorers/league: ${leagueDepth.map((l) => `${l.league_name.split(' ')[0]} ${l.goals_players}`).join(', ')}`
  );
  console.log(
    `${mark(blindOk)} Blind Rank     PL pools — goals ${pl.goals_pool}, assists ${pl.assists_pool}, apps ${pl.apps_pool}`
  );
  console.log(
    `${mark(bingoOk)} Football Bingo nationalities ${bingo.nationalities}, clubs ${bingo.clubs}, trophy cats ${bingo.competitions}`
  );
  console.log(
    `${mark(towerOk)} Football Tower PL 100+ apps ${tower.pl_apps}, UCL winners ${tower.ucl_winners}`
  );
  console.log(`${mark(oneMoreOk)} One More       players w/ a 20+ goal season: ${oneMore.big_seasons}`);
  console.log(
    `${mark(draftOk)} Draft Master   positions ${positions.map((p) => `${p.position[0]}:${p.n}`).join(' ')} (needs market value)`
  );
  console.log(`⏸  Football Golf   uses general data — fine once above are ready`);
  console.log(`⛔ World Cup XI    blocked — needs international squad data (not ingested)`);

  // ---------- TODAY'S PUZZLES ----------
  const today = new Date().toISOString().slice(0, 10);
  const puzzles = await rows<{ mode_id: string }>(sql`
    SELECT mode_id FROM daily_puzzles WHERE date = ${today} ORDER BY mode_id
  `);
  console.log('\n── TODAY ──────────────────────────────────────');
  console.log(`${today}: ${puzzles.length ? puzzles.map((p) => p.mode_id).join(', ') : 'no puzzles generated'}`);

  // ---------- HEADLINE ----------
  const dataChecks = [
    statsOk,
    careerPct >= TARGETS.careerPct,
    transfersPct >= TARGETS.transfersPct,
    honoursPct >= TARGETS.honoursPct,
    marketPct >= TARGETS.marketValueSpreadPct,
  ];
  const dataDone = dataChecks.filter(Boolean).length;
  console.log('\n══════════════════════════════════════════════');
  console.log(`  DATA LAYER: ${dataDone}/${dataChecks.length} complete`);
  console.log('══════════════════════════════════════════════\n');

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
