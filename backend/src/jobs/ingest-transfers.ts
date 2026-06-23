/**
 * Ingest transfer history into player_transfers.
 * Usage: INGEST_LEAGUE_IDS=39 npm run job:ingest-transfers
 */
import 'dotenv/config';
import { fetchFootballApi, footballApiUrl } from './ingest-api.js';
import { beginIngestRun, finishIngestRun } from './ingest-run.js';
import { isTruthyEnv, loadIngestPlayers } from './ingest-player-map.js';
import { classifyTransferType, parseTransferFeeEurM } from './parse-fee.js';
import { db } from '../db/index.js';
import { playerTransfers } from '../db/schema.js';
import { toTeamId } from './ingest-parse.js';

type TransferEntry = {
  date: string | null;
  type: string | null;
  teams: {
    in: { id: number | string | null; name: string | null };
    out: { id: number | string | null; name: string | null };
  };
};

export async function runIngestTransfers(): Promise<number> {
  const runId = await beginIngestRun('ingest-transfers');
  let total = 0;

  try {
    let players = await loadIngestPlayers();
    if (isTruthyEnv(process.env.INGEST_SKIP_ENRICHED)) {
      const enriched = new Set(
        (await db.selectDistinct({ pid: playerTransfers.playerId }).from(playerTransfers)).map((r) => r.pid)
      );
      const before = players.length;
      players = players.filter((p) => !enriched.has(p.id));
      console.log(`Skip-enriched: ${before - players.length} already have transfer rows, ${players.length} remaining`);
    }
    console.log(`Fetching transfers for ${players.length} players...`);

    for (const player of players) {
      const data = (await fetchFootballApi(
        footballApiUrl(`/transfers?player=${player.externalId}`)
      )) as { response: Array<{ transfers: TransferEntry[] }> };

      const transfers = data.response?.[0]?.transfers ?? [];
      for (const transfer of transfers) {
        const feeRaw = transfer.type;
        await db
          .insert(playerTransfers)
          .values({
            playerId: player.id,
            transferDate: transfer.date ?? null,
            fromTeamId: toTeamId(transfer.teams.out.id),
            fromTeamName: transfer.teams.out.name,
            toTeamId: toTeamId(transfer.teams.in.id),
            toTeamName: transfer.teams.in.name,
            feeRaw,
            feeEurM: parseTransferFeeEurM(feeRaw)?.toString() ?? null,
            transferType: classifyTransferType(feeRaw),
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [
              playerTransfers.playerId,
              playerTransfers.transferDate,
              playerTransfers.fromTeamId,
              playerTransfers.toTeamId,
            ],
            set: {
              feeRaw,
              feeEurM: parseTransferFeeEurM(feeRaw)?.toString() ?? null,
              transferType: classifyTransferType(feeRaw),
              updatedAt: new Date(),
            },
          });

        total += 1;
      }
    }

    await finishIngestRun(runId, 'success', total);
    return total;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishIngestRun(runId, 'failed', total, message);
    throw error;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runIngestTransfers()
    .then((total) => {
      console.log(`Transfers ingest complete — ${total} rows upserted`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
