/**
 * Sync team crest metadata from API-Football. Logo CDN is quota-free.
 *
 * The API league listing is authoritative (name, country, crest, home league).
 * Player-stats / career / transfer ids are insert-only — they must never rename
 * Fulham or stamp a cup as a club's home league.
 *
 * Usage: npm run job:ingest-teams
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { fetchFootballApi, footballApiUrl } from './ingest-api.js';
import { beginIngestRun, finishIngestRun } from './ingest-run.js';
import { resolveIngestSeason } from './ingest-config.js';
import {
  BADGE_LEAGUES,
  SYNTHETIC_TEAM_ID_MIN,
  isSyntheticTeamId,
  teamLogoUrl,
} from '../constants/footballMedia.js';
import { pickHomeLeagueId, upsertTeam } from '../services/teamService.js';
import { normalizeTeamName } from '../utils/teamName.js';
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

async function deleteGhostTeams(): Promise<number> {
  const rows = (await db.execute(sql`
    DELETE FROM teams WHERE id >= ${SYNTHETIC_TEAM_ID_MIN} RETURNING id
  `)) as unknown as Array<{ id: number }>;
  return rows.length;
}

async function remapSyntheticStatTeamIds(): Promise<number> {
  const ghosts = (await db.execute(sql`
    SELECT DISTINCT team_id AS id, team_name AS name
    FROM player_stats
    WHERE team_id >= ${SYNTHETIC_TEAM_ID_MIN} AND team_name IS NOT NULL
  `)) as unknown as Array<{ id: number; name: string }>;
  if (ghosts.length === 0) return 0;

  const real = (await db.execute(sql`
    SELECT id, name_norm AS "nameNorm" FROM teams WHERE id < ${SYNTHETIC_TEAM_ID_MIN}
  `)) as unknown as Array<{ id: number; nameNorm: string }>;
  const byNorm = new Map<string, number[]>();
  for (const row of real) {
    const list = byNorm.get(row.nameNorm) ?? [];
    list.push(row.id);
    byNorm.set(row.nameNorm, list);
  }

  const replacements = new Map<number, number>();
  for (const ghost of ghosts) {
    const ids = byNorm.get(normalizeTeamName(ghost.name)) ?? [];
    if (ids.length !== 1) continue;
    replacements.set(ghost.id, ids[0]!);
  }
  if (replacements.size === 0) return 0;

  const pairs = [...replacements.entries()];
  const tuples = pairs.map(([from, to]) => sql`(${from}::int, ${to}::int)`);
  await db.execute(sql`
    DELETE FROM player_stats AS s
    USING player_stats AS keep,
          (VALUES ${sql.join(tuples, sql`, `)}) AS v(ghost_id, real_id)
    WHERE s.team_id = v.ghost_id
      AND keep.player_id = s.player_id
      AND keep.league_id = s.league_id
      AND keep.season = s.season
      AND keep.team_id = v.real_id
  `);
  await db.execute(sql`
    UPDATE player_stats AS s
    SET team_id = v.real_id
    FROM (VALUES ${sql.join(tuples, sql`, `)}) AS v(ghost_id, real_id)
    WHERE s.team_id = v.ghost_id
  `);
  return replacements.size;
}

async function loadDistinctRealTeamsFromDb(): Promise<Array<{ id: number; name: string }>> {
  const rows = (await db.execute(sql`
    SELECT DISTINCT team_id AS id, team_name AS name
    FROM player_stats
    WHERE team_id > 0 AND team_id < ${SYNTHETIC_TEAM_ID_MIN} AND team_name IS NOT NULL
    UNION
    SELECT DISTINCT team_id AS id, team_name AS name
    FROM player_career
    WHERE team_id > 0 AND team_id < ${SYNTHETIC_TEAM_ID_MIN}
    UNION
    SELECT DISTINCT from_team_id AS id, from_team_name AS name
    FROM player_transfers
    WHERE from_team_id > 0 AND from_team_id < ${SYNTHETIC_TEAM_ID_MIN} AND from_team_name IS NOT NULL
    UNION
    SELECT DISTINCT to_team_id AS id, to_team_name AS name
    FROM player_transfers
    WHERE to_team_id > 0 AND to_team_id < ${SYNTHETIC_TEAM_ID_MIN} AND to_team_name IS NOT NULL
  `)) as unknown as Array<{ id: number; name: string }>;

  const byId = new Map<number, { id: number; name: string }>();
  for (const row of rows) {
    if (isSyntheticTeamId(row.id) || !row.name) continue;
    if (!byId.has(row.id)) byId.set(row.id, { id: row.id, name: row.name });
  }
  return [...byId.values()];
}

async function restoreHomeLeagues(skipIds: Set<number>): Promise<number> {
  const rows = (await db.execute(sql`
    SELECT team_id AS id, league_id AS "leagueId", SUM(appearances)::int AS appearances
    FROM player_stats
    WHERE team_id > 0 AND team_id < ${SYNTHETIC_TEAM_ID_MIN}
    GROUP BY team_id, league_id
  `)) as unknown as Array<{ id: number; leagueId: number; appearances: number }>;

  const byTeam = new Map<number, Array<{ leagueId: number; appearances: number }>>();
  for (const row of rows) {
    const list = byTeam.get(row.id) ?? [];
    list.push({ leagueId: row.leagueId, appearances: row.appearances });
    byTeam.set(row.id, list);
  }

  const updates: Array<{ id: number; leagueId: number }> = [];
  for (const [id, leagues] of byTeam) {
    if (skipIds.has(id)) continue;
    const home = pickHomeLeagueId(leagues);
    if (home != null) updates.push({ id, leagueId: home });
  }
  if (updates.length === 0) return 0;

  let written = 0;
  for (let i = 0; i < updates.length; i += 400) {
    const batch = updates.slice(i, i + 400);
    const tuples = batch.map((u) => sql`(${u.id}::int, ${u.leagueId}::int)`);
    const res = (await db.execute(sql`
      UPDATE teams AS t
      SET league_id = v.league_id
      FROM (VALUES ${sql.join(tuples, sql`, `)}) AS v(id, league_id)
      WHERE t.id = v.id AND t.league_id IS DISTINCT FROM v.league_id
      RETURNING t.id
    `)) as unknown as Array<{ id: number }>;
    written += res.length;
  }
  return written;
}

async function fetchTeamById(id: number): Promise<ApiTeamEntry['team'] | null> {
  const data = (await fetchFootballApi(footballApiUrl(`/teams?id=${id}`))) as {
    response: ApiTeamEntry[];
  };
  return data.response?.[0]?.team ?? null;
}

async function restoreNameCollisions(protectedIds: Set<number>): Promise<number> {
  const dups = (await db.execute(sql`
    SELECT name_norm AS "nameNorm"
    FROM teams
    WHERE id < ${SYNTHETIC_TEAM_ID_MIN}
    GROUP BY name_norm
    HAVING COUNT(*) > 1
  `)) as unknown as Array<{ nameNorm: string }>;
  if (dups.length === 0) return 0;

  const norms = dups.map((d) => d.nameNorm);
  const rows = (await db.execute(sql`
    SELECT id, name_norm AS "nameNorm"
    FROM teams
    WHERE name_norm IN (${sql.join(norms.map((n) => sql`${n}`), sql`, `)})
      AND id < ${SYNTHETIC_TEAM_ID_MIN}
  `)) as unknown as Array<{ id: number; nameNorm: string }>;

  const byNorm = new Map<string, number[]>();
  for (const row of rows) {
    const list = byNorm.get(row.nameNorm) ?? [];
    list.push(row.id);
    byNorm.set(row.nameNorm, list);
  }

  let restored = 0;
  for (const ids of byNorm.values()) {
    const hasProtected = ids.some((id) => protectedIds.has(id));
    if (!hasProtected) continue;
    for (const id of ids) {
      if (protectedIds.has(id)) continue;
      const team = await fetchTeamById(id);
      if (!team?.id || !team.name) continue;
      await upsertTeam({
        id: team.id,
        name: team.name,
        country: team.country ?? null,
        logoUrl: team.logo ?? teamLogoUrl(team.id),
        overwrite: true,
      });
      // Stats that borrowed this id under the namesake's name must not keep a top-flight home league.
      await db.execute(sql`UPDATE teams SET league_id = NULL WHERE id = ${team.id}`);
      restored += 1;
    }
  }
  return restored;
}

async function syncLeagueSeason(
  leagueId: number,
  leagueName: string,
  season: number,
  overwrite: boolean
): Promise<Set<number>> {
  const synced = new Set<number>();
  const data = (await fetchFootballApi(
    footballApiUrl(`/teams?league=${leagueId}&season=${season}`)
  )) as { response: ApiTeamEntry[] };

  for (const entry of data.response ?? []) {
    const team = entry.team;
    if (!team?.id || !team.name || isSyntheticTeamId(team.id)) continue;
    await upsertTeam({
      id: team.id,
      name: team.name,
      leagueId,
      country: team.country ?? null,
      logoUrl: team.logo ?? teamLogoUrl(team.id),
      overwrite,
    });
    synced.add(team.id);
  }
  console.log(`  ${leagueName} ${season}: ${synced.size} teams (${overwrite ? 'authoritative' : 'fill'})`);
  return synced;
}

export async function runIngestTeams(): Promise<number> {
  const runId = await beginIngestRun('ingest-teams');
  let total = 0;
  const season = resolveIngestSeason();
  const leagues = resolveBadgeLeagues();

  try {
    const ghosts = await deleteGhostTeams();
    if (ghosts > 0) console.log(`Removed ${ghosts} synthetic FBref team rows`);

    const remapped = await remapSyntheticStatTeamIds();
    if (remapped > 0) console.log(`Remapped ${remapped} FBref ghost team_ids onto real clubs`);

    const protectedIds = new Set<number>();
    for (const league of leagues) {
      console.log(`Fetching teams for ${league.name} (${league.id}), season ${season}...`);
      const ids = await syncLeagueSeason(league.id, league.name, season, true);
      for (const id of ids) protectedIds.add(id);
      total += ids.size;
    }

    console.log(`Filling missing clubs from ${season - 1}...`);
    for (const league of leagues) {
      const ids = await syncLeagueSeason(league.id, league.name, season - 1, false);
      total += ids.size;
    }

    const collisions = await restoreNameCollisions(protectedIds);
    if (collisions > 0) console.log(`Restored ${collisions} name-collision clubs from API-Football`);

    const fromDb = await loadDistinctRealTeamsFromDb();
    console.log(`Inserting ${fromDb.length} distinct real team ids from player data (no overwrite)...`);
    for (const team of fromDb) {
      await upsertTeam({
        id: team.id,
        name: team.name,
        logoUrl: teamLogoUrl(team.id),
      });
      total += 1;
    }

    const homes = await restoreHomeLeagues(protectedIds);
    if (homes > 0) console.log(`Restored home league_id on ${homes} clubs`);

    await finishIngestRun(runId, 'success', total);
    console.log(`Done — processed ${total} team rows.`);
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
