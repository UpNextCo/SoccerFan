import { DARTS501_CHECKOUT_LIVES, DARTS501_START } from './darts501Scoring.js';

export const VS_DARTS501_TURN_MS = 60 * 1000;

export type VsDarts501PlayerState = {
  remaining: number;
  inCheckout: boolean;
  checkoutBusts: number;
};

export type VsDarts501ThrowRecord = {
  userId: string;
  playerId: string;
  playerName: string;
  headshotUrl: string | null;
  score: number;
  kind: 'score' | 'bust' | 'checkout' | 'perfect';
  bustReason?: string;
  remainingAfter: number;
  thrownAt: string;
};

export type VsDarts501State = {
  kind: 'darts_501';
  turnUserId: string;
  deadlineAt: string;
  finished: boolean;
  winnerUserId: string | null;
  order: string[];
  players: Record<string, VsDarts501PlayerState>;
  throws: VsDarts501ThrowRecord[];
};

export function parseDarts501(raw: unknown): VsDarts501State | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Partial<VsDarts501State>;
  if (o.kind !== 'darts_501' || typeof o.turnUserId !== 'string' || typeof o.deadlineAt !== 'string') {
    return null;
  }
  return {
    kind: 'darts_501',
    turnUserId: o.turnUserId,
    deadlineAt: o.deadlineAt,
    finished: o.finished === true,
    winnerUserId: typeof o.winnerUserId === 'string' ? o.winnerUserId : null,
    order: Array.isArray(o.order) ? o.order.filter((id): id is string => typeof id === 'string') : [],
    players: o.players && typeof o.players === 'object' ? o.players : {},
    throws: Array.isArray(o.throws) ? (o.throws as VsDarts501ThrowRecord[]) : [],
  };
}

export function initDarts501(userIds: string[], now = Date.now()): VsDarts501State {
  const order = userIds.filter(Boolean);
  const players: Record<string, VsDarts501PlayerState> = {};
  for (const id of order) {
    players[id] = { remaining: DARTS501_START, inCheckout: false, checkoutBusts: 0 };
  }
  return {
    kind: 'darts_501',
    turnUserId: order[0] ?? '',
    deadlineAt: new Date(now + VS_DARTS501_TURN_MS).toISOString(),
    finished: false,
    winnerUserId: null,
    order,
    players,
    throws: [],
  };
}

export function usedPlayerIds(state: VsDarts501State): Set<string> {
  return new Set(state.throws.map((t) => t.playerId).filter(Boolean));
}

export function livesLeft(busts: number, total = DARTS501_CHECKOUT_LIVES): number {
  return Math.max(0, total - busts);
}

export function playerState(state: VsDarts501State, userId: string): VsDarts501PlayerState {
  return state.players[userId] ?? { remaining: DARTS501_START, inCheckout: false, checkoutBusts: 0 };
}

export function livingOrder(state: VsDarts501State, totalLives = DARTS501_CHECKOUT_LIVES): string[] {
  return state.order.filter((id) => livesLeft(playerState(state, id).checkoutBusts, totalLives) > 0);
}

/** Closest remaining wins. Same remaining is a draw (`winnerUserId` null). */
export function finishByClosest(state: VsDarts501State, now = Date.now()): VsDarts501State {
  if (state.finished) return state;
  const rows = state.order.map((id) => ({
    id,
    remaining: playerState(state, id).remaining,
  }));
  const best = rows.length === 0 ? 0 : Math.min(...rows.map((row) => row.remaining));
  const tied = rows.filter((row) => row.remaining === best);
  return {
    ...state,
    finished: true,
    winnerUserId: tied.length === 1 ? tied[0]!.id : null,
    turnUserId: tied[0]?.id ?? state.turnUserId,
    deadlineAt: new Date(now).toISOString(),
  };
}

export function passTurn(state: VsDarts501State, fromUserId: string, now = Date.now()): VsDarts501State {
  if (state.finished || state.order.length === 0) return state;
  const living = livingOrder(state);
  if (living.length === 0) return finishByClosest(state, now);
  const idx = Math.max(0, state.order.indexOf(fromUserId));
  for (let step = 1; step <= state.order.length; step++) {
    const id = state.order[(idx + step) % state.order.length]!;
    if (living.includes(id)) {
      return {
        ...state,
        turnUserId: id,
        deadlineAt: new Date(now + VS_DARTS501_TURN_MS).toISOString(),
      };
    }
  }
  return finishByClosest(state, now);
}

export function applyThrow(
  state: VsDarts501State,
  throwRow: VsDarts501ThrowRecord,
  nextPlayer: VsDarts501PlayerState,
  now = Date.now()
): VsDarts501State {
  const checkedOut = throwRow.kind === 'checkout' || throwRow.kind === 'perfect';
  const next: VsDarts501State = {
    ...state,
    players: { ...state.players, [throwRow.userId]: nextPlayer },
    throws: [...state.throws, throwRow],
  };
  if (checkedOut) {
    return {
      ...next,
      finished: true,
      winnerUserId: throwRow.userId,
      turnUserId: throwRow.userId,
      deadlineAt: new Date(now).toISOString(),
    };
  }
  if (livingOrder(next).length === 0) return finishByClosest(next, now);
  return passTurn(next, throwRow.userId, now);
}

export function applyTimeouts(state: VsDarts501State, now = Date.now()): VsDarts501State {
  let next = state;
  let guard = 0;
  while (!next.finished && next.order.length > 1 && now >= Date.parse(next.deadlineAt) && guard < 16) {
    next = passTurn(next, next.turnUserId, Date.parse(next.deadlineAt));
    guard += 1;
  }
  return next;
}

export function dropUser(state: VsDarts501State, userId: string, now = Date.now()): VsDarts501State {
  const order = state.order.filter((id) => id !== userId);
  const players = { ...state.players };
  delete players[userId];
  const next: VsDarts501State = { ...state, order, players };
  if (order.length <= 1) {
    return {
      ...next,
      finished: true,
      winnerUserId: order[0] ?? null,
      turnUserId: order[0] ?? '',
      deadlineAt: new Date(now).toISOString(),
    };
  }
  if (next.turnUserId === userId || !order.includes(next.turnUserId)) {
    return {
      ...next,
      turnUserId: order[0]!,
      deadlineAt: new Date(now + VS_DARTS501_TURN_MS).toISOString(),
    };
  }
  return next;
}
