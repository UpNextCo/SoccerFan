/**
 * One-time launch seed: put every user in Sunday League.
 * Does NOT create weekly tables — those form when a user first earns XP in the week.
 *
 *   DATABASE_URL=... npm run job:seed-weekly-league-divisions
 *   DATABASE_URL=... npm run job:seed-weekly-league-divisions -- --dry
 *   DATABASE_URL=... npm run job:seed-weekly-league-divisions -- --force
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { getAppMeta, setAppMeta } from '../services/leagueService.js';

const DRY = process.argv.includes('--dry');
const FORCE = process.argv.includes('--force');
const META_KEY = 'weekly_league_launch_sunday';

async function main() {
  const existing = await getAppMeta(META_KEY);
  if (existing === '1' && !FORCE) {
    console.log('Seed already applied (app_meta.weekly_league_launch_sunday=1). Pass --force to re-run.');
    process.exit(0);
  }

  const before = (await db.execute(sql`
    SELECT current_division AS division, COUNT(*)::int AS n
    FROM users
    GROUP BY current_division
    ORDER BY n DESC
  `)) as unknown as Array<{ division: string; n: number }>;

  console.log(`Resetting all users to sunday_league${DRY ? ' (DRY)' : ''}`);
  console.table(Object.fromEntries(before.map((row) => [row.division, row.n])));

  if (!DRY) {
    await db.execute(sql`
      UPDATE users SET current_division = 'sunday_league'
      WHERE current_division <> 'sunday_league'
    `);
    await setAppMeta(META_KEY, '1');
    console.log('Marked weekly_league_launch_sunday=1');
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
