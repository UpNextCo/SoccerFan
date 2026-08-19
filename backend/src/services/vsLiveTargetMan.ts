export const VS_TARGET_MAN_TURN_MS = 60 * 1000;
export const VS_TARGET_MAN_SLOT_COUNT = 5;

export type VsTargetManPick = {
  slotIndex: number;
  playerId: string;
  playerName: string;
  headshotUrl: string | null;
  statValue: number;
  lockedAt: string;
};

export type VsTargetManState = {
  kind: 'target_man';
  slotIndex: number;
  deadlineAt: string;
  finished: boolean;
  picksByUser: Record<string, VsTargetManPick[]>;
};

export function parseTargetMan(raw: unknown): VsTargetManState | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Partial<VsTargetManState>;
  if (o.kind !== 'target_man') return null;
  if (typeof o.slotIndex !== 'number' || typeof o.deadlineAt !== 'string') return null;
  return {
    kind: 'target_man',
    slotIndex: o.slotIndex,
    deadlineAt: o.deadlineAt,
    finished: o.finished === true,
    picksByUser: o.picksByUser && typeof o.picksByUser === 'object' ? o.picksByUser : {},
  };
}

export function initTargetMan(userIds: string[], now = Date.now()): VsTargetManState {
  const picksByUser: Record<string, VsTargetManPick[]> = {};
  for (const id of userIds) picksByUser[id] = [];
  return {
    kind: 'target_man',
    slotIndex: 0,
    deadlineAt: new Date(now + VS_TARGET_MAN_TURN_MS).toISOString(),
    finished: false,
    picksByUser,
  };
}

export function picksFor(live: VsTargetManState, userId: string): VsTargetManPick[] {
  return live.picksByUser[userId] ?? [];
}

export function hasLocked(live: VsTargetManState, userId: string, slotIndex: number): boolean {
  return picksFor(live, userId).some((p) => p.slotIndex === slotIndex);
}

export function usedPlayerIds(live: VsTargetManState): Set<string> {
  const ids = new Set<string>();
  for (const picks of Object.values(live.picksByUser)) {
    for (const pick of picks) {
      if (pick.playerId) ids.add(pick.playerId);
    }
  }
  return ids;
}

export function combinedFor(live: VsTargetManState, userId: string): number {
  return picksFor(live, userId).reduce((sum, p) => sum + p.statValue, 0);
}

export function turnUserId(live: VsTargetManState, userIds: string[], slotIndex: number): string | null {
  return userIds.find((id) => !hasLocked(live, id, slotIndex)) ?? null;
}

export function allUsersLocked(live: VsTargetManState, userIds: string[], slotIndex: number): boolean {
  return userIds.length > 0 && userIds.every((id) => hasLocked(live, id, slotIndex));
}

export function skipPick(slotIndex: number, now = Date.now()): VsTargetManPick {
  return {
    slotIndex,
    playerId: '',
    playerName: '',
    headshotUrl: null,
    statValue: 0,
    lockedAt: new Date(now).toISOString(),
  };
}

function withDeadline(live: VsTargetManState, now: number): VsTargetManState {
  return { ...live, deadlineAt: new Date(now + VS_TARGET_MAN_TURN_MS).toISOString() };
}

export function allNamedPicks(live: VsTargetManState): Array<VsTargetManPick & { userId: string }> {
  const rows: Array<VsTargetManPick & { userId: string }> = [];
  for (const [userId, picks] of Object.entries(live.picksByUser)) {
    for (const pick of picks) {
      if (pick.playerId) rows.push({ ...pick, userId });
    }
  }
  rows.sort((a, b) => a.lockedAt.localeCompare(b.lockedAt));
  return rows;
}

export function advanceIfNeeded(
  live: VsTargetManState,
  userIds: string[],
  now = Date.now()
): VsTargetManState {
  let next: VsTargetManState = {
    ...live,
    picksByUser: { ...live.picksByUser },
  };
  if (next.finished) return next;

  let guard = 0;
  while (!next.finished && guard < 32) {
    guard += 1;
    if (next.slotIndex >= VS_TARGET_MAN_SLOT_COUNT) {
      next = { ...next, finished: true };
      break;
    }

    if (allUsersLocked(next, userIds, next.slotIndex)) {
      if (next.slotIndex + 1 >= VS_TARGET_MAN_SLOT_COUNT) {
        next = { ...next, finished: true };
        break;
      }
      next = withDeadline({ ...next, slotIndex: next.slotIndex + 1 }, now);
      continue;
    }

    const currentTurn = turnUserId(next, userIds, next.slotIndex);
    if (currentTurn && now >= Date.parse(next.deadlineAt)) {
      next = withDeadline(
        {
          ...next,
          picksByUser: {
            ...next.picksByUser,
            [currentTurn]: [...picksFor(next, currentTurn), skipPick(next.slotIndex, now)],
          },
        },
        now
      );
      continue;
    }

    break;
  }
  return next;
}

export function afterSuccessfulPick(
  live: VsTargetManState,
  userIds: string[],
  now = Date.now()
): VsTargetManState {
  const advanced = advanceIfNeeded(live, userIds, now);
  if (advanced.finished) return advanced;
  if (advanced.slotIndex === live.slotIndex && advanced.deadlineAt === live.deadlineAt) {
    return withDeadline(advanced, now);
  }
  return advanced;
}

export function dropUser(live: VsTargetManState, userId: string): VsTargetManState {
  const picksByUser = { ...live.picksByUser };
  delete picksByUser[userId];
  return { ...live, picksByUser };
}
