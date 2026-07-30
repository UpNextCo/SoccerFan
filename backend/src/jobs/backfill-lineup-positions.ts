/**
 * Backfill players.sub_positions from REAL Transfermarkt lineup appearances.
 *
 * The players.csv dump carries a single `sub_position`, so `sub_positions` has only ever held
 * one value and Draft XI rejected genuine multi-role players (Suso at right wing, Kimmich at
 * right-back). game_lineups.csv records the fine position a player started in for every match,
 * so we can derive every role they actually played.
 *
 * A position qualifies when it has >= MIN_STARTS starts AND >= MIN_SHARE of the player's starts.
 * Their most-started position always qualifies. Substitute appearances are ignored — they reflect
 * where a player was slotted late, not a role they hold.
 *
 * Results are MERGED, never overwritten: the lineup dump only covers 2013+, so a player's
 * pre-2013 roles survive only in `sub_position` / curated overrides (Cristiano's United right
 * wing years, Messi as an attacking midfielder). The existing primary is always preserved.
 *
 * Usage:
 *   npm run job:backfill-lineup-positions            # dry run + review CSV
 *   npm run job:backfill-lineup-positions -- --apply # write to the database
 */
import 'dotenv/config';
import { createReadStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { mergeSubPositions, VALID_SUB_POSITION_SET } from '../services/playerPositionService.js';

const MIN_STARTS = 5;
const MIN_SHARE = 0.05;

const APPLY = process.argv.includes('--apply');
const DIR = process.argv.find((a) => a.startsWith('--dir='))?.slice(6) ?? process.env.TM_DIR ?? 'transferdata';

interface PlayerRow {
  id: string;
  name: string;
  tm_player_id: string;
  sub_position: string | null;
  sub_positions: string[] | null;
}

/** RFC4180-ish split of one CSV line (handles quoted fields containing commas). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(field);
      field = '';
    } else if (c !== '\r') field += c;
  }
  out.push(field);
  return out;
}

/** tm player id -> fine position -> starts */
async function aggregateStarts(path: string): Promise<{ starts: Map<string, Map<string, number>>; rows: number }> {
  const starts = new Map<string, Map<string, number>>();
  let rows = 0;
  let header: string[] | null = null;
  let iPlayer = -1;
  let iType = -1;
  let iPosition = -1;

  const reader = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of reader) {
    if (!line) continue;
    const cols = splitCsvLine(line);
    if (!header) {
      header = cols;
      iPlayer = header.indexOf('player_id');
      iType = header.indexOf('type');
      iPosition = header.indexOf('position');
      if (iPlayer < 0 || iType < 0 || iPosition < 0) {
        throw new Error(`Unexpected game_lineups header: ${header.join(',')}`);
      }
      continue;
    }
    rows += 1;
    if (cols[iType] !== 'starting_lineup') continue;
    const position = (cols[iPosition] ?? '').trim();
    if (!VALID_SUB_POSITION_SET.has(position)) continue;
    const tmId = (cols[iPlayer] ?? '').trim();
    if (!tmId) continue;
    const byPosition = starts.get(tmId) ?? new Map<string, number>();
    byPosition.set(position, (byPosition.get(position) ?? 0) + 1);
    starts.set(tmId, byPosition);
  }
  return { starts, rows };
}

/** Positions the player has genuinely held, most-started first. */
function derivePositions(byPosition: Map<string, number>): string[] {
  const ranked = [...byPosition.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) return [];
  const total = ranked.reduce((sum, [, n]) => sum + n, 0);
  const out = [ranked[0]![0]];
  for (const [position, n] of ranked.slice(1)) {
    if (n >= MIN_STARTS && n / total >= MIN_SHARE) out.push(position);
  }
  return out;
}

async function main(): Promise<void> {
  const path = `${DIR}/game_lineups.csv`;
  console.log(`Aggregating starts from ${path}...`);
  const { starts, rows } = await aggregateStarts(path);
  console.log(`Read ${rows.toLocaleString()} lineup rows -> ${starts.size.toLocaleString()} players with starts`);

  const ours = (await db.execute(sql`
    SELECT id, name, tm_player_id, sub_position, sub_positions
    FROM players
    WHERE tm_player_id IS NOT NULL
  `)) as unknown as PlayerRow[];
  console.log(`Our players with a Transfermarkt id: ${ours.length.toLocaleString()}`);

  const updates: Array<{ id: string; primary: string; positions: string[] }> = [];
  const review: string[] = ['name,tm_player_id,before,after,added'];
  let matched = 0;
  let unchanged = 0;

  for (const row of ours) {
    const byPosition = starts.get(row.tm_player_id);
    if (!byPosition) continue;
    matched += 1;

    const derived = derivePositions(byPosition);
    const merged = mergeSubPositions(row.sub_position, row.sub_positions, derived);
    if (merged.length === 0) continue;

    const before = mergeSubPositions(row.sub_position, row.sub_positions);
    if (before.length === merged.length && before.every((p, i) => p === merged[i])) {
      unchanged += 1;
      continue;
    }

    // Keep the curated/dump primary whenever it survives the merge, so nothing else shifts.
    const primary =
      row.sub_position && merged.includes(row.sub_position) ? row.sub_position : merged[0]!;
    updates.push({ id: row.id, primary, positions: merged });

    const added = merged.filter((p) => !before.includes(p));
    const csv = (s: string) => `"${s.replace(/"/g, '""')}"`;
    review.push(
      [csv(row.name), row.tm_player_id, csv(before.join('|')), csv(merged.join('|')), csv(added.join('|'))].join(',')
    );
  }

  const reviewPath = `${DIR}/lineup_positions_review.csv`;
  writeFileSync(reviewPath, review.join('\n') + '\n');

  const gained = new Map<number, number>();
  for (const u of updates) gained.set(u.positions.length, (gained.get(u.positions.length) ?? 0) + 1);
  const spread = [...gained.entries()].sort((a, b) => a[0] - b[0]).map(([n, c]) => `${n}pos=${c}`).join(' ');

  console.log(`  matched in lineup data : ${matched.toLocaleString()}`);
  console.log(`  already correct        : ${unchanged.toLocaleString()}`);
  console.log(`  to update              : ${updates.length.toLocaleString()}  (${spread})`);
  console.log(`  review CSV             : ${reviewPath}`);

  if (!APPLY) {
    console.log('\nDry run — re-run with --apply to write these to the database.');
    process.exit(0);
  }

  let done = 0;
  for (let i = 0; i < updates.length; i += 500) {
    const batch = updates.slice(i, i + 500);
    const tuples = batch.map(
      (u) =>
        sql`(${u.id}::uuid, ${u.primary}, ARRAY[${sql.join(u.positions.map((p) => sql`${p}`), sql`, `)}]::text[])`
    );
    await db.execute(sql`
      UPDATE players AS p
      SET sub_position = v.prim,
          sub_positions = v.positions
      FROM (VALUES ${sql.join(tuples, sql`, `)}) AS v(id, prim, positions)
      WHERE p.id = v.id
    `);
    done += batch.length;
  }
  console.log(`\nUpdated ${done.toLocaleString()} players.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
