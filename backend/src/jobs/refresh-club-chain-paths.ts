/**
 * Refresh the stored "one optimal route" (and par) on existing Club Chain puzzles.
 *
 * Each puzzle caches a shortest teammate path as its par and one example route. Correcting club
 * history moves that graph: a route can rely on a link that no longer exists, and the par itself can
 * shrink. Unlike `regenerate-club-chain`, this keeps the SAME start and target, so a puzzle already in
 * front of players is not swapped out from under them — only its cached answer is brought back in
 * line. Locked puzzles are skipped, and approved ones need --force.
 *
 * A stale route does not mis-score anyone (scoring re-derives every link from the player's own moves),
 * but it does fail admin validation and misleads anyone reviewing the day.
 *
 * Usage:
 *   npm run job:refresh-club-chain-paths                    # dry run, today onward
 *   npm run job:refresh-club-chain-paths -- --apply
 *   npm run job:refresh-club-chain-paths -- --from=2026-07-01 --apply --force
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { clubChainLink, recomputeClubChainShortestPath } from '../services/clubChainGenerator.js';
import { contentHash } from '../services/puzzleOps.js';
import type { ClubChainPuzzleAnswer, ClubChainPuzzlePublic } from '../services/clubChainGenerator.js';

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');
const FROM = process.argv.find((a) => a.startsWith('--from='))?.slice(7);

/** maxMoves = par + 4, mirroring the generator. */
const EXTRA_MOVES = 4;

interface PuzzleRow {
  date: string;
  status: string;
  puzzle_json: ClubChainPuzzlePublic;
  answer_json: ClubChainPuzzleAnswer | null;
}

async function pathIsValid(path: string[]): Promise<boolean> {
  for (let i = 0; i < path.length - 1; i += 1) {
    if (!(await clubChainLink(path[i]!, path[i + 1]!))) return false;
  }
  return path.length >= 2;
}

async function main(): Promise<void> {
  const from = FROM ?? new Date().toISOString().slice(0, 10);
  const rows = (await db.execute(sql`
    SELECT date::text AS date, status, puzzle_json, answer_json
    FROM daily_puzzles
    WHERE mode_id = 'club_chain' AND date >= ${from}
    ORDER BY date
  `)) as unknown as PuzzleRow[];
  console.log(`Club Chain puzzles from ${from}: ${rows.length}`);

  let refreshed = 0;
  let skipped = 0;

  for (const row of rows) {
    const puzzle = row.puzzle_json;
    const storedPath = row.answer_json?.shortestPathPlayerIds ?? [];
    const valid = await pathIsValid(storedPath);
    const again = await recomputeClubChainShortestPath(puzzle.start.id, puzzle.target.id);
    const parChanged = (again?.shortestPathLength ?? null) !== puzzle.shortestPathLength;

    if (valid && !parChanged) continue;

    const label = `${row.date} ${puzzle.start.name} -> ${puzzle.target.name}`;
    if (row.status === 'locked' || (row.status === 'approved' && !FORCE)) {
      console.log(`  skip ${label} — status ${row.status}${row.status === 'approved' ? ' (pass --force)' : ''}`);
      skipped += 1;
      continue;
    }
    if (!again) {
      console.log(`  skip ${label} — no path exists any more, needs regenerating with a new pair`);
      skipped += 1;
      continue;
    }

    const reasons = [!valid ? 'stale route' : null, parChanged ? `par ${puzzle.shortestPathLength}->${again.shortestPathLength}` : null]
      .filter(Boolean)
      .join(', ');
    console.log(`  refresh ${label} — ${reasons}`);
    refreshed += 1;

    if (!APPLY) continue;

    const nextPuzzle: ClubChainPuzzlePublic = {
      ...puzzle,
      shortestPathLength: again.shortestPathLength,
      maxMoves: again.shortestPathLength + EXTRA_MOVES,
    };
    const nextAnswer: ClubChainPuzzleAnswer = {
      modeId: 'club_chain',
      shortestPathPlayerIds: again.shortestPathPlayerIds,
      shortestPathLength: again.shortestPathLength,
    };
    await db.execute(sql`
      UPDATE daily_puzzles
      SET puzzle_json = ${JSON.stringify(nextPuzzle)}::jsonb,
          answer_json = ${JSON.stringify(nextAnswer)}::jsonb,
          content_hash = ${contentHash(nextPuzzle, nextAnswer)}
      WHERE date = ${row.date} AND mode_id = 'club_chain'
    `);
  }

  console.log(`\n${APPLY ? 'Refreshed' : 'Would refresh'} ${refreshed} puzzle(s) · ${skipped} skipped`);
  if (!APPLY && refreshed > 0) console.log('Dry run — re-run with --apply to write.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
