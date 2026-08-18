import { isNotNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { players } from '../db/schema.js';
import { LEAGUE_ID_BY_NAME, resolveIngestLeagues } from './ingest-config.js';

export type PlayerRef = {
  id: string;
  externalId: string;
  name: string;
  currentLeague: string;
};

export function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

export async function loadIngestPlayers(): Promise<PlayerRef[]> {
  // INGEST_ALL_PLAYERS=1 enriches every stored player (not just current top-5-league
  // players) — required to reach full coverage of the historical 2010+ player set.
  const includeAll = isTruthyEnv(process.env.INGEST_ALL_PLAYERS);
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
    .filter((row) => includeAll || leagueNames.has(row.currentLeague));
}

export function leagueIdForName(name: string): number | undefined {
  return LEAGUE_ID_BY_NAME[name];
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
