/**
 * Backfill first names / search aliases for existing players (e.g. H. Kane → Harry Kane).
 * Usage: DATABASE_URL=... API_FOOTBALL_KEY=... npm run job:refresh-player-search
 */
import 'dotenv/config';
import { eq, isNotNull } from 'drizzle-orm';
import { fetchFootballApi, footballApiUrl } from './ingest-api.js';
import { resolveIngestSeason } from './ingest-config.js';
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
): Promise<{ firstname: string | null; lastname: string | null; apiName: string }> {
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
      };
    }
  }

  return { apiName: '', firstname: null, lastname: null };
}

async function main() {
  const season = resolveIngestSeason();
  const seasons = [season, season - 1, season - 2];

  const rows = await db
    .select({
      id: players.id,
      externalId: players.externalId,
      name: players.name,
      searchText: players.searchText,
    })
    .from(players)
    .where(isNotNull(players.externalId));

  let updated = 0;

  console.log(`Checking ${rows.length} players for abbreviated names...`);

  for (const row of rows) {
    if (!row.externalId) continue;

    const needsRefresh =
      isAbbreviatedName(row.name) ||
      !row.searchText.includes(' ') ||
      (row.name.split(/\s+/)[0]?.length ?? 0) <= 2;

    if (!needsRefresh) continue;

    const parts = await fetchNameParts(row.externalId, seasons);
    const searchFields = buildPlayerSearchFields(
      parts.apiName || row.name,
      parts.firstname,
      parts.lastname
    );

    if (searchFields.searchText === row.searchText && searchFields.name === row.name) {
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
    console.log(`  ${row.name} → ${searchFields.name}`);
  }

  console.log(`Refresh complete — ${updated} players updated`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
