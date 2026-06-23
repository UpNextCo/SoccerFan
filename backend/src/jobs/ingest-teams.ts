/**
 * Sync team crest metadata from API-Football + existing player stats/career/transfers.
 * Logo CDN: https://media.api-sports.io/football/teams/{id}.png (free — no API quota).
 *
 * Usage: npm run job:ingest-teams
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { fetchFootballApi, footballApiUrl } from './ingest-api.js';
import { beginIngestRun, finishIngestRun } from './ingest-run.js';
import { resolveIngestSeason } from './ingest-config.js';
import { BADGE_LEAGUES, teamLogoUrl } from '../constants/footballMedia.js';
import { upsertTeam } from '../services/teamService.js';
import { db } from '../db/index.js';

type ApiTeamEntry = {
  team: {
    id: number;
    name: string;
    country?: string | null;
    logo?: string | null;
  };
};

function resolveBadgeLeagues() {
  const raw = process.env.INGEST_LEAGUE_IDS?.trim();
  if (!raw) return [...BADGE_LEAGUES];

  const tokens = raw.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
  const picked = BADGE_LEAGUES.filter((league) =>
    tokens.some(
      (token) =>
        token === String(league.id) ||
        league.name.toLowerCase() === token ||
        league.name.toLowerCase().includes(token)
    )
  );

  return picked.length > 0 ? picked : [...BADGE_LEAGUES];
}

async function loadDistinctTeamsFromDb(): Promise<
  Array<{ id: number; name: string; leagueId: number | null }>
> {
  const rows = (await db.execute(sql`
    SELECT DISTINCT team_id AS id, team_name AS name, league_id
    FROM player_stats
    WHERE team_id > 0 AND team_name IS NOT NULL
    UNION
    SELECT DISTINCT team_id AS id, team_name AS name, NULL::int AS league_id
    FROM player_career
    WHERE team_id > 0
    UNION
    SELECT DISTINCT from_team_id AS id, from_team_name AS name, NULL::int AS league_id
    FROM player_transfers
    WHERE from_team_id > 0 AND from_team_name IS NOT NULL
    UNION
    SELECT DISTINCT to_team_id AS id, to_team_name AS name, NULL::int AS league_id
    FROM player_transfers
    WHERE to_team_id > 0 AND to_team_name IS NOT NULL
  `)) as Array<{ id: number; name: string; league_id: number | null }>;

  const byId = new Map<number, { id: number; name: string; leagueId: number | null }>();
  for (const row of rows) {
    const existing = byId.get(row.id);
    if (!existing) {
      byId.set(row.id, { id: row.id, name: row.name, leagueId: row.league_id });
      continue;
    }
    if (existing.leagueId == null && row.league_id != null) {
      byId.set(row.id, { id: row.id, name: row.name, leagueId: row.league_id });
    }
  }
  return [...byId.values()];
}

export async function runIngestTeams(): Promise<number> {
  const runId = await beginIngestRun('ingest-teams');
  let total = 0;
  const season = resolveIngestSeason();
  const leagues = resolveBadgeLeagues();

  try {
    for (const league of leagues) {
      console.log(`Fetching teams for ${league.name} (${league.id}), season ${season}...`);
      const data = (await fetchFootballApi(
        footballApiUrl(`/teams?league=${league.id}&season=${season}`)
      )) as { response: ApiTeamEntry[] };

      for (const entry of data.response ?? []) {
        const team = entry.team;
        if (!team?.id || !team.name) continue;

        await upsertTeam({
          id: team.id,
          name: team.name,
          leagueId: league.id,
          country: team.country ?? null,
          logoUrl: team.logo ?? teamLogoUrl(team.id),
        });
        total += 1;
      }
    }

    const fromDb = await loadDistinctTeamsFromDb();
    console.log(`Upserting ${fromDb.length} distinct teams from player data...`);

    for (const team of fromDb) {
      await upsertTeam({
        id: team.id,
        name: team.name,
        leagueId: team.leagueId,
        logoUrl: teamLogoUrl(team.id),
      });
      total += 1;
    }

    await finishIngestRun(runId, 'success', total);
    console.log(`Done — upserted ${total} team rows.`);
    return total;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishIngestRun(runId, 'failed', total, message);
    throw error;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runIngestTeams()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
