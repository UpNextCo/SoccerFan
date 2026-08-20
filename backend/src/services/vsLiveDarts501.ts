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
  drawOfferedBy: string | null;
  drawAcceptedBy: string[];
  /** Players who have already checked out this finishing visit. */
  checkedOutUserIds: string[];
  /** Later players still owed a redemption dart. */
  redemptionQueue: string[];
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
    drawOfferedBy: typeof o.drawOfferedBy === 'string' ? o.drawOfferedBy : null,
    drawAcceptedBy: Array.isArray(o.drawAcceptedBy)
      ? o.drawAcceptedBy.filter((id): id is string => typeof id === 'string')
      : [],
    checkedOutUserIds: Array.isArray(o.checkedOutUserIds)
      ? o.checkedOutUserIds.filter((id): id is string => typeof id === 'string')
      : [],
    redemptionQueue: Array.isArray(o.redemptionQueue)
      ? o.redemptionQueue.filter((id): id is string => typeof id === 'string')
      : [],
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
    drawOfferedBy: null,
    drawAcceptedBy: [],
    checkedOutUserIds: [],
    redemptionQueue: [],
  };
}

export function playersAfter(order: string[], userId: string): string[] {
  const idx = order.indexOf(userId);
  if (idx < 0) return [];
  return order.slice(idx + 1);
}

export function isRedemption(state: VsDarts501State): boolean {
  return !state.finished && state.redemptionQueue.length > 0;
}

function finishWithCheckouts(state: VsDarts501State, now: number): VsDarts501State {
  const ids = state.checkedOutUserIds.filter((id) => state.order.includes(id));
  return {
    ...state,
    finished: true,
    winnerUserId: ids.length === 1 ? ids[0]! : null,
    redemptionQueue: [],
    turnUserId: ids[0] ?? state.turnUserId,
    drawOfferedBy: null,
    drawAcceptedBy: [],
    deadlineAt: new Date(now).toISOString(),
  };
}

function nextRedemptionTurn(state: VsDarts501State, queue: string[], now: number): VsDarts501State {
  const remaining = queue.filter((id) => state.order.includes(id));
  if (remaining.length === 0) return finishWithCheckouts(state, now);
  return {
    ...state,
    redemptionQueue: remaining,
    turnUserId: remaining[0]!,
    deadlineAt: new Date(now + VS_DARTS501_TURN_MS).toISOString(),
    finished: false,
    winnerUserId: null,
    drawOfferedBy: null,
    drawAcceptedBy: [],
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

export function livingOrder(state: VsDarts501State, _totalLives = DARTS501_CHECKOUT_LIVES): string[] {
  return state.order;
}

export function clearDrawOffer(state: VsDarts501State): VsDarts501State {
  if (!state.drawOfferedBy && state.drawAcceptedBy.length === 0) return state;
  return { ...state, drawOfferedBy: null, drawAcceptedBy: [] };
}

export function offerDraw(state: VsDarts501State, userId: string): VsDarts501State {
  if (state.finished || !state.order.includes(userId)) return state;
  if (state.drawOfferedBy === userId) return state;
  return { ...state, drawOfferedBy: userId, drawAcceptedBy: [userId] };
}

export function acceptDraw(state: VsDarts501State, userId: string, now = Date.now()): VsDarts501State {
  if (state.finished || !state.drawOfferedBy || !state.order.includes(userId)) return state;
  if (state.drawAcceptedBy.includes(userId)) {
    return maybeFinishDraw(state, now);
  }
  return maybeFinishDraw({ ...state, drawAcceptedBy: [...state.drawAcceptedBy, userId] }, now);
}

export function declineDraw(state: VsDarts501State, userId: string): VsDarts501State {
  if (state.finished || !state.drawOfferedBy || !state.order.includes(userId)) return state;
  return clearDrawOffer(state);
}

function maybeFinishDraw(state: VsDarts501State, now: number): VsDarts501State {
  if (state.order.length < 2) return state;
  if (!state.order.every((id) => state.drawAcceptedBy.includes(id))) return state;
  return {
    ...state,
    finished: true,
    winnerUserId: null,
    redemptionQueue: [],
    deadlineAt: new Date(now).toISOString(),
  };
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
    redemptionQueue: [],
    turnUserId: tied[0]?.id ?? state.turnUserId,
    deadlineAt: new Date(now).toISOString(),
  };
}

export function passTurn(state: VsDarts501State, fromUserId: string, now = Date.now()): VsDarts501State {
  if (state.finished || state.order.length === 0) return state;
  if (state.redemptionQueue.length > 0) {
    return nextRedemptionTurn(
      state,
      state.redemptionQueue.filter((id) => id !== fromUserId),
      now
    );
  }
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
  now = Date.now(),
  canCheckoutIds: string[] = []
): VsDarts501State {
  const checkedOut = throwRow.kind === 'checkout' || throwRow.kind === 'perfect';
  const thrower = throwRow.userId;
  const next: VsDarts501State = {
    ...state,
    players: { ...state.players, [thrower]: nextPlayer },
    throws: [...state.throws, throwRow],
  };
  if (checkedOut) {
    const checkedOutUserIds = state.checkedOutUserIds.includes(thrower)
      ? state.checkedOutUserIds
      : [...state.checkedOutUserIds, thrower];
    const withCheckouts = { ...next, checkedOutUserIds };
    const queue = state.redemptionQueue.length > 0
      ? state.redemptionQueue.filter((id) => id !== thrower)
      : playersAfter(state.order, thrower).filter((id) => canCheckoutIds.includes(id));
    return nextRedemptionTurn(withCheckouts, queue, now);
  }
  if (state.redemptionQueue.length > 0) {
    return nextRedemptionTurn(
      next,
      state.redemptionQueue.filter((id) => id !== thrower),
      now
    );
  }
  return passTurn(next, thrower, now);
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
  const offeredBy = state.drawOfferedBy === userId ? null : state.drawOfferedBy;
  const acceptedBy = (state.drawAcceptedBy ?? []).filter((id) => id !== userId && order.includes(id));
  const checkedOutUserIds = (state.checkedOutUserIds ?? []).filter((id) => order.includes(id));
  const redemptionQueue = (state.redemptionQueue ?? []).filter((id) => order.includes(id));
  const next: VsDarts501State = {
    ...state,
    order,
    players,
    checkedOutUserIds,
    redemptionQueue,
    drawOfferedBy: offeredBy,
    drawAcceptedBy: offeredBy ? acceptedBy : [],
  };
  if (order.length <= 1) {
    return {
      ...next,
      finished: true,
      winnerUserId: order[0] ?? null,
      turnUserId: order[0] ?? '',
      drawOfferedBy: null,
      drawAcceptedBy: [],
      deadlineAt: new Date(now).toISOString(),
    };
  }
  const drawn = maybeFinishDraw(next, now);
  if (drawn.finished) return drawn;
  if (redemptionQueue.length > 0) {
    if (!redemptionQueue.includes(next.turnUserId)) {
      return nextRedemptionTurn(next, redemptionQueue, now);
    }
    return next;
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
