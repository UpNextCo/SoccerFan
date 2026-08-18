/**
 * Ingest players from API-Football into PostgreSQL.
 * Usage: API_FOOTBALL_KEY=xxx DATABASE_URL=xxx npm run job:ingest-players
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { isEflLeagueId, resolveIngestLeagues, resolveIngestSeason } from './ingest-config.js';
import { players } from '../db/schema.js';
import { db } from '../db/index.js';
import { canonicalNationality } from '../utils/nationality.js';
import {
  buildPlayerSearchFields,
  isAbbreviatedName,
} from '../utils/playerSearch.js';

const API_KEY = process.env.API_FOOTBALL_KEY;
const REQUEST_DELAY_MS = 250;

type ApiPlayerEntry = {
  player: {
    id: number;
    name: string;
    firstname?: string | null;
    lastname?: string | null;
    age: number | null;
    nationality: string | null;
  };
  statistics: Array<{
    league: { id: number; name: string };
    team: { id: number; name: string };
    games: {
      number: number | null;
      position: string | null;
    };
  }>;
};

type SquadPlayer = {
  id: number;
  name: string;
  age: number | null;
  number: number | null;
  position: string | null;
  nationality: string | null;
};

const profileCache = new Map<
  number,
  {
    nationality: string | null;
    age: number | null;
    firstname: string | null;
    lastname: string | null;
    abbreviatedName: string | null;
  }
>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mapPosition(pos: string | null | undefined): string {
  if (!pos) return 'Midfielder';
  const normalized = pos.toLowerCase();
  if (normalized.includes('goalkeeper')) return 'Goalkeeper';
  if (normalized.includes('defender')) return 'Defender';
  if (normalized.includes('midfielder')) return 'Midfielder';
  return 'Attacker';
}

function normalizeNationality(value: string | null | undefined): string {
  return canonicalNationality(value);
}

function normalizeAge(value: number | null | undefined): number {
  if (typeof value === 'number' && value > 0) return value;
  return 25;
}

async function fetchJson(url: string): Promise<unknown> {
  if (!API_KEY) {
    console.warn('No API_FOOTBALL_KEY — skipping live ingestion');
    return { response: [] };
  }

  const res = await fetch(url, {
    headers: {
      'x-apisports-key': API_KEY,
    },
  });

  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${await res.text()}`);
  }

  await sleep(REQUEST_DELAY_MS);
  return res.json();
}

function pickStatistics(entry: ApiPlayerEntry, teamId: number, leagueId: number) {
  return (
    entry.statistics.find((s) => s.team.id === teamId && s.league.id === leagueId) ??
    entry.statistics.find((s) => s.team.id === teamId) ??
    entry.statistics[0]
  );
}

async function fetchPlayerProfile(
  playerId: number,
  seasonsToTry: number[]
): Promise<{
  nationality: string | null;
  age: number | null;
  firstname: string | null;
  lastname: string | null;
  abbreviatedName: string | null;
}> {
  const cached = profileCache.get(playerId);
  if (cached) return cached;

  for (const season of seasonsToTry) {
    const data = (await fetchJson(
      `https://v3.football.api-sports.io/players?id=${playerId}&season=${season}`
    )) as { response: ApiPlayerEntry[] };

    const entry = data.response?.[0];
    if (entry?.player) {
      const profile = {
        nationality: entry.player.nationality,
        age: entry.player.age,
        firstname: entry.player.firstname?.trim() || null,
        lastname: entry.player.lastname?.trim() || null,
        abbreviatedName: entry.player.name?.trim() || null,
      };
      profileCache.set(playerId, profile);
      return profile;
    }
  }

  const empty = {
    nationality: null,
    age: null,
    firstname: null,
    lastname: null,
    abbreviatedName: null,
  };
  profileCache.set(playerId, empty);
  return empty;
}

async function resolvePlayerIdentity(
  entry: ApiPlayerEntry,
  season: number
): Promise<{
  name: string;
  aliases: string[];
  searchText: string;
  nationality: string;
  age: number;
}> {
  let firstname = entry.player.firstname?.trim() || null;
  let lastname = entry.player.lastname?.trim() || null;
  let nationality = entry.player.nationality;
  let age = entry.player.age;
  let abbreviatedName: string | null = null;

  const needsProfile =
    !firstname ||
    !lastname ||
    isAbbreviatedName(entry.player.name) ||
    !nationality ||
    entry.player.name.trim().split(/\s+/).length >= 3;

  if (needsProfile) {
    const profile = await fetchPlayerProfile(entry.player.id, [season, season - 1]);
    firstname = firstname || profile.firstname;
    lastname = lastname || profile.lastname;
    nationality = nationality ?? profile.nationality;
    age = age ?? profile.age;
    abbreviatedName = profile.abbreviatedName;
  }

  if (!abbreviatedName && isAbbreviatedName(entry.player.name)) {
    abbreviatedName = entry.player.name;
  }

  const searchFields = buildPlayerSearchFields(
    entry.player.name,
    firstname,
    lastname,
    abbreviatedName
  );

  return {
    ...searchFields,
    nationality: normalizeNationality(nationality),
    age: normalizeAge(age),
  };
}

async function fetchTeamPlayersFromStats(teamId: number, season: number): Promise<ApiPlayerEntry[]> {
  const all: ApiPlayerEntry[] = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const data = (await fetchJson(
      `https://v3.football.api-sports.io/players?team=${teamId}&season=${season}&page=${page}`
    )) as { response: ApiPlayerEntry[]; paging?: { current: number; total: number } };

    all.push(...(data.response ?? []));
    totalPages = data.paging?.total ?? 1;
    page += 1;
  }

  return all;
}

async function fetchTeamPlayersFromSquads(
  teamId: number,
  seasonsToTry: number[]
): Promise<SquadPlayer[]> {
  const data = (await fetchJson(
    `https://v3.football.api-sports.io/players/squads?team=${teamId}`
  )) as { response: Array<{ players: SquadPlayer[] }> };

  const squad = data.response?.[0]?.players ?? [];
  const enriched: SquadPlayer[] = [];

  for (const player of squad) {
    if (normalizeNationality(player.nationality) !== 'Unknown') {
      enriched.push(player);
      continue;
    }

    const profile = await fetchPlayerProfile(player.id, seasonsToTry);
    enriched.push({
      ...player,
      nationality: profile.nationality ?? player.nationality,
      age: profile.age ?? player.age,
    });
  }

  return enriched;
}

async function fetchTeamRoster(
  teamId: number,
  season: number
): Promise<{ entries: ApiPlayerEntry[]; source: 'stats' | 'squads' }> {
  const fromStats = await fetchTeamPlayersFromStats(teamId, season);
  if (fromStats.length > 0) {
    return { entries: fromStats, source: 'stats' };
  }

  const squad = await fetchTeamPlayersFromSquads(teamId, [season, season - 1]);
  const entries: ApiPlayerEntry[] = squad.map((p) => ({
    player: {
      id: p.id,
      name: p.name,
      age: p.age,
      nationality: p.nationality,
    },
    statistics: [
      {
        league: { id: 0, name: '' },
        team: { id: teamId, name: '' },
        games: {
          number: p.number,
          position: p.position,
        },
      },
    ],
  }));

  return { entries, source: 'squads' };
}

async function fetchLeagueTeams(
  leagueId: number,
  leagueName: string,
  season: number
): Promise<{ teams: Array<{ team: { id: number; name: string } }>; teamsSeason: number }> {
  for (const trySeason of [season, season - 1]) {
    const teamsData = (await fetchJson(
      `https://v3.football.api-sports.io/teams?league=${leagueId}&season=${trySeason}`
    )) as { response: Array<{ team: { id: number; name: string } }> };

    const teams = teamsData.response ?? [];
    if (teams.length > 0) {
      if (trySeason !== season) {
        console.log(`  ℹ Using ${trySeason}/${String(trySeason + 1).slice(-2)} team list (${season}/${String(season + 1).slice(-2)} not in API yet)`);
      }
      return { teams, teamsSeason: trySeason };
    }
  }

  console.warn(`  ⚠ No teams for ${leagueName} in seasons ${season} or ${season - 1}`);
  return { teams: [], teamsSeason: season };
}

async function upsertPlayer(
  values: {
    externalId: string;
    name: string;
    aliases: string[];
    nationality: string;
    position: string;
    age: number;
    currentClub: string;
    currentLeague: string;
    shirtNumber: number | null;
    searchText: string;
  },
  marketValueTier: number
) {
  await db
    .insert(players)
    .values({
      ...values,
      marketValueTier,
    })
    .onConflictDoUpdate({
      target: players.externalId,
      set: {
        name: values.name,
        aliases: values.aliases,
        nationality: values.nationality,
        position: values.position,
        age: values.age,
        currentClub: values.currentClub,
        currentLeague: values.currentLeague,
        shirtNumber: values.shirtNumber,
        searchText: values.searchText,
      },
    });
}

async function ingestLeague(leagueId: number, leagueName: string, season: number): Promise<number> {
  const { teams } = await fetchLeagueTeams(leagueId, leagueName, season);
  console.log(`  ${teams.length} teams found`);

  if (teams.length === 0) {
    return 0;
  }

  let playerCount = 0;
  let squadFallbackTeams = 0;

  for (const { team } of teams) {
    const { entries, source } = await fetchTeamRoster(team.id, season);
    if (source === 'squads') {
      squadFallbackTeams += 1;
    }

    for (const entry of entries) {
      const stats = pickStatistics(entry, team.id, leagueId);
      const identity = await resolvePlayerIdentity(entry, season);

      if (identity.nationality === 'Unknown') {
        console.warn(`  ! ${entry.player.name} (${team.name}) — nationality still missing`);
      }

      await upsertPlayer(
        {
          externalId: String(entry.player.id),
          name: identity.name,
          aliases: identity.aliases,
          nationality: identity.nationality,
          position: mapPosition(stats?.games.position),
          age: identity.age,
          currentClub: team.name,
          currentLeague: leagueName,
          shirtNumber: stats?.games.number ?? null,
          searchText: identity.searchText,
        },
        isEflLeagueId(leagueId) ? 2 : 3
      );

      console.log(`  + ${identity.name} (${team.name})`);
      playerCount += 1;
    }
  }

  if (squadFallbackTeams > 0) {
    console.log(`  ℹ ${squadFallbackTeams} teams used squad fallback (season ${season} stats not available yet)`);
  }

  console.log(`  → ${playerCount} players ingested for ${leagueName}`);
  return playerCount;
}

async function runIngest(season: number, leagues = resolveIngestLeagues()): Promise<number> {
  profileCache.clear();
  let total = 0;
  for (const league of leagues) {
    console.log(`Ingesting ${league.name}...`);
    total += await ingestLeague(league.id, league.name, season);
  }
  return total;
}

async function countPlayers(): Promise<number> {
  const rows = await db.select({ id: players.id }).from(players);
  return rows.length;
}

async function countDuplicateExternalIds(): Promise<number> {
  const rows = await db.execute<{ count: string }>(sql`
    SELECT COUNT(*)::text AS count FROM (
      SELECT external_id FROM players
      WHERE external_id IS NOT NULL
      GROUP BY external_id HAVING COUNT(*) > 1
    ) dupes
  `);
  return Number(rows[0]?.count ?? 0);
}

async function printLeagueBreakdown(): Promise<void> {
  const rows = await db.execute<{ league: string; count: string }>(sql`
    SELECT current_league AS league, COUNT(*)::text AS count
    FROM players
    GROUP BY current_league
    ORDER BY COUNT(*) DESC
  `);

  console.log('Players by league:');
  for (const row of rows) {
    console.log(`  ${row.league}: ${row.count}`);
  }
}

async function main() {
  if (!API_KEY) {
    console.log('Set API_FOOTBALL_KEY to ingest from API-Football. Use db:seed for local dev.');
    process.exit(0);
  }

  const season = resolveIngestSeason();
  const leagues = resolveIngestLeagues();
  console.log(`Using API-Football season ${season} (${season}/${String(season + 1).slice(-2)} campaign)`);
  console.log(`Leagues: ${leagues.map((l) => l.name).join(', ')}`);

  let ingested = await runIngest(season, leagues);

  if (ingested === 0 && !process.env.INGEST_SEASON) {
    const fallbackSeason = season - 1;
    console.warn('');
    console.warn(`⚠ Season ${season} returned 0 players — falling back to ${fallbackSeason}/${String(fallbackSeason + 1).slice(-2)}`);
    console.warn('  Set INGEST_SEASON=2026 to force upcoming season, or INGEST_SEASON=2025 for last completed season');
    console.warn('');
    ingested = await runIngest(fallbackSeason, leagues);
  }

  const totalInDb = await countPlayers();
  const duplicateIds = await countDuplicateExternalIds();
  console.log('');
  console.log(`Ingestion complete — ${ingested} players processed this run`);
  console.log(`Database total: ${totalInDb} unique players`);
  if (duplicateIds > 0) {
    console.warn(`⚠ ${duplicateIds} duplicate external_ids remain — run: npm run db:migrate`);
  }
  await printLeagueBreakdown();
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
