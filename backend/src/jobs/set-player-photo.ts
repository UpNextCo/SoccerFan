/**
 * Set a manual headshot for a player from a Wikimedia Commons link (wins over the API-Football
 * photo, across every game). Accepts a Commons File: page, an upload.wikimedia.org URL, a
 * Special:FilePath URL, or a bare "File.jpg" name.
 *
 * Usage:
 *   npm run job:set-photo -- "Paolo Maldini" "https://commons.wikimedia.org/wiki/File:Paolo_Maldini.jpg"
 *   npm run job:set-photo -- <player-uuid>     "<commons link>"
 *   npm run job:set-photo -- "Paolo Maldini" --clear     # remove an override
 *
 * If the name matches more than one player, it prints the candidates so you can re-run with the id.
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { commonsPhotoUrl } from '../constants/footballMedia.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function rows<T extends Record<string, unknown>>(q: ReturnType<typeof sql>): Promise<T[]> {
  return (await db.execute(q)) as unknown as T[];
}

async function main() {
  const [target, link] = [process.argv[2], process.argv[3]];
  if (!target || !link) {
    console.error('Usage: npm run job:set-photo -- "<name or uuid>" "<commons link | --clear>"');
    process.exit(1);
  }

  // Self-applying migration so this works on any environment.
  await db.execute(sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS photo_url text`);

  // Accent-insensitive match: compare both the raw name and a de-accented form, so "Luis Figo"
  // finds "Luís Figo" and "Lothar Matthaus" finds "Lothar Matthäus".
  const normTarget = target.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const candidates = UUID_RE.test(target)
    ? await rows<{ id: string; name: string; nationality: string }>(
        sql`SELECT id, name, nationality FROM players WHERE id = ${target}`
      )
    : await rows<{ id: string; name: string; nationality: string }>(sql`
        SELECT p.id, p.name, p.nationality,
          COALESCE((SELECT string_agg(DISTINCT s.team_name, ', ') FROM player_stats s
                    WHERE s.player_id = p.id AND s.league_id IN (39,140,135,78,61)), '') AS clubs
        FROM players p
        WHERE p.name ILIKE ${`%${target}%`} OR p.search_text LIKE ${`%${normTarget}%`}
        ORDER BY (SELECT COALESCE(SUM(appearances),0) FROM player_stats s WHERE s.player_id = p.id) DESC
        LIMIT 12
      `);

  if (candidates.length === 0) {
    console.error(`No player matched "${target}".`);
    process.exit(1);
  }
  if (candidates.length > 1) {
    console.log(`Multiple players matched "${target}" — re-run with the exact id:\n`);
    for (const c of candidates as Array<{ id: string; name: string; nationality: string; clubs?: string }>) {
      console.log(`  ${c.id}  ${c.name} (${c.nationality})  ${c.clubs ?? ''}`);
    }
    process.exit(1);
  }

  const player = candidates[0]!;
  const clear = link === '--clear' || link.toLowerCase() === 'clear';
  const photoUrl = clear ? null : commonsPhotoUrl(link);

  await db.execute(sql`UPDATE players SET photo_url = ${photoUrl} WHERE id = ${player.id}`);

  if (clear) {
    console.log(`Cleared photo override for ${player.name}.`);
  } else {
    console.log(`Set photo for ${player.name}:\n  ${photoUrl}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
