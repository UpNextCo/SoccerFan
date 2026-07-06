/**
 * One-off backfill: recompute player_transfers.fee_eur_m from the stored fee_raw using the
 * fixed parser (see parse-fee.ts). Needed because the old parser treated "K" (thousands) as
 * millions, inflating ~2k fees 1000× and corrupting the Draft XI / Football Bingo transfer-fee
 * stats. fee_raw is fully persisted, so this needs no re-scrape.
 *
 * Usage: npm run job:reparse-fees
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { parseTransferFeeEurM } from './parse-fee.js';

export async function reparseFees(): Promise<{ distinct: number; updated: number }> {
  // Distinct raw strings only — far fewer than the ~95k rows, so we run one UPDATE per raw value.
  const rows = (await db.execute(
    sql`SELECT DISTINCT fee_raw FROM player_transfers WHERE fee_raw IS NOT NULL`
  )) as unknown as Array<{ fee_raw: string }>;

  let updated = 0;
  for (const { fee_raw } of rows) {
    const parsed = parseTransferFeeEurM(fee_raw);
    const value = parsed === null ? null : parsed.toFixed(2);
    const res = (await db.execute(
      sql`UPDATE player_transfers
          SET fee_eur_m = ${value}, updated_at = now()
          WHERE fee_raw = ${fee_raw}
            AND fee_eur_m IS DISTINCT FROM ${value}::numeric`
    )) as unknown as { count?: number };
    updated += res?.count ?? 0;
  }

  return { distinct: rows.length, updated };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  reparseFees()
    .then(async ({ distinct, updated }) => {
      const max = (await db.execute(
        sql`SELECT MAX(fee_eur_m) AS max FROM player_transfers`
      )) as unknown as Array<{ max: string | null }>;
      console.log(`Reparsed fees — ${distinct} distinct raw values, ${updated} rows updated`);
      console.log(`Max fee_eur_m now: ${max[0]?.max ?? 'n/a'} (expect ~222, not ~995)`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
