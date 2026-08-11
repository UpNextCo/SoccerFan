/**
 * One-time launch seed: place existing users into pyramid divisions by lifetime XP percentile.
 * Does NOT create weekly tables — those form when a user first earns XP in the week.
 *
 *   DATABASE_URL=... npm run job:seed-weekly-league-divisions
 *   DATABASE_URL=... npm run job:seed-weekly-league-divisions -- --dry
 *   DATABASE_URL=... npm run job:seed-weekly-league-divisions -- --force
 */
import 'dotenv/config';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import {
  divisionForLifetimePercentile,
  getAppMeta,
  setAppMeta,
} from '../services/leagueService.js';

const DRY = process.argv.includes('--dry');
const FORCE = process.argv.includes('--force');
const META_KEY = 'weekly_league_divisions_seeded';

async function main() {
  const existing = await getAppMeta(META_KEY);
  if (existing === '1' && !FORCE) {
    console.log('Seed already applied (app_meta.weekly_league_divisions_seeded=1). Pass --force to re-run.');
    process.exit(0);
  }

  const rows = (await db.execute(sql`
    SELECT u.id, COALESCE(p.xp, 0)::int AS xp
    FROM users u
    LEFT JOIN user_progress p ON p.user_id = u.id
    WHERE COALESCE(p.xp, 0) > 0
    ORDER BY xp DESC, u.id ASC
  `)) as unknown as Array<{ id: string; xp: number }>;

  console.log(`Seeding divisions for ${rows.length} users with XP > 0${DRY ? ' (DRY)' : ''}`);

  const counts: Record<string, number> = {};
  for (let i = 0; i < rows.length; i += 1) {
    const division = divisionForLifetimePercentile(i, rows.length);
    counts[division] = (counts[division] ?? 0) + 1;
    if (DRY) continue;
    await db.update(users).set({ currentDivision: division }).where(eq(users.id, rows[i]!.id));
  }

  console.table(counts);

  if (!DRY) {
    await setAppMeta(META_KEY, '1');
    console.log('Marked weekly_league_divisions_seeded=1');
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
