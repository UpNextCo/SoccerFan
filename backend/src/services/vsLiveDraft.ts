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
  return new Set(picksFor(live, userId).map((p) => p.constraintId));
}

export function usedPlayerIds(live: VsLiveState, userId: string): Set<string> {
  return new Set(picksFor(live, userId).map((p) => p.playerId));
}

export function totalFor(live: VsLiveState, userId: string): number {
  return picksFor(live, userId).reduce((sum, p) => sum + p.statValue, 0);
}

export function allUsersLocked(live: VsLiveState, userIds: string[], slotId: string): boolean {
  return userIds.length > 0 && userIds.every((id) => hasLocked(live, id, slotId));
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

  while (!next.finished) {
    const slot = puzzle.slots[next.slotIndex];
    if (!slot) {
      next = { ...next, finished: true };
      break;
    }
    const timedOut = now >= Date.parse(next.deadlineAt);
    const locked = allUsersLocked(next, userIds, slot.id);
    if (!timedOut && !locked) break;

    if (next.slotIndex + 1 >= puzzle.slots.length) {
      next = { ...next, finished: true };
      break;
    }
    next = {
      ...next,
      slotIndex: next.slotIndex + 1,
      deadlineAt: new Date(now + VS_SLOT_TIMEOUT_MS).toISOString(),
    };
  }
  return next;
}

export function answerFromLive(live: VsLiveState, userId: string): { picks: Array<{ slotId: string; constraintId: string; playerId: string }> } {
  return {
    picks: picksFor(live, userId).map((p) => ({
      slotId: p.slotId,
      constraintId: p.constraintId,
      playerId: p.playerId,
    })),
  };
}
