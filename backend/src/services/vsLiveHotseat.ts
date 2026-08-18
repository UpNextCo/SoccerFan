export const VS_HOTSEAT_TURN_MS = 30 * 1000;

export type VsHotseatNamed = {
  userId: string;
  playerId: string;
  playerName: string;
  headshotUrl: string | null;
  namedAt: string;
};

export type VsHotseatState = {
  kind: 'back_yourself';
  turnUserId: string;
  deadlineAt: string;
  remaining: string[];
  eliminated: string[];
  named: VsHotseatNamed[];
  finished: boolean;
  winnerUserId: string | null;
};

export function parseHotseat(raw: unknown): VsHotseatState | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Partial<VsHotseatState>;
  if (o.kind !== 'back_yourself' || typeof o.turnUserId !== 'string' || typeof o.deadlineAt !== 'string') {
    return null;
  }
  return {
    kind: 'back_yourself',
    turnUserId: o.turnUserId,
    deadlineAt: o.deadlineAt,
    remaining: Array.isArray(o.remaining) ? o.remaining.filter((id): id is string => typeof id === 'string') : [],
    eliminated: Array.isArray(o.eliminated) ? o.eliminated.filter((id): id is string => typeof id === 'string') : [],
    named: Array.isArray(o.named) ? (o.named as VsHotseatNamed[]) : [],
    finished: o.finished === true,
    winnerUserId: typeof o.winnerUserId === 'string' ? o.winnerUserId : null,
  };
}

export function initHotseat(userIds: string[], now = Date.now()): VsHotseatState {
  const remaining = userIds.filter(Boolean);
  return {
    kind: 'back_yourself',
    turnUserId: remaining[0] ?? '',
    deadlineAt: new Date(now + VS_HOTSEAT_TURN_MS).toISOString(),
    remaining,
    eliminated: [],
    named: [],
    finished: remaining.length <= 1,
    winnerUserId: remaining.length <= 1 ? (remaining[0] ?? null) : null,
  };
}

export function namedCount(state: VsHotseatState, userId: string): number {
  return state.named.filter((n) => n.userId === userId).length;
}

export function namedPlayerIds(state: VsHotseatState): Set<string> {
  return new Set(state.named.map((n) => n.playerId));
}

function finishWith(remaining: string[], eliminated: string[], named: VsHotseatNamed[]): VsHotseatState {
  const winnerUserId = remaining[0] ?? null;
  return {
    kind: 'back_yourself',
    turnUserId: winnerUserId ?? '',
    deadlineAt: new Date().toISOString(),
    remaining,
    eliminated,
    named,
    finished: true,
    winnerUserId,
  };
}

export function passTurn(state: VsHotseatState, fromUserId: string, now = Date.now()): VsHotseatState {
  if (state.finished || state.remaining.length <= 1) {
    return finishWith(state.remaining, state.eliminated, state.named);
  }
  const idx = Math.max(0, state.remaining.indexOf(fromUserId));
  const next = state.remaining[(idx + 1) % state.remaining.length] ?? state.remaining[0]!;
  return {
    ...state,
    turnUserId: next,
    deadlineAt: new Date(now + VS_HOTSEAT_TURN_MS).toISOString(),
  };
}

export function eliminatePlayer(state: VsHotseatState, userId: string, now = Date.now()): VsHotseatState {
  if (state.finished) return state;
  const remaining = state.remaining.filter((id) => id !== userId);
  const eliminated = state.eliminated.includes(userId) ? state.eliminated : [...state.eliminated, userId];
  if (remaining.length <= 1) return finishWith(remaining, eliminated, state.named);

  const oldIdx = state.remaining.indexOf(userId);
  const next = remaining[oldIdx >= 0 ? oldIdx % remaining.length : 0] ?? remaining[0]!;
  return {
    ...state,
    remaining,
    eliminated,
    turnUserId: next,
    deadlineAt: new Date(now + VS_HOTSEAT_TURN_MS).toISOString(),
  };
}

/** Eliminate whoever's turn it is if their clock has run out. May chain if several are AFK. */
export function applyHotseatTimeouts(state: VsHotseatState, now = Date.now()): VsHotseatState {
  let next = state;
  let guard = 0;
  while (!next.finished && now >= Date.parse(next.deadlineAt) && guard < 12) {
    next = eliminatePlayer(next, next.turnUserId, Date.parse(next.deadlineAt));
    guard += 1;
  }
  return next;
}
