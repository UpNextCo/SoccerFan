/**
 * Repair contaminated nationalities from API-Football: blank/Unknown values and the
 * stray FIFA 3-letter codes (KEN, NAM…) and variants (Holland, Türkiye) that break
 * nationality categories. The API returns canonical country names.
 *
 * Resumable / idempotent. Usage: DATABASE_URL=... API_FOOTBALL_KEY=... npm run job:backfill-nat [limit]
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { fetchFootballApi, footballApiUrl, getApiCallsUsed } from './ingest-api.js';
import { canonicalNationality } from '../utils/nationality.js';

interface ApiResp {
  response?: Array<{ player?: { nationality?: string | null } }>;
}

async function main() {
  const limit = process.argv[2] ? Number(process.argv[2]) : Number.MAX_SAFE_INTEGER;

  // Bad nationality = null/blank/Unknown, or a short all-caps code, or a known variant.
  const targets = (await db.execute(sql`
    SELECT p.id, p.external_id::int AS ext, p.nationality,
           COALESCE((SELECT MAX(season) FROM player_stats s WHERE s.player_id = p.id), 2023)::int AS season
    FROM players p
    WHERE p.external_id IS NOT NULL
      AND (
        p.nationality IS NULL OR p.nationality = '' OR p.nationality = 'Unknown'
        OR p.nationality ~ '^[A-Z]{2,3}$'
        OR p.nationality IN ('Holland', 'Türkiye')
      )
    ORDER BY (SELECT COALESCE(SUM(appearances),0) FROM player_stats s WHERE s.player_id = p.id) DESC
  `)) as unknown as Array<{ id: string; ext: number; nationality: string | null; season: number }>;

  const todo = targets.slice(0, limit);
  console.log(`Repairing nationality for ${todo.length} players (of ${targets.length} flagged)...`);

  let updated = 0;
  let unchanged = 0;
  for (let i = 0; i < todo.length; i += 1) {
    const t = todo[i]!;
    try {
      const data = (await fetchFootballApi(footballApiUrl(`/players?id=${t.ext}&season=${t.season}`))) as ApiResp;
      const nat = canonicalNationality(data.response?.[0]?.player?.nationality?.trim());
      if (nat && nat !== 'Unknown' && nat !== t.nationality) {
        await db.execute(sql`UPDATE players SET nationality = ${nat} WHERE id = ${t.id}`);
        updated += 1;
      } else {
        unchanged += 1;
      }
    } catch (error) {
      console.warn(`  ! player ${t.ext}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if ((i + 1) % 100 === 0) console.log(`  ${i + 1}/${todo.length} · updated ${updated} · api ${getApiCallsUsed()}`);
  }

  console.log(`\nDone. Updated ${updated}, unchanged ${unchanged}, API calls ${getApiCallsUsed()}.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
