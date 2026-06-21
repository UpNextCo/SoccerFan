import { isNotNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { players } from '../db/schema.js';
import { INGEST_LEAGUES, resolveIngestLeagues } from './ingest-config.js';

export type PlayerRef = {
  id: string;
  externalId: string;
  name: string;
  currentLeague: string;
};

export async function loadIngestPlayers(): Promise<PlayerRef[]> {
  const leagues = resolveIngestLeagues();
  const leagueNames = new Set<string>(leagues.map((l) => l.name));

  const rows = await db
    .select({
      id: players.id,
      externalId: players.externalId,
      name: players.name,
      currentLeague: players.currentLeague,
    })
    .from(players);

  return rows
    .filter((row): row is PlayerRef => Boolean(row.externalId))
    .filter((row) => leagueNames.has(row.currentLeague));
}

export function leagueIdForName(name: string): number | undefined {
  return INGEST_LEAGUES.find((l) => l.name === name)?.id;
}

export async function loadExternalIdMap(): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: players.id, externalId: players.externalId })
    .from(players)
    .where(isNotNull(players.externalId));

  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.externalId) map.set(row.externalId, row.id);
  }
  return map;
}
