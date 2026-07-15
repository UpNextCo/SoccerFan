/**
 * Read-only audit of persisted Football Bingo boards.
 *
 *   npm run job:audit-bingo-freshness -- 2026-06-01 2026-06-30 --threshold=0.25
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

interface StoredCategory {
  id?: string;
  title?: string;
  type?: string;
}

interface StoredBoard {
  date: string;
  puzzleJson: { categories?: StoredCategory[] };
}

function validDate(value: string | undefined): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function increment(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

async function main() {
  const start = process.argv[2];
  const end = process.argv[3];
  if (!validDate(start) || !validDate(end) || start > end) {
    throw new Error('Usage: audit-bingo-freshness YYYY-MM-DD YYYY-MM-DD [--threshold=0.25]');
  }
  const thresholdArg = process.argv.find((arg) => arg.startsWith('--threshold='));
  const threshold = Number(thresholdArg?.split('=')[1] ?? 0.25);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error('--threshold must be a share from 0 to 1');
  }

  const boards = (await db.execute(sql`
    SELECT date::text AS date, puzzle_json AS "puzzleJson"
    FROM daily_puzzles
    WHERE mode_id = 'football_bingo'
      AND date >= ${start}
      AND date <= ${end}
    ORDER BY date
  `)) as unknown as StoredBoard[];

  const tileCounts = new Map<string, number>();
  const tileLabels = new Map<string, string>();
  const typeCounts = new Map<string, number>();
  const boardSignatures = new Map<string, string[]>();
  let totalTiles = 0;

  for (const board of boards) {
    const categories = Array.isArray(board.puzzleJson?.categories) ? board.puzzleJson.categories : [];
    const ids: string[] = [];
    for (const category of categories) {
      if (!category.id) continue;
      ids.push(category.id);
      increment(tileCounts, category.id);
      increment(typeCounts, category.type ?? 'unknown');
      tileLabels.set(category.id, category.title ?? category.id);
      totalTiles += 1;
    }
    const signature = [...ids].sort().join('|');
    if (signature) {
      const dates = boardSignatures.get(signature) ?? [];
      dates.push(board.date);
      boardSignatures.set(signature, dates);
    }
  }

  const frequent = [...tileCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const maxFrequency = frequent[0]?.[1] ?? 0;
  const maxShare = boards.length > 0 ? maxFrequency / boards.length : 0;
  const repeatedBoards = [...boardSignatures.values()].filter((dates) => dates.length > 1);

  console.log(`Football Bingo freshness: ${start}..${end}`);
  console.log(`boards=${boards.length} tiles=${totalTiles} uniqueTiles=${tileCounts.size}`);
  console.log(`exactBoardRepeats=${repeatedBoards.reduce((sum, dates) => sum + dates.length - 1, 0)}`);
  for (const dates of repeatedBoards) console.log(`  repeated board: ${dates.join(', ')}`);
  console.log('\nMost frequent tiles:');
  for (const [id, count] of frequent.slice(0, 20)) {
    const share = boards.length > 0 ? count / boards.length : 0;
    console.log(`  ${String(count).padStart(3)} (${(share * 100).toFixed(1)}%) ${tileLabels.get(id) ?? id} [${id}]`);
  }
  console.log('\nPer-type usage:');
  for (const [type, count] of [...typeCounts].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count} (${totalTiles > 0 ? ((count / totalTiles) * 100).toFixed(1) : '0.0'}%)`);
  }
  console.log(
    `\nmaxFrequency=${maxFrequency} maxShare=${(maxShare * 100).toFixed(1)}% ` +
      `threshold=${(threshold * 100).toFixed(1)}% exceeded=${maxShare > threshold ? 'YES' : 'NO'}`
  );
  process.exit(maxShare > threshold ? 2 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
