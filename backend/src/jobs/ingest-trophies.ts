/**
 * Ingest trophy history into player_honours from API-Football `/trophies`.
 *
 * Usage:
 *   INGEST_ALL_PLAYERS=1 npm run job:ingest-trophies
 *
 * Flags:
 *   INGEST_ALL_PLAYERS=1     — every player with an external_id (not just current big-5)
 *   INGEST_SKIP_ENRICHED=1   — skip players who already have ANY honour row (legacy; prefer thin refresh)
 *   INGEST_REFRESH_THIN=1    — re-fetch players with fewer than INGEST_THIN_HONOURS_MAX rows
 *                              (default 8). Fixes the "partial first fetch locked forever" trap.
 *   INGEST_THIN_HONOURS_MAX  — threshold for thin refresh (default 8)
 *   INGEST_FAME_MIN=N        — with REFRESH_THIN, only players with market_value_tier >= N
 *   INGEST_PLAYER_IDS=uuid,uuid — only these players (spot-fix / Giggs check)
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { fetchFootballApi, footballApiUrl } from './ingest-api.js';
import { beginIngestRun, finishIngestRun } from './ingest-run.js';
import { isTruthyEnv, loadIngestPlayers, type PlayerRef } from './ingest-player-map.js';
import { db } from '../db/index.js';
import { playerHonours } from '../db/schema.js';

type TrophyEntry = {
  league: string;
  country: string;
  season: string;
  place: string;
};

const THIN_MAX = Number(process.env.INGEST_THIN_HONOURS_MAX ?? 8);

async function loadThinPlayerIds(): Promise<Set<string>> {
  const fameMin = process.env.INGEST_FAME_MIN ? Number(process.env.INGEST_FAME_MIN) : null;
  const rows = (await db.execute(
    fameMin != null && Number.isFinite(fameMin)
      ? sql`
          SELECT p.id
          FROM players p
          LEFT JOIN player_honours h ON h.player_id = p.id
          WHERE p.external_id IS NOT NULL AND p.market_value_tier >= ${fameMin}
          GROUP BY p.id
          HAVING COUNT(h.id) < ${THIN_MAX}
        `
      : sql`
          SELECT p.id
          FROM players p
          LEFT JOIN player_honours h ON h.player_id = p.id
          WHERE p.external_id IS NOT NULL
          GROUP BY p.id
          HAVING COUNT(h.id) < ${THIN_MAX}
        `
  )) as unknown as Array<{ id: string }>;
  return new Set(rows.map((r) => r.id));
}

export async function runIngestTrophies(): Promise<number> {
  const runId = await beginIngestRun('ingest-trophies');
  let total = 0;

  try {
    let players = await loadIngestPlayers();

    const onlyIds = (process.env.INGEST_PLAYER_IDS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (onlyIds.length > 0) {
      const want = new Set(onlyIds);
      players = players.filter((p) => want.has(p.id));
      console.log(`INGEST_PLAYER_IDS: limited to ${players.length} players`);
    }

    if (isTruthyEnv(process.env.INGEST_REFRESH_THIN)) {
      const thin = await loadThinPlayerIds();
      const before = players.length;
      players = players.filter((p) => thin.has(p.id));
      console.log(
        `Refresh-thin (<${THIN_MAX} honour rows): ${before - players.length} skipped as complete, ${players.length} to re-fetch`
      );
    } else if (isTruthyEnv(process.env.INGEST_SKIP_ENRICHED)) {
      // Legacy: any row = done. Prefer INGEST_REFRESH_THIN — this flag permanently locks
      // partial cabinets (e.g. Giggs with only 2 CL rows).
      const enriched = new Set(
        (await db.selectDistinct({ pid: playerHonours.playerId }).from(playerHonours)).map((r) => r.pid)
      );
      const before = players.length;
      players = players.filter((p) => !enriched.has(p.id));
      console.log(`Skip-enriched: ${before - players.length} already have honours rows, ${players.length} remaining`);
    }

    console.log(`Fetching trophies for ${players.length} players...`);

    for (const player of players) {
      total += await ingestPlayerTrophies(player);
    }

    await finishIngestRun(runId, 'success', total);
    return total;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishIngestRun(runId, 'failed', total, message);
    throw error;
  }
}

async function ingestPlayerTrophies(player: PlayerRef): Promise<number> {
  const data = (await fetchFootballApi(
    footballApiUrl(`/trophies?player=${player.externalId}`)
  )) as {
    response: Array<{
      league?: string;
      country?: string;
      season?: string | number;
      place?: string;
      trophies?: TrophyEntry[];
    }>;
  };

  const raw = data.response ?? [];
  const list =
    raw[0]?.trophies ??
    (raw.length > 0 && raw[0]?.league ? raw : []);

  let n = 0;
  for (const trophy of list as Array<{
    league?: string;
    country?: string;
    season?: string | number;
    place?: string;
  }>) {
    if (!trophy?.league || trophy.season == null) continue;

    const placement = trophy.place ?? 'Winner';

    await db
      .insert(playerHonours)
      .values({
        playerId: player.id,
        competition: trophy.league,
        country: trophy.country ?? null,
        season: String(trophy.season),
        placement,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          playerHonours.playerId,
          playerHonours.competition,
          playerHonours.season,
          playerHonours.placement,
        ],
        set: {
          country: trophy.country ?? null,
          updatedAt: new Date(),
        },
      });

    n += 1;
  }
  return n;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runIngestTrophies()
    .then((total) => {
      console.log(`Trophies ingest complete — ${total} rows upserted`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
