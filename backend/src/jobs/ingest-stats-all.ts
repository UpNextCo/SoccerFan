/**
 * Run all stats-related ingest jobs in quota-friendly order.
 * Usage: INGEST_LEAGUE_IDS=39 INGEST_SEASONS_BACK=2 npm run job:ingest-stats-all
 */
import 'dotenv/config';
import { getApiCallsUsed, resetApiCallsUsed } from './ingest-api.js';
import { runIngestStats } from './ingest-stats.js';
import { runIngestTransfers } from './ingest-transfers.js';
import { runIngestTrophies } from './ingest-trophies.js';
import { runIngestCareer } from './ingest-career.js';

async function main() {
  resetApiCallsUsed();

  const stats = await runIngestStats();
  console.log('');

  const transfers = await runIngestTransfers();
  console.log('');

  const trophies = await runIngestTrophies();
  console.log('');

  const career = await runIngestCareer();
  console.log('');

  console.log('All stats ingests complete');
  console.log(`  Stats rows: ${stats}`);
  console.log(`  Transfers rows: ${transfers}`);
  console.log(`  Trophies rows: ${trophies}`);
  console.log(`  Career rows: ${career}`);
  console.log(`  API calls (approx): ${getApiCallsUsed()}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
