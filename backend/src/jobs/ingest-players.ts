/**
 * Ingest players from API-Football into PostgreSQL.
 * Usage: API_FOOTBALL_KEY=xxx DATABASE_URL=xxx npm run job:ingest-players
 */
import 'dotenv/config';
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

function mapPosition(pos: string): string {
  if (pos === 'Goalkeeper') return 'Goalkeeper';
  if (pos === 'Defender') return 'Defender';
  if (pos === 'Midfielder') return 'Midfielder';
  return 'Attacker';
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

  return res.json();
}

async function ingestLeague(leagueId: number, leagueName: string, season: number) {
  const teamsData = (await fetchJson(
    `https://v3.football.api-sports.io/teams?league=${leagueId}&season=${season}`
  )) as { response: Array<{ team: { id: number; name: string } }> };

  for (const { team } of teamsData.response ?? []) {
    const squadData = (await fetchJson(
      `https://v3.football.api-sports.io/players/squads?team=${team.id}`
    )) as {
      response: Array<{
        players: Array<{
          id: number;
          name: string;
          age: number;
          number: number | null;
          position: string;
          nationality: string;
        }>;
      }>;
    };

    const squad = squadData.response?.[0]?.players ?? [];
    for (const p of squad) {
      await db
        .insert(players)
        .values({
          externalId: String(p.id),
          name: p.name,
          aliases: buildAliases(p.name),
          nationality: p.nationality,
          position: mapPosition(p.position),
          age: p.age,
          currentClub: team.name,
          currentLeague: leagueName,
          shirtNumber: p.number,
          marketValueTier: 3,
          searchText: normalizeSearchText(p.name),
        })
        .onConflictDoNothing();

      console.log(`  + ${p.name} (${team.name})`);
    }

    await new Promise((r) => setTimeout(r, 200));
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
