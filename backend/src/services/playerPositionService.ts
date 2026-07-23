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
export const DRAFT_POSITION_COMPATIBILITY_VERSION = 2;

/**
 * Slot-driven Draft XI compatibility. Adjacent midfield roles may still share (CM↔DM, RW↔RM),
 * but fullbacks and wingers must not cross: RB ↛ RW and LB ↛ LW (v1's RM/LM bridge allowed that).
 */
export const SLOT_POSITION_COMPATIBILITY: Record<SubPosition, readonly SubPosition[]> = {
  Goalkeeper: ['Goalkeeper'],
  'Centre-Back': ['Centre-Back'],
  'Left-Back': ['Left-Back'],
  'Right-Back': ['Right-Back'],
  'Defensive Midfield': ['Defensive Midfield', 'Central Midfield'],
  'Central Midfield': ['Central Midfield', 'Defensive Midfield', 'Attacking Midfield'],
  'Attacking Midfield': ['Attacking Midfield', 'Central Midfield', 'Second Striker'],
  'Left Midfield': ['Left Midfield', 'Left Winger'],
  'Right Midfield': ['Right Midfield', 'Right Winger'],
  'Left Winger': ['Left Winger', 'Left Midfield'],
  'Right Winger': ['Right Winger', 'Right Midfield'],
  'Centre-Forward': ['Centre-Forward', 'Second Striker'],
  'Second Striker': ['Second Striker', 'Centre-Forward', 'Attacking Midfield'],
};

export function compatibleSubPositions(slotPosition: string): readonly string[] {
  return VALID_SUB_POSITION_SET.has(slotPosition)
    ? SLOT_POSITION_COMPATIBILITY[slotPosition as SubPosition]
    : [slotPosition];
}

/** SQL expression: all fine positions stored for player row alias `p`. */
export const EFFECTIVE_SUB_POSITIONS_SQL = sql`
  array_remove(
    array_cat(ARRAY[p.sub_position], COALESCE(p.sub_positions, ARRAY[]::text[])),
    NULL
  )
`;

/** SQL predicate: player alias `p` can fill the given slot position. */
export function playerMatchesSubPositionSql(position: string | SQL): SQL {
  const compatibilityCases = Object.entries(SLOT_POSITION_COMPATIBILITY).map(
    ([slot, accepted]) => sql`
      WHEN ${slot} THEN ARRAY[${sql.join(accepted.map((value) => sql`${value}`), sql`, `)}]::text[]
    `
  );
  return sql`
    ${EFFECTIVE_SUB_POSITIONS_SQL} && (
      CASE ${position}
        ${sql.join(compatibilityCases, sql` `)}
        ELSE ARRAY[${position}]::text[]
      END
    )
  `;
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
