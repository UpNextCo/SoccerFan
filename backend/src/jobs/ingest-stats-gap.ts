/**
 * Per-player stats backfill for DB players with career/transfers but no player_stats.
 * Uses /players?id=&season= (one call per player per season).
 *
 * Usage: npm run job:ingest-stats-gap
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { resolveIngestLeagues, resolveIngestSeason } from './ingest-config.js';
import { fetchFootballApi, footballApiUrl } from './ingest-api.js';
import { beginIngestRun, finishIngestRun } from './ingest-run.js';
import { db } from '../db/index.js';
import { playerStats } from '../db/schema.js';

type ApiStatBlock = {
  league: { id: number; name: string };
  team: { id: number; name: string };
  games: {
    appearences: number | null;
    minutes: number | null;
    position: string | null;
  };
  goals: {
    total: number | null;
    assists: number | null;
    conceded: number | null;
    saves: number | null;
  };
  cards: { yellow: number | null; red: number | null };
  fouls: { committed: number | null };
  tackles: { total: number | null };
};

type ApiPlayerEntry = {
  player: { id: number; name: string };
  statistics: ApiStatBlock[];
};

type GapPlayer = {
  id: string;
  external_id: string;
  min_season: number;
  max_season: number;
};

function num(value: number | null | undefined): number {
  return typeof value === 'number' && value >= 0 ? value : 0;
}

function isGoalkeeper(block: ApiStatBlock): boolean {
  return (block.games.position ?? '').toLowerCase().includes('goalkeeper');
}

function resolveSeasonFrom(): number {
  const raw = process.env.INGEST_SEASON_FROM?.trim();
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 2000) return parsed;
  }
  return 2010;
}

function resolveSeasonTo(): number {
  const raw = process.env.INGEST_SEASON_TO?.trim();
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 2000) return parsed;
  }
  return resolveIngestSeason();
}

function resolveGapLimit(): number | null {
  const raw = process.env.INGEST_STATS_GAP_LIMIT?.trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function loadGapPlayers(): Promise<GapPlayer[]> {
  const seasonTo = resolveSeasonTo();
  const rows = (await db.execute(sql`
    WITH gap AS (
      SELECT p.id, p.external_id
      FROM players p
      WHERE p.external_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM player_stats s WHERE s.player_id = p.id)
        AND (
          EXISTS (SELECT 1 FROM player_career c WHERE c.player_id = p.id)
          OR EXISTS (SELECT 1 FROM player_transfers t WHERE t.player_id = p.id)
        )
    )
    SELECT
      g.id,
      g.external_id,
      LEAST(COALESCE(MIN(c.season_from), 2015), 2015)::int AS min_season,
      GREATEST(COALESCE(MAX(COALESCE(c.season_to, c.season_from)), ${seasonTo}), ${seasonTo})::int AS max_season
    FROM gap g
    LEFT JOIN player_career c ON c.player_id = g.id
    GROUP BY g.id, g.external_id
    ORDER BY g.external_id
  `)) as GapPlayer[];

  const from = resolveSeasonFrom();
  return rows.map((row) => ({
    ...row,
    min_season: Math.max(from, row.min_season),
    max_season: Math.min(seasonTo, row.max_season),
  }));
}

async function upsertStatBlocks(
  playerId: string,
  externalId: string,
  season: number,
  blocks: ApiStatBlock[],
  leagueIds: Set<number>
): Promise<number> {
  let upserted = 0;

  for (const block of blocks) {
    if (!leagueIds.has(block.league.id)) continue;

    const gk = isGoalkeeper(block);
    await db
      .insert(playerStats)
      .values({
        playerId,
        externalPlayerId: externalId,
        leagueId: block.league.id,
        leagueName: block.league.name,
        season,
        teamId: block.team.id ?? 0,
        teamName: block.team.name,
        appearances: num(block.games.appearences),
        minutes: num(block.games.minutes),
        goals: num(block.goals.total),
        assists: num(block.goals.assists),
        yellowCards: num(block.cards.yellow),
        redCards: num(block.cards.red),
        cleanSheets: gk ? num(block.goals.conceded === 0 ? 0 : null) : null,
        saves: gk ? num(block.goals.saves) : null,
        foulsCommitted: num(block.fouls.committed),
        tackles: num(block.tackles.total),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          playerStats.playerId,
          playerStats.leagueId,
          playerStats.season,
          playerStats.teamId,
        ],
        set: {
          leagueName: block.league.name,
          teamName: block.team.name,
          appearances: num(block.games.appearences),
          minutes: num(block.games.minutes),
          goals: num(block.goals.total),
          assists: num(block.goals.assists),
          yellowCards: num(block.cards.yellow),
          redCards: num(block.cards.red),
          saves: gk ? num(block.goals.saves) : null,
          foulsCommitted: num(block.fouls.committed),
          tackles: num(block.tackles.total),
          updatedAt: new Date(),
        },
      });

    upserted += 1;
  }

  return upserted;
}

export async function runIngestStatsGap(): Promise<number> {
  const runId = await beginIngestRun('ingest-stats-gap');
  let total = 0;
  const leagues = resolveIngestLeagues();
  const leagueIds = new Set(leagues.map((l) => l.id));
  const limit = resolveGapLimit();

  try {
    let gapPlayers = await loadGapPlayers();
    if (limit != null) gapPlayers = gapPlayers.slice(0, limit);

    console.log(`Backfilling stats for ${gapPlayers.length} players (top 5 leagues only)...`);
    console.log(`Season range: ${resolveSeasonFrom()}–${resolveSeasonTo()}`);

    for (let i = 0; i < gapPlayers.length; i += 1) {
      const player = gapPlayers[i]!;

      for (let season = player.min_season; season <= player.max_season; season += 1) {
        const data = (await fetchFootballApi(
          footballApiUrl(`/players?id=${player.external_id}&season=${season}`)
        )) as { response: ApiPlayerEntry[] };

        const entry = data.response?.[0];
        if (!entry?.statistics?.length) continue;

        total += await upsertStatBlocks(
          player.id,
          player.external_id,
          season,
          entry.statistics,
          leagueIds
        );
      }

      if ((i + 1) % 25 === 0 || i + 1 === gapPlayers.length) {
        console.log(`  ${i + 1}/${gapPlayers.length} players processed (${total} stat rows so far)`);
      }
    }

    await finishIngestRun(runId, 'success', total);
    return total;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishIngestRun(runId, 'failed', total, message);
    throw error;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runIngestStatsGap()
    .then((total) => {
      console.log(`Stats gap backfill complete — ${total} rows upserted`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
