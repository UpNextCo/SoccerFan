/**
 * Ingest career teams from API-Football /players/teams into player_career.
 * Usage: INGEST_LEAGUE_IDS=39 npm run job:ingest-career
 */
import 'dotenv/config';
import { fetchFootballApi, footballApiUrl } from './ingest-api.js';
import { beginIngestRun, finishIngestRun } from './ingest-run.js';
import { loadIngestPlayers } from './ingest-player-map.js';
import { db } from '../db/index.js';
import { playerCareer } from '../db/schema.js';

type CareerTeamEntry = {
  team: { id: number; name: string };
  seasons: number[];
};

export async function runIngestCareer(): Promise<number> {
  const runId = await beginIngestRun('ingest-career');
  let total = 0;

  try {
    const players = await loadIngestPlayers();
    console.log(`Fetching career teams for ${players.length} players...`);

    for (const player of players) {
      const data = (await fetchFootballApi(
        footballApiUrl(`/players/teams?player=${player.externalId}`)
      )) as { response: CareerTeamEntry[] };

      for (const entry of data.response ?? []) {
        const seasons = [...(entry.seasons ?? [])].sort((a, b) => a - b);
        if (seasons.length === 0) continue;

        const seasonFrom = seasons[0]!;
        const seasonTo = seasons[seasons.length - 1];

        await db
          .insert(playerCareer)
          .values({
            playerId: player.id,
            teamId: entry.team.id,
            teamName: entry.team.name,
            seasonFrom,
            seasonTo: seasonTo >= seasonFrom ? seasonTo : seasonFrom,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [playerCareer.playerId, playerCareer.teamId, playerCareer.seasonFrom],
            set: {
              teamName: entry.team.name,
              seasonTo: seasonTo >= seasonFrom ? seasonTo : seasonFrom,
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
  runIngestCareer()
    .then((total) => {
      console.log(`Career ingest complete — ${total} rows upserted`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
