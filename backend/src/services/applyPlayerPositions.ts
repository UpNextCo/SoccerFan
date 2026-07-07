import { sql, type SQL } from 'drizzle-orm';
import { db } from '../db/index.js';
import { mergeSubPositions, primarySubPosition } from '../services/playerPositionService.js';
import type { PositionBackfillEntry } from '../constants/positionBackfill.js';

export interface PositionApplyEntry {
  name: string;
  nationality: string;
  positions: string[];
  externalId?: string;
  birthDate?: string;
  externalIdIsNull?: boolean;
  birthDateIsNull?: boolean;
}

function posArraySql(merged: string[]): SQL {
  return merged.length > 0
    ? sql`ARRAY[${sql.join(merged.map((pos) => sql`${pos}`), sql`, `)}]::text[]`
    : sql`ARRAY[]::text[]`;
}

export async function applyPositionEntry(entry: PositionApplyEntry): Promise<'updated' | 'missing' | 'ambiguous' | 'invalid'> {
  const filters: SQL[] = [sql`name = ${entry.name}`, sql`nationality = ${entry.nationality}`];
  if (entry.externalId) filters.push(sql`external_id = ${entry.externalId}`);
  else if (entry.externalIdIsNull) filters.push(sql`external_id IS NULL`);
  if (entry.birthDate) filters.push(sql`birth_date = ${entry.birthDate}::date`);
  else if (entry.birthDateIsNull) filters.push(sql`birth_date IS NULL`);

  const rows = (await db.execute(sql`
    SELECT id, sub_position, sub_positions
    FROM players
    WHERE ${sql.join(filters, sql` AND `)}
    LIMIT 2
  `)) as unknown as Array<{ id: string; sub_position: string | null; sub_positions: string[] | null }>;

  if (rows.length === 0) return 'missing';
  if (rows.length > 1) return 'ambiguous';

  const row = rows[0]!;
  const merged = mergeSubPositions(row.sub_position, row.sub_positions, entry.positions);
  if (merged.length === 0) return 'invalid';

  const primary =
    row.sub_position && merged.includes(row.sub_position) ? row.sub_position : primarySubPosition(merged);

  await db.execute(sql`
    UPDATE players
    SET sub_position = ${primary},
        sub_positions = ${posArraySql(merged)}
    WHERE id = ${row.id}::uuid
  `);
  return 'updated';
}

export function toApplyEntry(entry: PositionBackfillEntry): PositionApplyEntry {
  return {
    name: entry.name,
    nationality: entry.nationality,
    positions: entry.positions,
    externalId: entry.externalId,
    birthDate: entry.birthDate,
    externalIdIsNull: entry.externalIdIsNull,
    birthDateIsNull: entry.birthDateIsNull,
  };
}
