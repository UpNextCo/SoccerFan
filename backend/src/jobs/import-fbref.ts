/**
 * Import the FBref historical backfill JSON (produced by scripts/fbref_backfill.py)
 * into players + player_stats. Pre-2010 big-5 history so legends are valid answers
 * and "top scorers / 20+ goals for X" puzzles work historically.
 *
 * Dedupes against existing players by normalized name (players who continued past
 * 2010 just get their earlier seasons added; pre-2010-only players are created).
 *
 * Usage: DATABASE_URL=... npm run job:import-fbref [path/to/fbref_backfill.json]
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { players, playerStats } from '../db/schema.js';
import { buildPlayerSearchFields, normalizeSearchText } from '../utils/playerSearch.js';
import { canonicalNationality } from '../utils/nationality.js';

interface FbrefRow {
  player: string;
  team: string;
  nation: string | null;
  pos: string;
  age: number;
  leagueId: number;
  leagueName: string;
  season: number;
  games: number;
  minutes: number;
  goals: number;
  assists: number;
  yellow: number;
  red: number;
}

const NATION_BY_CODE: Record<string, string> = {
  ENG: 'England', SCO: 'Scotland', WAL: 'Wales', NIR: 'Northern Ireland', IRL: 'Ireland',
  FRA: 'France', ESP: 'Spain', GER: 'Germany', ITA: 'Italy', POR: 'Portugal', NED: 'Netherlands',
  BEL: 'Belgium', BRA: 'Brazil', ARG: 'Argentina', URU: 'Uruguay', COL: 'Colombia', CHI: 'Chile',
  MEX: 'Mexico', USA: 'USA', CRC: 'Costa Rica', CAN: 'Canada',
  CRO: 'Croatia', SRB: 'Serbia', SUI: 'Switzerland', SWE: 'Sweden', NOR: 'Norway', DEN: 'Denmark',
  POL: 'Poland', CZE: 'Czech Republic', AUT: 'Austria', GRE: 'Greece', RUS: 'Russia', UKR: 'Ukraine',
  TUR: 'Turkey', ROU: 'Romania', HUN: 'Hungary', BUL: 'Bulgaria', SVK: 'Slovakia', SVN: 'Slovenia',
  BIH: 'Bosnia and Herzegovina', ALB: 'Albania', FIN: 'Finland', ISL: 'Iceland', MKD: 'North Macedonia',
  NGA: 'Nigeria', GHA: 'Ghana', CIV: 'Ivory Coast', SEN: 'Senegal', CMR: 'Cameroon', EGY: 'Egypt',
  MAR: 'Morocco', ALG: 'Algeria', TUN: 'Tunisia', RSA: 'South Africa', MLI: 'Mali', GAB: 'Gabon',
  COD: 'DR Congo', GUI: 'Guinea',
  JPN: 'Japan', KOR: 'South Korea', AUS: 'Australia', IRN: 'Iran', KSA: 'Saudi Arabia',
};

function mapNation(code: string | null): string {
  if (!code) return 'Unknown';
  // NATION_BY_CODE covers common codes; canonicalNationality fixes the rest (FIFA codes,
  // Ireland→Republic of Ireland, Ivory Coast→Côte d'Ivoire) so all sources agree.
  return canonicalNationality(NATION_BY_CODE[code.toUpperCase()] ?? code.toUpperCase());
}

function mapPosition(pos: string): string {
  const first = (pos || '').split(',')[0]?.trim().toUpperCase() ?? '';
  if (first.startsWith('GK')) return 'Goalkeeper';
  if (first.startsWith('DF')) return 'Defender';
  if (first.startsWith('FW')) return 'Attacker';
  if (first.startsWith('MF')) return 'Midfielder';
  return 'Midfielder';
}

/** Stable synthetic team id (offset away from real api-football ids) so a player
 *  with two clubs in one league-season keeps both rows under the unique index. */
