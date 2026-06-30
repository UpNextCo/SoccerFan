import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

/**
 * Manual headshot overrides (players.photo_url) — e.g. Wikipedia Commons photos set for legends who
 * don't have a good API-Football photo. Small table; cached briefly so generators can call freely.
 */
let cache: { at: number; map: Map<string, string> } | null = null;
const TTL_MS = 60_000;

export async function getPhotoOverrides(): Promise<Map<string, string>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.map;
  try {
    const rows = (await db.execute(
      sql`SELECT id, photo_url FROM players WHERE photo_url IS NOT NULL AND photo_url <> ''`
    )) as unknown as Array<{ id: string; photo_url: string }>;
    const map = new Map(rows.map((r) => [r.id, r.photo_url]));
    cache = { at: Date.now(), map };
    return map;
  } catch {
    // Column may not exist yet (pre-migration) — behave as "no overrides".
    return new Map();
  }
}
