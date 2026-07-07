import { sql, type SQL } from 'drizzle-orm';

/** Transfermarkt fine positions used by Draft XI pitch slots and World Cup XI. */
export const VALID_SUB_POSITIONS = [
  'Goalkeeper',
  'Centre-Back',
  'Right-Back',
  'Left-Back',
  'Defensive Midfield',
  'Central Midfield',
  'Attacking Midfield',
  'Right Midfield',
  'Left Midfield',
  'Right Winger',
  'Left Winger',
  'Centre-Forward',
  'Second Striker',
] as const;

export type SubPosition = (typeof VALID_SUB_POSITIONS)[number];

export const VALID_SUB_POSITION_SET = new Set<string>(VALID_SUB_POSITIONS);

/** SQL expression: all fine positions stored for player row alias `p`. */
export const EFFECTIVE_SUB_POSITIONS_SQL = sql`
  array_remove(
    array_cat(ARRAY[p.sub_position], COALESCE(p.sub_positions, ARRAY[]::text[])),
    NULL
  )
`;

/** SQL predicate: player alias `p` can fill the given slot position. */
export function playerMatchesSubPositionSql(position: string | SQL): SQL {
  return sql`${position} = ANY(${EFFECTIVE_SUB_POSITIONS_SQL})`;
}

/** SQL expression expanding each player to one row per playable fine position (alias `pos`). */
export const UNNEST_EFFECTIVE_SUB_POSITIONS_SQL = sql`
  unnest(${EFFECTIVE_SUB_POSITIONS_SQL}) AS pos
`;

export function mergeSubPositions(
  primary: string | null | undefined,
  extra: string[] | null | undefined,
  additions: string[] = []
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [primary, ...(extra ?? []), ...additions]) {
    const pos = (raw ?? '').trim();
    if (!pos || !VALID_SUB_POSITION_SET.has(pos) || seen.has(pos)) continue;
    seen.add(pos);
    out.push(pos);
  }
  return out;
}

export function primarySubPosition(positions: string[]): string | null {
  return positions[0] ?? null;
}
