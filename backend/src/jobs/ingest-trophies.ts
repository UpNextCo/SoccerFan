/**
 * Ingest trophy history into player_honours.
 * Usage: INGEST_LEAGUE_IDS=39 npm run job:ingest-trophies
 */
import 'dotenv/config';
import { fetchFootballApi, footballApiUrl } from './ingest-api.js';
import { beginIngestRun, finishIngestRun } from './ingest-run.js';
import { loadIngestPlayers } from './ingest-player-map.js';
import { db } from '../db/index.js';
import { playerHonours } from '../db/schema.js';

type TrophyEntry = {
  league: string;
  country: string;
  season: string;
  place: string;
};

export async function runIngestTrophies(): Promise<number> {
  const runId = await beginIngestRun('ingest-trophies');
  let total = 0;

  try {
    const players = await loadIngestPlayers();
    console.log(`Fetching trophies for ${players.length} players...`);

    for (const player of players) {
      const data = (await fetchFootballApi(
        footballApiUrl(`/trophies?player=${player.externalId}`)
      )) as {
        response: Array<{
          league?: string;
          country?: string;
          season?: string | number;
          place?: string;
          trophies?: TrophyEntry[];
        }>;
      };

      const raw = data.response ?? [];
      const list =
        raw[0]?.trophies ??
        (raw.length > 0 && raw[0]?.league ? raw : []);

      for (const trophy of list as Array<{
        league?: string;
        country?: string;
        season?: string | number;
        place?: string;
      }>) {
        if (!trophy?.league || trophy.season == null) continue;

        const placement = trophy.place ?? 'Winner';

        await db
          .insert(playerHonours)
          .values({
            playerId: player.id,
            competition: trophy.league,
            country: trophy.country ?? null,
            season: String(trophy.season),
            placement,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [
              playerHonours.playerId,
              playerHonours.competition,
              playerHonours.season,
              playerHonours.placement,
            ],
            set: {
              country: trophy.country ?? null,
              updatedAt: new Date(),
            },
          });

        total += 1;
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
  runIngestTrophies()
    .then((total) => {
      console.log(`Trophies ingest complete — ${total} rows upserted`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
