/**
 * Ingest career teams from API-Football /players/teams into player_career.
 * Usage: INGEST_LEAGUE_IDS=39 npm run job:ingest-career
 */
import 'dotenv/config';
import { fetchFootballApi, footballApiUrl } from './ingest-api.js';
import { beginIngestRun, finishIngestRun } from './ingest-run.js';
import { isTruthyEnv, loadIngestPlayers } from './ingest-player-map.js';
import { db } from '../db/index.js';
import { playerCareer } from '../db/schema.js';
import { parseSeasons, toPositiveInt } from './ingest-parse.js';

type CareerTeamEntry = {
  team: { id: number | string | null; name: string | null };
  seasons: unknown[];
};

export async function runIngestCareer(): Promise<number> {
  const runId = await beginIngestRun('ingest-career');
  let total = 0;

  try {
    let players = await loadIngestPlayers();
    if (isTruthyEnv(process.env.INGEST_SKIP_ENRICHED)) {
      const enriched = new Set(
        (await db.selectDistinct({ pid: playerCareer.playerId }).from(playerCareer)).map((r) => r.pid)
      );
      const before = players.length;
      players = players.filter((p) => !enriched.has(p.id));
      console.log(`Skip-enriched: ${before - players.length} already have career rows, ${players.length} remaining`);
    }
    console.log(`Fetching career teams for ${players.length} players...`);

    for (const player of players) {
      const data = (await fetchFootballApi(
        footballApiUrl(`/players/teams?player=${player.externalId}`)
      )) as { response: CareerTeamEntry[] };

      for (const entry of data.response ?? []) {
        const teamId = toPositiveInt(entry.team?.id);
        const teamName = entry.team?.name?.trim();
        if (!teamId || !teamName) continue;

        const seasons = parseSeasons(entry.seasons);
        if (seasons.length === 0) continue;

        const seasonFrom = seasons[0]!;
        const seasonTo = seasons[seasons.length - 1]!;

        await db
          .insert(playerCareer)
          .values({
            playerId: player.id,
            teamId,
            teamName,
            seasonFrom,
            seasonTo: seasonTo >= seasonFrom ? seasonTo : seasonFrom,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [playerCareer.playerId, playerCareer.teamId, playerCareer.seasonFrom],
            set: {
              teamName,
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
