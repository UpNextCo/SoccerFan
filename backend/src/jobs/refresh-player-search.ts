/**
 * Backfill display names + search aliases for ingested players.
 * Usage: DATABASE_URL=... API_FOOTBALL_KEY=... npm run job:refresh-player-search
 */
import 'dotenv/config';
import { eq, isNotNull } from 'drizzle-orm';
import { fetchFootballApi, footballApiUrl } from './ingest-api.js';
import { resolveIngestLeagues, resolveIngestSeason } from './ingest-config.js';
import { db } from '../db/index.js';
import { players } from '../db/schema.js';
import { buildPlayerSearchFields, isAbbreviatedName } from '../utils/playerSearch.js';

type ApiPlayerEntry = {
  player: {
    id: number;
    name: string;
    firstname?: string | null;
    lastname?: string | null;
  };
};

async function fetchNameParts(
  externalId: string,
  seasons: number[]
): Promise<{
  firstname: string | null;
  lastname: string | null;
  apiName: string;
  abbreviatedName: string | null;
}> {
  for (const season of seasons) {
    const data = (await fetchFootballApi(
      footballApiUrl(`/players?id=${externalId}&season=${season}`)
    )) as { response: ApiPlayerEntry[] };

    const entry = data.response?.[0];
    if (entry?.player) {
      return {
        apiName: entry.player.name,
        firstname: entry.player.firstname?.trim() || null,
        lastname: entry.player.lastname?.trim() || null,
        abbreviatedName: isAbbreviatedName(entry.player.name)
          ? entry.player.name.trim()
          : null,
      };
    }
  }

  return { apiName: '', firstname: null, lastname: null, abbreviatedName: null };
}

function needsDisplayRefresh(name: string, searchText: string): boolean {
  if (isAbbreviatedName(name)) return true;
  if (name.split(/\s+/).length >= 3) return true;
  if (!searchText.includes(' ')) return true;
  if ((name.split(/\s+/)[0]?.length ?? 0) <= 2) return true;
  return false;
}

async function main() {
  const season = resolveIngestSeason();
  const seasons = [season, season - 1, season - 2];

  const scoped = Boolean(process.env.INGEST_LEAGUE_IDS?.trim());
  const leagueNames = scoped ? new Set(resolveIngestLeagues().map((l) => l.name)) : null;

  const rows = await db
    .select({
      id: players.id,
      externalId: players.externalId,
      name: players.name,
      searchText: players.searchText,
      aliases: players.aliases,
      currentLeague: players.currentLeague,
    })
    .from(players)
    .where(isNotNull(players.externalId));

  const candidates = rows.filter((row) => {
    if (!row.externalId) return false;
    if (leagueNames && !leagueNames.has(row.currentLeague)) return false;
    return needsDisplayRefresh(row.name, row.searchText);
  });

  let updated = 0;

  console.log(
    `Checking ${candidates.length} of ${rows.length} ingested players for display names` +
      (scoped ? ` (scoped to ${[...leagueNames!].join(', ')})` : '') +
      '...'
  );

  for (const row of candidates) {
    if (!row.externalId) continue;

    const parts = await fetchNameParts(row.externalId, seasons);
    const searchFields = buildPlayerSearchFields(
      parts.apiName || row.name,
      parts.firstname,
      parts.lastname,
      parts.abbreviatedName
    );

    const changed =
      searchFields.name !== row.name ||
      searchFields.searchText !== row.searchText ||
      JSON.stringify(searchFields.aliases) !== JSON.stringify(row.aliases);

    if (!changed && !needsDisplayRefresh(row.name, row.searchText)) {
      continue;
    }

    if (
      searchFields.name === row.name &&
      searchFields.searchText === row.searchText &&
      JSON.stringify(searchFields.aliases) === JSON.stringify(row.aliases)
    ) {
      continue;
    }

    await db
      .update(players)
      .set({
        name: searchFields.name,
        aliases: searchFields.aliases,
        searchText: searchFields.searchText,
      })
      .where(eq(players.id, row.id));

    updated += 1;
    if (row.name !== searchFields.name) {
      console.log(`  ${row.name} → ${searchFields.name}`);
    }
  }

  console.log(`Refresh complete — ${updated} players updated`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
