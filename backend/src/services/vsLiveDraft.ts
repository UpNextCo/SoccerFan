import type { BattlePuzzleJson } from './battleGenerator.js';

export const VS_SLOT_TIMEOUT_MS = 2 * 60 * 1000;

export type VsLivePickRecord = {
  slotId: string;
  constraintId: string;
  playerId: string;
  playerName: string;
  headshotUrl: string | null;
  constraintLabel: string;
  statValue: number;
  lockedAt: string;
};

export type VsLiveState = {
  slotIndex: number;
  deadlineAt: string;
  finished: boolean;
  picksByUser: Record<string, VsLivePickRecord[]>;
};

const SLOT_LABELS: Record<string, string> = {
  Goalkeeper: 'GK',
  'Left-Back': 'LB',
  'Right-Back': 'RB',
  'Centre-Back': 'CB',
  'Defensive Midfield': 'DM',
  'Central Midfield': 'CM',
  'Attacking Midfield': 'AM',
  'Left Midfield': 'LM',
  'Right Midfield': 'RM',
  'Left Winger': 'LW',
  'Right Winger': 'RW',
  'Centre-Forward': 'ST',
  'Second Striker': 'SS',
};

export function shortSlotLabel(position: string): string {
  return SLOT_LABELS[position] ?? position.slice(0, 2).toUpperCase();
}

export function parseLiveState(raw: unknown): VsLiveState | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Partial<VsLiveState>;
  if (typeof o.slotIndex !== 'number' || typeof o.deadlineAt !== 'string') return null;
  return {
    slotIndex: o.slotIndex,
    deadlineAt: o.deadlineAt,
    finished: o.finished === true,
    picksByUser: o.picksByUser && typeof o.picksByUser === 'object' ? o.picksByUser : {},
  };
}

export function initLiveState(userIds: string[], now = Date.now()): VsLiveState {
  const picksByUser: Record<string, VsLivePickRecord[]> = {};
  for (const id of userIds) picksByUser[id] = [];
  return {
    slotIndex: 0,
    deadlineAt: new Date(now + VS_SLOT_TIMEOUT_MS).toISOString(),
    finished: false,
    picksByUser,
  };
}

export function currentSlot(puzzle: BattlePuzzleJson, live: VsLiveState): BattlePuzzleJson['slots'][number] | null {
  return puzzle.slots[live.slotIndex] ?? null;
}

export function picksFor(live: VsLiveState, userId: string): VsLivePickRecord[] {
  return live.picksByUser[userId] ?? [];
}

export function hasLocked(live: VsLiveState, userId: string, slotId: string): boolean {
  return picksFor(live, userId).some((p) => p.slotId === slotId);
}

export function usedConstraintIds(live: VsLiveState, userId: string): Set<string> {
  return new Set(picksFor(live, userId).map((p) => p.constraintId).filter(Boolean));
}

/** Every named player across the table — VS picks are shared. */
export function usedPlayerIds(live: VsLiveState, _userId?: string): Set<string> {
  const ids = new Set<string>();
  for (const picks of Object.values(live.picksByUser)) {
    for (const pick of picks) {
      if (pick.playerId) ids.add(pick.playerId);
    }
  }
  return ids;
}

export function totalFor(live: VsLiveState, userId: string): number {
  return picksFor(live, userId).reduce((sum, p) => sum + p.statValue, 0);
}

export function allUsersLocked(live: VsLiveState, userIds: string[], slotId: string): boolean {
  return userIds.length > 0 && userIds.every((id) => hasLocked(live, id, slotId));
}

/** First participant who has not locked the current slot — that's whose turn it is. */
export function turnUserId(live: VsLiveState, userIds: string[], slotId: string): string | null {
  return userIds.find((id) => !hasLocked(live, id, slotId)) ?? null;
}

export function skipPick(slotId: string, now = Date.now()): VsLivePickRecord {
  return {
    slotId,
    constraintId: '',
    playerId: '',
    playerName: '',
    headshotUrl: null,
    constraintLabel: '',
    statValue: 0,
    lockedAt: new Date(now).toISOString(),
  };
}

function withDeadline(live: VsLiveState, now: number): VsLiveState {
  return { ...live, deadlineAt: new Date(now + VS_SLOT_TIMEOUT_MS).toISOString() };
}

export function allNamedPicks(live: VsLiveState): Array<VsLivePickRecord & { userId: string }> {
  const rows: Array<VsLivePickRecord & { userId: string }> = [];
  for (const [userId, picks] of Object.entries(live.picksByUser)) {
    for (const pick of picks) {
      if (pick.playerId) rows.push({ ...pick, userId });
    }
  }
  rows.sort((a, b) => a.lockedAt.localeCompare(b.lockedAt));
  return rows;
}

export function advanceIfNeeded(
  puzzle: BattlePuzzleJson,
  live: VsLiveState,
  userIds: string[],
  now = Date.now()
): VsLiveState {
  let next: VsLiveState = {
    ...live,
    picksByUser: { ...live.picksByUser },
  };
  if (next.finished) return next;

  let guard = 0;
  while (!next.finished && guard < 48) {
    guard += 1;
    const slot = puzzle.slots[next.slotIndex];
    if (!slot) {
      next = { ...next, finished: true };
      break;
    }

    if (allUsersLocked(next, userIds, slot.id)) {
      if (next.slotIndex + 1 >= puzzle.slots.length) {
        next = { ...next, finished: true };
        break;
      }
      next = withDeadline(
        {
          ...next,
          slotIndex: next.slotIndex + 1,
        },
        now
      );
      continue;
    }

    const currentTurn = turnUserId(next, userIds, slot.id);
    if (currentTurn && now >= Date.parse(next.deadlineAt)) {
      next = withDeadline(
        {
          ...next,
          picksByUser: {
            ...next.picksByUser,
            [currentTurn]: [...picksFor(next, currentTurn), skipPick(slot.id, now)],
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
  puzzle: BattlePuzzleJson,
  live: VsLiveState,
  userIds: string[],
  now = Date.now()
): VsLiveState {
  const advanced = advanceIfNeeded(puzzle, live, userIds, now);
  if (advanced.finished) return advanced;
  if (advanced.slotIndex === live.slotIndex && advanced.deadlineAt === live.deadlineAt) {
    return withDeadline(advanced, now);
  }
  return advanced;
}

export function answerFromLive(live: VsLiveState, userId: string): { picks: Array<{ slotId: string; constraintId: string; playerId: string }> } {
  return {
    picks: picksFor(live, userId)
      .filter((p) => p.playerId && p.constraintId)
      .map((p) => ({
        slotId: p.slotId,
        constraintId: p.constraintId,
        playerId: p.playerId,
      })),
  };
}