function syntheticTeamId(teamName: string): number {
  const norm = normalizeSearchText(teamName);
  let hash = 0;
  for (let i = 0; i < norm.length; i += 1) {
    hash = (hash * 31 + norm.charCodeAt(i)) | 0;
  }
  return 900_000_000 + (Math.abs(hash) % 90_000_000);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  const path = process.argv[2] ?? 'fbref_backfill.json';
  const rows: FbrefRow[] = JSON.parse(readFileSync(path, 'utf8'));
  console.log(`Loaded ${rows.length} FBref rows from ${path}`);

  // Existing players → match by normalized name so legends merge instead of duplicating.
  const existing = await db.select({ id: players.id, name: players.name }).from(players);
  const nameToId = new Map<string, string>();
  for (const p of existing) nameToId.set(normalizeSearchText(p.name), p.id);
  console.log(`${existing.length} existing players loaded for dedupe`);

  // Group by player; latest season drives profile fields (club/league/age/position).
  const byPlayer = new Map<string, FbrefRow[]>();
  for (const row of rows) {
    const key = normalizeSearchText(row.player);
    if (!key) continue;
    let list = byPlayer.get(key);
    if (!list) {
      list = [];
      byPlayer.set(key, list);
    }
    list.push(row);
  }

  let created = 0;
  for (const [key, group] of byPlayer) {
    if (nameToId.has(key)) continue;
    const latest = group.reduce((a, b) => (b.season > a.season ? b : a));
    const fields = buildPlayerSearchFields(latest.player);
    const inserted = await db
      .insert(players)
      .values({
        externalId: null,
        name: fields.name,
        aliases: fields.aliases,
        nationality: mapNation(latest.nation),
        position: mapPosition(latest.pos),
        age: latest.age > 0 ? latest.age : 25,
        currentClub: latest.team || 'Unknown',
        currentLeague: latest.leagueName,
        marketValueTier: 3,
        searchText: fields.searchText,
      })
      .returning({ id: players.id });
    nameToId.set(key, inserted[0]!.id);
    created += 1;
  }
  console.log(`Created ${created} new historical players`);

  const statValues = rows
    .map((row) => {
      const playerId = nameToId.get(normalizeSearchText(row.player));
      if (!playerId) return null;
      return {
        playerId,
        externalPlayerId: null,
        leagueId: row.leagueId,
        leagueName: row.leagueName,
        season: row.season,
        teamId: syntheticTeamId(row.team || row.leagueName),
        teamName: row.team || null,
        appearances: row.games,
        minutes: row.minutes,
        goals: row.goals,
        assists: row.assists,
        yellowCards: row.yellow,
        redCards: row.red,
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  // Gap-fill guard: skip any (player, league, season) the player ALREADY has — FBref uses
  // synthetic team ids, so without this a re-run for years already covered by API-Football
  // would create a second row and double-count apps. This lets us safely re-scrape ANY
  // year range to fill holes (e.g. Lampard/Gerrard's missing 2010-2014 league seasons).
  const existingStats = (await db.execute(sql`SELECT player_id, league_id, season FROM player_stats`)) as unknown as Array<{ player_id: string; league_id: number; season: number }>;
  const have = new Set(existingStats.map((e) => `${e.player_id}|${e.league_id}|${e.season}`));
  const fresh = statValues.filter((v) => !have.has(`${v.playerId}|${v.leagueId}|${v.season}`));
  console.log(`${statValues.length} rows · ${fresh.length} fill gaps (${statValues.length - fresh.length} league-seasons already present)`);

  let upserted = 0;
  for (const batch of chunk(fresh, 500)) {
    await db.insert(playerStats).values(batch).onConflictDoNothing();
    upserted += batch.length;
  }
  console.log(`Upserted ${upserted} historical stat rows.`);
  console.log('Done. Re-run job:import-transfermarkt + job:compute-fame to refresh fame tiers.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
