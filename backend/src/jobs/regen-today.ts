/** One-shot: force-regenerate today's daily bundle (run after deleting today's daily_puzzles rows). */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { getDailyBundle } from '../services/dailyService.js';

async function main() {
  const users = (await db.execute(sql`SELECT id FROM users LIMIT 1`)) as unknown as Array<{ id: string }>;
  if (!users[0]) throw new Error('no users in DB');
  const bundle = await getDailyBundle(users[0].id);
  console.log('date:', bundle.date);
  for (const g of bundle.games) console.log('  regenerated:', g.modeId);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
