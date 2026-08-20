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
  correct?: boolean;
  wrongReason?: string | null;
};

export type VsLiveState = {
  /** Snake-draft step (not a formation slot). */
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
  const o = raw as Partial<VsLiveState> & { kind?: string };
  if (o.kind === 'target_man' || o.kind === 'back_yourself' || o.kind === 'darts_501') return null;
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

export function lockedSlotCount(live: VsLiveState, userId: string): number {
  return new Set(picksFor(live, userId).map((p) => p.slotId)).size;
}

export function hasOpenSlots(live: VsLiveState, userId: string, slotCount: number): boolean {
  return lockedSlotCount(live, userId) < slotCount;
}

export function allSquadsFilled(live: VsLiveState, userIds: string[], slotCount: number): boolean {
  return userIds.length > 0 && userIds.every((id) => !hasOpenSlots(live, id, slotCount));
}

/** Snake order so first pick swaps each round: A-B then B-A, or A-B-C then C-B-A. */
export function draftTurnOrder(userIds: string[], round: number): string[] {
  if (userIds.length < 2 || round % 2 === 0) return userIds;
  return [...userIds].reverse();
}

export function snakePicker(userIds: string[], turnIndex: number): string | null {
  if (userIds.length === 0) return null;
  const order = draftTurnOrder(userIds, Math.floor(turnIndex / userIds.length));
  return order[turnIndex % userIds.length] ?? null;
}

/** Next person in snake order who still has an empty slot. */
export function turnUserId(live: VsLiveState, userIds: string[], slotCount: number): string | null {
  if (live.finished || userIds.length === 0) return null;
  for (let step = 0; step < userIds.length * 4; step += 1) {
    const id = snakePicker(userIds, live.slotIndex + step);
    if (id && hasOpenSlots(live, id, slotCount)) return id;
  }
  return null;
}

function withDeadline(live: VsLiveState, now: number): VsLiveState {
  return { ...live, deadlineAt: new Date(now + VS_SLOT_TIMEOUT_MS).toISOString() };
}

function nextOpenTurnIndex(live: VsLiveState, userIds: string[], slotCount: number, fromIndex: number): number {
  let index = fromIndex;
  for (let step = 0; step < userIds.length * 4; step += 1) {
    const id = snakePicker(userIds, index);
    if (id && hasOpenSlots(live, id, slotCount)) return index;
    index += 1;
  }
  return fromIndex;
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

  const slotCount = puzzle.slots.length;
  let guard = 0;
  while (!next.finished && guard < 48) {
    guard += 1;
    if (allSquadsFilled(next, userIds, slotCount) || slotCount === 0) {
      next = { ...next, finished: true };
      break;
    }

    next = { ...next, slotIndex: nextOpenTurnIndex(next, userIds, slotCount, next.slotIndex) };
    const currentTurn = turnUserId(next, userIds, slotCount);
    if (currentTurn && now >= Date.parse(next.deadlineAt)) {
      next = withDeadline(
        {
          ...next,
          slotIndex: next.slotIndex + 1,
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
  const slotCount = puzzle.slots.length;
  if (allSquadsFilled(live, userIds, slotCount)) {
    return { ...live, finished: true };
  }
  const slotIndex = nextOpenTurnIndex(live, userIds, slotCount, live.slotIndex + 1);
  return withDeadline({ ...live, slotIndex }, now);
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
