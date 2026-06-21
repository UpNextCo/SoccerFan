/**
 * Ingest players from API-Football into PostgreSQL.
 * Usage: API_FOOTBALL_KEY=xxx DATABASE_URL=xxx npm run job:ingest-players
 */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { INGEST_LEAGUES, resolveIngestSeason } from './ingest-config.js';
import { players } from '../db/schema.js';
import { db } from '../db/index.js';

const API_KEY = process.env.API_FOOTBALL_KEY;
const REQUEST_DELAY_MS = 250;

type ApiPlayerEntry = {
  player: {
    id: number;
    name: string;
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

const profileCache = new Map<number, { nationality: string | null; age: number | null }>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeSearchText(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function buildAliases(name: string): string[] {
  const parts = name.split(' ');
  const aliases = [name];
  if (parts.length > 1) {
    aliases.push(parts[parts.length - 1]!);
  }
  return aliases;
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
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : 'Unknown';
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
): Promise<{ nationality: string | null; age: number | null }> {
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
      };
      profileCache.set(playerId, profile);
      return profile;
    }
  }

  const empty = { nationality: null, age: null };
  profileCache.set(playerId, empty);
  return empty;
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

async function upsertPlayer(values: {
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
}) {
  const existing = await db
    .select({ id: players.id })
    .from(players)
    .where(eq(players.externalId, values.externalId))
    .limit(1);

  if (existing[0]) {
    await db
      .update(players)
      .set({
        name: values.name,
        aliases: values.aliases,
        nationality: values.nationality,
        position: values.position,
        age: values.age,
        currentClub: values.currentClub,
        currentLeague: values.currentLeague,
        shirtNumber: values.shirtNumber,
        searchText: values.searchText,
      })
      .where(eq(players.id, existing[0].id));
    return;
  }

  await db.insert(players).values({
    ...values,
    marketValueTier: 3,
  });
}

async function ingestLeague(leagueId: number, leagueName: string, season: number): Promise<number> {
  const teamsData = (await fetchJson(
    `https://v3.football.api-sports.io/teams?league=${leagueId}&season=${season}`
  )) as { response: Array<{ team: { id: number; name: string } }> };

  const teams = teamsData.response ?? [];
  console.log(`  ${teams.length} teams found`);

  if (teams.length === 0) {
    console.warn(`  ⚠ No teams for ${leagueName} in season ${season} — API may not have this season yet`);
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
      const nationality = normalizeNationality(entry.player.nationality);

      if (nationality === 'Unknown') {
        console.warn(`  ! ${entry.player.name} (${team.name}) — nationality still missing`);
      }

      await upsertPlayer({
        externalId: String(entry.player.id),
        name: entry.player.name,
        aliases: buildAliases(entry.player.name),
        nationality,
        position: mapPosition(stats?.games.position),
        age: normalizeAge(entry.player.age),
        currentClub: team.name,
        currentLeague: leagueName,
        shirtNumber: stats?.games.number ?? null,
        searchText: normalizeSearchText(entry.player.name),
      });

      console.log(`  + ${entry.player.name} (${team.name})`);
      playerCount += 1;
    }
  }

  if (squadFallbackTeams > 0) {
    console.log(`  ℹ ${squadFallbackTeams} teams used squad fallback (season ${season} stats not available yet)`);
  }

  console.log(`  → ${playerCount} players ingested for ${leagueName}`);
  return playerCount;
}

async function runIngest(season: number): Promise<number> {
  profileCache.clear();
  let total = 0;
  for (const league of INGEST_LEAGUES) {
    console.log(`Ingesting ${league.name}...`);
    total += await ingestLeague(league.id, league.name, season);
  }
  return total;
}

async function countPlayers(): Promise<number> {
  const rows = await db.select({ id: players.id }).from(players);
  return rows.length;
}

async function main() {
  if (!API_KEY) {
    console.log('Set API_FOOTBALL_KEY to ingest from API-Football. Use db:seed for local dev.');
    process.exit(0);
  }

  const season = resolveIngestSeason();
  console.log(`Using API-Football season ${season} (${season}/${String(season + 1).slice(-2)} campaign)`);

  let ingested = await runIngest(season);

  if (ingested === 0 && !process.env.INGEST_SEASON) {
    const fallbackSeason = season - 1;
    console.warn('');
    console.warn(`⚠ Season ${season} returned 0 players — falling back to ${fallbackSeason}/${String(fallbackSeason + 1).slice(-2)}`);
    console.warn('  Set INGEST_SEASON=2026 to force upcoming season, or INGEST_SEASON=2025 for last completed season');
    console.warn('');
    ingested = await runIngest(fallbackSeason);
  }

  const totalInDb = await countPlayers();
  console.log('');
  console.log(`Ingestion complete — ${ingested} players processed this run`);
  console.log(`Database total: ${totalInDb} players`);
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
