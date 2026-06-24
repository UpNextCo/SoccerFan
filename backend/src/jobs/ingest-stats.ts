/**
 * Ingest season stats from API-Football into player_stats.
 * Usage: INGEST_LEAGUE_IDS=39 INGEST_SEASONS_BACK=2 npm run job:ingest-stats
 */
import 'dotenv/config';
import { resolveStatsCompetitions, resolveIngestSeasonsBack } from './ingest-config.js';
import { fetchFootballApi, footballApiUrl } from './ingest-api.js';
import { beginIngestRun, finishIngestRun } from './ingest-run.js';
import { loadExternalIdMap } from './ingest-player-map.js';
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

function num(value: number | null | undefined): number {
  return typeof value === 'number' && value >= 0 ? value : 0;
}

function isGoalkeeper(block: ApiStatBlock): boolean {
  return (block.games.position ?? '').toLowerCase().includes('goalkeeper');
}

async function ingestLeagueSeason(
  leagueId: number,
  leagueName: string,
  season: number,
  playerMap: Map<string, string>
): Promise<number> {
  let page = 1;
  let totalPages = 1;
  let upserted = 0;

  while (page <= totalPages) {
    const data = (await fetchFootballApi(
      footballApiUrl(`/players?league=${leagueId}&season=${season}&page=${page}`)
    )) as { response: ApiPlayerEntry[]; paging?: { total: number } };

    totalPages = data.paging?.total ?? 1;

    for (const entry of data.response ?? []) {
      const playerId = playerMap.get(String(entry.player.id));
      if (!playerId) continue;

      for (const block of entry.statistics) {
        if (block.league.id !== leagueId) continue;

        const gk = isGoalkeeper(block);
        await db
          .insert(playerStats)
          .values({
            playerId,
            externalPlayerId: String(entry.player.id),
            leagueId: block.league.id,
            leagueName: block.league.name || leagueName,
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
              leagueName: block.league.name || leagueName,
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
    }

    page += 1;
  }

  return upserted;
}

export async function runIngestStats(): Promise<number> {
  const runId = await beginIngestRun('ingest-stats');
  let total = 0;

  try {
    const leagues = resolveStatsCompetitions();
    const seasons = resolveIngestSeasonsBack();
    const playerMap = await loadExternalIdMap();

    console.log(`Seasons: ${seasons.join(', ')}`);
    console.log(`Leagues: ${leagues.map((l) => l.name).join(', ')}`);

    for (const league of leagues) {
      for (const season of seasons) {
        console.log(`Ingesting stats: ${league.name} ${season}/${String(season + 1).slice(-2)}...`);
        const count = await ingestLeagueSeason(league.id, league.name, season, playerMap);
        console.log(`  → ${count} stat rows upserted`);
        total += count;
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
  runIngestStats()
    .then((total) => {
      console.log(`Stats ingest complete — ${total} rows upserted`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
