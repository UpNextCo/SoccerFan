/**
 * Backfill players.birth_date from API-Football. DOB is the reliable identity key
 * for name reconciliation + de-dup (popular nicknames like "Isco" only match
 * Transfermarkt by DOB + nationality).
 *
 * Resumable: only fetches players with external_id and a NULL birth_date.
 * Idempotent + safe to re-run after rate limits / crashes.
 *
 * Usage: DATABASE_URL=... API_FOOTBALL_KEY=... npm run job:backfill-dob [limit]
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { fetchFootballApi, footballApiUrl, getApiCallsUsed } from './ingest-api.js';

interface ApiPlayerResponse {
  response?: Array<{ player?: { birth?: { date?: string | null } } }>;
}

async function main() {
  const limit = process.argv[2] ? Number(process.argv[2]) : Number.MAX_SAFE_INTEGER;

  // Players needing DOB, with the most recent season we have stats for (guarantees
  // the season query returns a row). Players with no stats fall back to 2023.
  const targets = (await db.execute(sql`
    SELECT p.id, p.external_id::int AS ext,
           COALESCE((SELECT MAX(season) FROM player_stats s WHERE s.player_id = p.id), 2023)::int AS season
    FROM players p
    WHERE p.external_id IS NOT NULL AND p.birth_date IS NULL
    ORDER BY (SELECT COALESCE(SUM(appearances), 0) FROM player_stats s WHERE s.player_id = p.id) DESC
  `)) as unknown as Array<{ id: string; ext: number; season: number }>;

  const todo = targets.slice(0, limit);
  console.log(`Backfilling DOB for ${todo.length} players (of ${targets.length} missing)...`);

  let updated = 0;
  let missing = 0;
  for (let i = 0; i < todo.length; i += 1) {
    const t = todo[i]!;
    try {
      const data = (await fetchFootballApi(
        footballApiUrl(`/players?id=${t.ext}&season=${t.season}`)
      )) as ApiPlayerResponse;
      const dob = data.response?.[0]?.player?.birth?.date ?? null;
      if (dob) {
        // Derive age from the DOB we just learned so the stored age can't drift stale
        // (the API's `age` is only a scrape-time snapshot).
        await db.execute(sql`
          UPDATE players
          SET birth_date = ${dob}, age = date_part('year', age(${dob}::date))::int
          WHERE id = ${t.id}
        `);
        updated += 1;
      } else {
        missing += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`  ! player ${t.ext}: ${message}`);
    }

    if ((i + 1) % 100 === 0) {
      console.log(`  ${i + 1}/${todo.length} · updated ${updated} · no-dob ${missing} · api calls ${getApiCallsUsed()}`);
    }
  }

  console.log(`\nDone. Updated ${updated}, no DOB returned ${missing}, API calls ${getApiCallsUsed()}.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
