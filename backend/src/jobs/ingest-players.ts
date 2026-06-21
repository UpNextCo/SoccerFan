/**
 * Ingest players from API-Football into PostgreSQL.
 * Usage: API_FOOTBALL_KEY=xxx DATABASE_URL=xxx npm run job:ingest-players
 */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { players } from '../db/schema.js';
import { db } from '../db/index.js';

const LEAGUES = [
  { id: 39, name: 'Premier League', season: 2025 },
  { id: 140, name: 'La Liga', season: 2025 },
  { id: 135, name: 'Serie A', season: 2025 },
  { id: 78, name: 'Bundesliga', season: 2025 },
  { id: 61, name: 'Ligue 1', season: 2025 },
];

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

async function fetchTeamPlayers(teamId: number, season: number): Promise<ApiPlayerEntry[]> {
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

async function ingestLeague(leagueId: number, leagueName: string, season: number) {
  const teamsData = (await fetchJson(
    `https://v3.football.api-sports.io/teams?league=${leagueId}&season=${season}`
  )) as { response: Array<{ team: { id: number; name: string } }> };

  for (const { team } of teamsData.response ?? []) {
    const roster = await fetchTeamPlayers(team.id, season);

    for (const entry of roster) {
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
    }
  }
}

async function main() {
  if (!API_KEY) {
    console.log('Set API_FOOTBALL_KEY to ingest from API-Football. Use db:seed for local dev.');
    process.exit(0);
  }

  for (const league of LEAGUES) {
    console.log(`Ingesting ${league.name}...`);
    await ingestLeague(league.id, league.name, league.season);
  }

  console.log('Ingestion complete');
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
