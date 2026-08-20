import { randomBytes, randomUUID } from 'node:crypto';
import { and, desc, eq, gt, inArray, or, sql } from 'drizzle-orm';
import { avatarPublicUrl } from '../utils/avatarUrl.js';
import { db } from '../db/index.js';
import {
  users,
  vsChallenges,
  type VsChallenge,
  type VsParticipantRecord,
} from '../db/schema.js';
import {
  recomputeBattleScore,
  scoreBattlePick,
  type BattlePuzzleJson,
} from './battleGenerator.js';
import {
  advanceIfNeeded,
  afterSuccessfulPick,
  allNamedPicks,
  answerFromLive,
  hasLocked,
  hasOpenSlots,
  initLiveState,
  parseLiveState,
  picksFor,
  shortSlotLabel,
  totalFor,
  turnUserId,
  usedConstraintIds,
  usedPlayerIds,
  VS_SLOT_TIMEOUT_MS,
  type VsLiveState,
} from './vsLiveDraft.js';
import { sanitizePublicPuzzle } from './dailyService.js';
import {
  playerValuesForCategory,
  normalizeTargetManPool,
} from './targetManCategories.js';
import {
  countDarts501CheckoutsForPuzzle,
  darts501FormulaById,
  parseDarts501Puzzle,
  playerValuesForDarts501,
} from './darts501Generator.js';
import { DARTS501_CHECKOUT_LIVES, DARTS501_START, resolveDarts501Throw, resolveDarts501ThrowLive } from './darts501Scoring.js';
import {
  generateVsPuzzle,
  isVsModeId,
  VS_MAX_PLAYERS,
  vsPuzzleMeta,
  type VsModeId,
} from './vsPuzzle.js';
import {
  applyHotseatTimeouts,
  eliminatePlayer,
  initHotseat,
  namedCount,
  namedPlayerIds,
  parseHotseat,
  passTurn,
  type VsHotseatState,
} from './vsLiveHotseat.js';
import {
  advanceIfNeeded as advanceTargetMan,
  afterSuccessfulPick as afterTargetManPick,
  allNamedPicks as allTargetManPicks,
  combinedFor as targetManCombined,
  dropUser as dropTargetManUser,
  hasLocked as targetManHasLocked,
  initTargetMan,
  parseTargetMan,
  picksFor as targetManPicksFor,
  turnUserId as targetManTurnUserId,
  usedPlayerIds as targetManUsedPlayerIds,
  VS_TARGET_MAN_SLOT_COUNT,
  VS_TARGET_MAN_TURN_MS,
  type VsTargetManState,
} from './vsLiveTargetMan.js';
import {
  acceptDraw as acceptDarts501Draw,
  applyThrow as applyDarts501Throw,
  applyTimeouts as applyDarts501Timeouts,
  declineDraw as declineDarts501Draw,
  dropUser as dropDarts501User,
  initDarts501,
  livesLeft as darts501LivesLeft,
  isRedemption as darts501IsRedemption,
  offerDraw as offerDarts501Draw,
  parseDarts501,
  playersAfter as darts501PlayersAfter,
  playerState as darts501PlayerState,
  usedPlayerIds as darts501UsedPlayerIds,
  type VsDarts501State,
} from './vsLiveDarts501.js';
import {
  playerMatchesBackYourselfCategory,
  resolveBackYourselfPlayerCard,
  type BackYourselfCategory,
} from './backYourselfGenerator.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const TTL_MS = 24 * 60 * 60 * 1000;

export class VsError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message);
  }
}

export type VsPlayerView = {
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
  score: number | null;
  displayScore: number | null;
  completed: boolean;
  isYou: boolean;
  isHost: boolean;
};

export type VsRankingView = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  score: number;
  displayScore: number;
};

export type VsH2hView = {
  opponentUserId: string;
  opponentName: string;
  opponentAvatarUrl: string | null;
  youWins: number;
  theyWins: number;
  draws: number;
};

export type VsHistoryGameView = {
  id: string;
  modeId: string;
  modeTitle: string;
  title: string;
  completedAt: string;
  winner: 'you' | 'other' | 'draw' | null;
  players: VsPlayerView[];
};

export type VsHistoryView = {
  games: VsHistoryGameView[];
  records: VsH2hView[];
};

export type VsChallengeView = {
  id: string;
  code: string;
  modeId: string;
  modeTitle: string;
  title: string;
  status: string;
  expiresAt: string;
  youAreHost: boolean;
  maxPlayers: number;
  canStart: boolean;
  players: VsPlayerView[];
  host: VsPlayerView;
  guest: VsPlayerView | null;
  puzzle: unknown;
  optimalLineup?: BattlePuzzleJson['optimalLineup'];
  optimalScore?: number;
  categoryNoun: string;
  result: {
    allDone: boolean;
    bothDone: boolean;
    winnerUserId: string | null;
    winner: 'you' | 'other' | 'draw' | null;
    yourScore: number | null;
    theirScore: number | null;
    rankings: VsRankingView[];
    h2h: VsH2hView | null;
  };
  live: VsLiveView | null;
  hotseat: VsHotseatView | null;
  targetMan: VsTargetManView | null;
  darts501: VsDarts501View | null;
};

export type VsHotseatPlayerView = {
  userId: string;
  displayName: string;
  isYou: boolean;
  alive: boolean;
  namedCount: number;
};

export type VsHotseatNamedView = {
  userId: string;
  displayName: string;
  playerId: string;
  playerName: string;
  headshotUrl: string | null;
};

export type VsHotseatView = {
  turnUserId: string;
  yourTurn: boolean;
  deadlineAt: string;
  finished: boolean;
  namedPlayerIds: string[];
  players: VsHotseatPlayerView[];
  named: VsHotseatNamedView[];
};

export type VsLiveBoardRow = {
  userId: string;
  displayName: string;
  isYou: boolean;
  total: number;
  locked: boolean;
  playerName: string | null;
  constraintLabel: string | null;
  statValue: number | null;
  headshotUrl: string | null;
};

export type VsLivePickView = {
  userId: string;
  displayName: string;
  isYou: boolean;
  slotId: string;
  slotLabel: string;
  constraintId: string;
  constraintLabel: string;
  playerId: string;
  playerName: string;
  statValue: number;
  headshotUrl: string | null;
  correct: boolean;
  wrongReason: string | null;
};

export type VsTargetManBoardRow = {
  userId: string;
  displayName: string;
  isYou: boolean;
  pickCount: number;
  locked: boolean;
};

export type VsTargetManPickView = {
  userId: string;
  displayName: string;
  isYou: boolean;
  slotIndex: number;
  playerId: string;
  playerName: string;
  headshotUrl: string | null;
  statValue: number | null;
};

export type VsDarts501BoardRow = {
  userId: string;
  displayName: string;
  isYou: boolean;
  remaining: number;
  inCheckout: boolean;
  checkoutBusts: number;
  livesLeft: number;
  checkoutOptionCount: number | null;
};

export type VsDarts501ThrowView = {
  userId: string;
  displayName: string;
  isYou: boolean;
  playerId: string;
  playerName: string;
  headshotUrl: string | null;
  score: number;
  kind: string;
  bustReason: string | null;
  remainingAfter: number;
};

export type VsDarts501View = {
  turnUserId: string;
  yourTurn: boolean;
  deadlineAt: string;
  finished: boolean;
  winnerUserId: string | null;
  usedPlayerIds: string[];
  formulaLabel: string;
  audience: string;
  formulaDetail: string;
  checkoutLives: number;
  startScore: number;
  board: VsDarts501BoardRow[];
  throws: VsDarts501ThrowView[];
  drawOfferedBy: string | null;
  drawOfferedByName: string | null;
  youOfferedDraw: boolean;
  youAcceptedDraw: boolean;
  pendingDraw: boolean;
  drawAcceptedCount: number;
  drawNeededCount: number;
  redemption: boolean;
  checkedOutUserIds: string[];
};

export type VsTargetManView = {
  slotIndex: number;
  slotCount: number;
  deadlineAt: string;
  turnUserId: string | null;
  yourTurn: boolean;
  youLocked: boolean;
  finished: boolean;
  usedPlayerIds: string[];
  target: number;
  categoryLabel: string;
  valueNoun: string;
  offNoun: string;
  unit: string | null;
  board: VsTargetManBoardRow[];
  picks: VsTargetManPickView[];
  yourPicks: VsTargetManPickView[];
};

export type VsLiveView = {
  slotIndex: number;
  slotCount: number;
  slotId: string;
  slotLabel: string;
  slotPosition: string;
  deadlineAt: string;
  turnUserId: string | null;
  yourTurn: boolean;
  youLocked: boolean;
  finished: boolean;
  usedConstraintIds: string[];
  usedPlayerIds: string[];
  board: VsLiveBoardRow[];
  picks: VsLivePickView[];
  yourPicks: VsLivePickView[];
};

type VsScoreResult = {
  score: number;
  displayScore: number;
};

function generateCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length]!;
  }
  return out;
}

function isExpired(row: VsChallenge, now = new Date()): boolean {
  return row.expiresAt.getTime() <= now.getTime();
}

async function markExpired(row: VsChallenge): Promise<VsChallenge> {
  if (row.status === 'complete' || row.status === 'expired') return row;
  const [updated] = await db
    .update(vsChallenges)
    .set({ status: 'expired' })
    .where(eq(vsChallenges.id, row.id))
    .returning();
  return updated ?? { ...row, status: 'expired' };
}

type VsUserInfo = { displayName: string; avatarUrl?: string };

async function loadUsers(ids: string[]): Promise<Map<string, VsUserInfo>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      hasAvatar: sql<boolean>`(${users.avatarJpeg} is not null)`,
    })
    .from(users)
    .where(inArray(users.id, unique));
  return new Map(
    rows.map((r) => [
      r.id,
      {
        displayName: r.displayName,
        avatarUrl: avatarPublicUrl(r.id, Boolean(r.hasAvatar)),
      },
    ])
  );
}

function displayNameOf(names: Map<string, VsUserInfo>, userId: string): string {
  return names.get(userId)?.displayName ?? 'Player';
}

function isoOrNull(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function participantsOf(row: VsChallenge): VsParticipantRecord[] {
  const stored = Array.isArray(row.participantsJson) ? row.participantsJson : [];
  if (stored.length > 0) {
    return stored.map((p) => ({
      userId: p.userId,
      score: p.score ?? null,
      displayScore: p.displayScore ?? p.score ?? null,
      answerJson: p.answerJson,
      completedAt: p.completedAt ?? null,
    }));
  }

  const legacy: VsParticipantRecord[] = [
    {
      userId: row.hostUserId,
      score: row.hostScore,
      displayScore: row.hostScore,
      answerJson: row.hostAnswerJson,
      completedAt: isoOrNull(row.hostCompletedAt),
    },
  ];
  if (row.guestUserId) {
    legacy.push({
      userId: row.guestUserId,
      score: row.guestScore,
      displayScore: row.guestScore,
      answerJson: row.guestAnswerJson,
      completedAt: isoOrNull(row.guestCompletedAt),
    });
  }
  return legacy;
}

function emptyParticipant(userId: string): VsParticipantRecord {
  return { userId, score: null, displayScore: null, completedAt: null };
}

function liveStateOf(row: VsChallenge): VsLiveState | null {
  return parseLiveState(row.liveJson);
}

function liveViewFor(
  row: VsChallenge,
  userId: string,
  names: Map<string, VsUserInfo>
): VsLiveView | null {
  if (row.modeId !== 'draft_master' || row.status !== 'active') return null;
  const live = liveStateOf(row);
  const puzzle = row.puzzleJson as BattlePuzzleJson;
  if (!live || !Array.isArray(puzzle.slots)) return null;
  const people = participantsOf(row);
  const userIds = people.map((p) => p.userId);
  const slotCount = puzzle.slots.length;
  const currentTurn = turnUserId(live, userIds, slotCount);
  const pickViews = allNamedPicks(live).map((pick) => {
    const slotMeta = puzzle.slots.find((s) => s.id === pick.slotId);
    return {
      userId: pick.userId,
      displayName: displayNameOf(names, pick.userId) ?? 'Player',
      isYou: pick.userId === userId,
      slotId: pick.slotId,
      slotLabel: slotMeta ? shortSlotLabel(slotMeta.position) : '—',
      constraintId: pick.constraintId,
      constraintLabel: pick.constraintLabel,
      playerId: pick.playerId,
      playerName: pick.playerName,
      statValue: pick.statValue,
      headshotUrl: pick.headshotUrl,
      correct: pick.correct !== false,
      wrongReason: pick.wrongReason ?? null,
    };
  });
  return {
    slotIndex: live.slotIndex,
    slotCount,
    slotId: '',
    slotLabel: 'ANY',
    slotPosition: 'Any position',
    deadlineAt: live.deadlineAt,
    turnUserId: currentTurn,
    yourTurn: currentTurn === userId && !live.finished,
    youLocked: currentTurn !== userId || !hasOpenSlots(live, userId, slotCount),
    finished: live.finished,
    usedConstraintIds: [...usedConstraintIds(live, userId)],
    usedPlayerIds: [...usedPlayerIds(live)],
    board: people.map((p) => {
      const last = [...picksFor(live, p.userId)].reverse().find((x) => x.playerId);
      return {
        userId: p.userId,
        displayName: displayNameOf(names, p.userId) ?? 'Player',
        isYou: p.userId === userId,
        total: totalFor(live, p.userId),
        locked: !hasOpenSlots(live, p.userId, slotCount),
        playerName: last?.playerName || null,
        constraintLabel: last?.constraintLabel || null,
        statValue: last?.playerId ? last.statValue : null,
        headshotUrl: last?.headshotUrl ?? null,
      };
    }),
    picks: pickViews,
    yourPicks: pickViews.filter((p) => p.userId === userId),
  };
}

function liveTotals(row: VsChallenge): Map<string, number> | null {
  if (row.modeId === 'draft_master') {
    const live = liveStateOf(row);
    if (!live) return null;
    return new Map(participantsOf(row).map((p) => [p.userId, totalFor(live, p.userId)]));
  }
  if (row.modeId === 'back_yourself') {
    const hotseat = parseHotseat(row.liveJson);
    if (!hotseat) return null;
    return new Map(participantsOf(row).map((p) => [p.userId, namedCount(hotseat, p.userId)]));
  }
  return null;
}

function hotseatViewFor(
  row: VsChallenge,
  userId: string,
  names: Map<string, VsUserInfo>
): VsHotseatView | null {
  if (row.modeId !== 'back_yourself' || (row.status !== 'active' && row.status !== 'complete')) return null;
  const hotseat = parseHotseat(row.liveJson);
  if (!hotseat) return null;
  const people = participantsOf(row);
  return {
    turnUserId: hotseat.turnUserId,
    yourTurn: !hotseat.finished && hotseat.turnUserId === userId,
    deadlineAt: hotseat.deadlineAt,
    finished: hotseat.finished,
    namedPlayerIds: [...namedPlayerIds(hotseat)],
    players: people.map((p) => ({
      userId: p.userId,
      displayName: displayNameOf(names, p.userId) ?? 'Player',
      isYou: p.userId === userId,
      alive: hotseat.remaining.includes(p.userId),
      namedCount: namedCount(hotseat, p.userId),
    })),
    named: hotseat.named.map((n) => ({
      userId: n.userId,
      displayName: displayNameOf(names, n.userId) ?? 'Player',
      playerId: n.playerId,
      playerName: n.playerName,
      headshotUrl: n.headshotUrl,
    })),
  };
}

function targetManPuzzleMeta(puzzle: unknown): {
  target: number;
  categoryId: string;
  categoryLabel: string;
  valueNoun: string;
  offNoun: string;
  unit: string | null;
  pool: unknown;
} {
  const p = puzzle && typeof puzzle === 'object' ? (puzzle as Record<string, unknown>) : {};
  return {
    target: typeof p.target === 'number' ? p.target : 0,
    categoryId: typeof p.categoryId === 'string' ? p.categoryId : '',
    categoryLabel: typeof p.categoryLabel === 'string' ? p.categoryLabel : 'Target Man',
    valueNoun: typeof p.valueNoun === 'string' ? p.valueNoun : 'pts',
    offNoun: typeof p.offNoun === 'string' ? p.offNoun : 'off',
    unit: typeof p.unit === 'string' ? p.unit : null,
    pool: p.pool,
  };
}

function targetManViewFor(
  row: VsChallenge,
  userId: string,
  names: Map<string, VsUserInfo>
): VsTargetManView | null {
  if (row.modeId !== 'target_man' || (row.status !== 'active' && row.status !== 'complete')) return null;
  const live = parseTargetMan(row.liveJson);
  if (!live) return null;
  const meta = targetManPuzzleMeta(row.puzzleJson);
  const people = participantsOf(row);
  const userIds = people.map((p) => p.userId);
  const currentTurn = targetManTurnUserId(live, userIds, live.slotIndex);
  const reveal = live.finished;
  const pickViews = allTargetManPicks(live).map((pick) => ({
    userId: pick.userId,
    displayName: displayNameOf(names, pick.userId) ?? 'Player',
    isYou: pick.userId === userId,
    slotIndex: pick.slotIndex,
    playerId: pick.playerId,
    playerName: pick.playerName,
    headshotUrl: pick.headshotUrl,
    statValue: reveal ? pick.statValue : null,
  }));
  return {
    slotIndex: live.slotIndex,
    slotCount: VS_TARGET_MAN_SLOT_COUNT,
    deadlineAt: live.deadlineAt,
    turnUserId: currentTurn,
    yourTurn: currentTurn === userId && !live.finished,
    youLocked: targetManHasLocked(live, userId, live.slotIndex),
    finished: live.finished,
    usedPlayerIds: [...targetManUsedPlayerIds(live)],
    target: meta.target,
    categoryLabel: meta.categoryLabel,
    valueNoun: meta.valueNoun,
    offNoun: meta.offNoun,
    unit: meta.unit,
    board: people.map((p) => ({
      userId: p.userId,
      displayName: displayNameOf(names, p.userId) ?? 'Player',
      isYou: p.userId === userId,
      pickCount: targetManPicksFor(live, p.userId).filter((x) => x.playerId).length,
      locked: targetManHasLocked(live, p.userId, live.slotIndex),
    })),
    picks: pickViews,
    yourPicks: pickViews.filter((p) => p.userId === userId),
  };
}

function darts501ViewFor(
  row: VsChallenge,
  userId: string,
  names: Map<string, VsUserInfo>
): VsDarts501View | null {
  if (row.modeId !== 'darts_501' || (row.status !== 'active' && row.status !== 'complete')) return null;
  const live = parseDarts501(row.liveJson);
  if (!live) return null;
  const puzzle = parseDarts501Puzzle(row.puzzleJson);
  const people = participantsOf(row);
  return {
    turnUserId: live.turnUserId,
    yourTurn: !live.finished && live.turnUserId === userId,
    deadlineAt: live.deadlineAt,
    finished: live.finished,
    winnerUserId: live.winnerUserId,
    usedPlayerIds: [...darts501UsedPlayerIds(live)],
    formulaLabel: puzzle?.formulaLabel ?? 'Football 501',
    audience: puzzle?.audience ?? 'Any player',
    formulaDetail: puzzle?.formulaDetail ?? '',
    checkoutLives: puzzle?.checkoutLives ?? DARTS501_CHECKOUT_LIVES,
    startScore: puzzle?.startScore ?? DARTS501_START,
    board: people.map((p) => {
      const board = darts501PlayerState(live, p.userId);
      return {
        userId: p.userId,
        displayName: displayNameOf(names, p.userId) ?? 'Player',
        isYou: p.userId === userId,
        remaining: board.remaining,
        inCheckout: board.inCheckout,
        checkoutBusts: board.checkoutBusts,
        livesLeft: darts501LivesLeft(board.checkoutBusts, puzzle?.checkoutLives ?? DARTS501_CHECKOUT_LIVES),
        checkoutOptionCount: null,
      };
    }),
    throws: live.throws.map((t) => ({
      userId: t.userId,
      displayName: displayNameOf(names, t.userId) ?? 'Player',
      isYou: t.userId === userId,
      playerId: t.playerId,
      playerName: t.playerName,
      headshotUrl: t.headshotUrl,
      score: t.score,
      kind: t.kind,
      bustReason: t.bustReason ?? null,
      remainingAfter: t.remainingAfter,
    })),
    drawOfferedBy: live.drawOfferedBy,
    drawOfferedByName: live.drawOfferedBy ? displayNameOf(names, live.drawOfferedBy) : null,
    youOfferedDraw: live.drawOfferedBy === userId,
    youAcceptedDraw: live.drawAcceptedBy.includes(userId),
    pendingDraw: live.drawOfferedBy != null && !live.finished,
    drawAcceptedCount: live.drawAcceptedBy.length,
    drawNeededCount: live.order.length,
    redemption: darts501IsRedemption(live),
    checkedOutUserIds: live.checkedOutUserIds,
  };
}

async function persistRow(
  id: string,
  patch: Partial<typeof vsChallenges.$inferInsert>
): Promise<VsChallenge | null> {
  const [updated] = await db.update(vsChallenges).set(patch).where(eq(vsChallenges.id, id)).returning();
  return updated ?? null;
}

async function finishLiveDraft(row: VsChallenge, live: VsLiveState): Promise<VsChallenge> {
  const now = new Date();
  const next = participantsOf(row).map((p) => {
    const answer = answerFromLive(live, p.userId);
    const score = totalFor(live, p.userId);
    return {
      ...p,
      score,
      displayScore: score,
      answerJson: answer,
      completedAt: p.completedAt ?? now.toISOString(),
    };
  });
  const host = next.find((p) => p.userId === row.hostUserId);
  const guest = next.find((p) => p.userId !== row.hostUserId);
  const updated = await persistRow(row.id, {
    liveJson: { ...live, finished: true },
    participantsJson: next,
    status: 'complete',
    hostScore: host?.displayScore ?? null,
    hostAnswerJson: host?.answerJson ?? null,
    hostCompletedAt: now,
    guestScore: guest?.displayScore ?? null,
    guestAnswerJson: guest?.answerJson ?? null,
    guestCompletedAt: guest ? now : null,
  });
  return updated ?? { ...row, status: 'complete', liveJson: { ...live, finished: true }, participantsJson: next };
}

async function syncLiveDraft(row: VsChallenge): Promise<VsChallenge> {
  if (row.modeId !== 'draft_master' || row.status !== 'active') return row;
  const puzzle = row.puzzleJson as BattlePuzzleJson;
  if (!Array.isArray(puzzle.slots) || puzzle.slots.length === 0) return row;
  const userIds = participantsOf(row).map((p) => p.userId);
  let live = liveStateOf(row);
  if (!live) {
    live = initLiveState(userIds);
    const updated = await persistRow(row.id, { liveJson: live });
    return updated ?? { ...row, liveJson: live };
  }
  const advanced = advanceIfNeeded(puzzle, live, userIds);
  if (advanced.finished && !live.finished) {
    return finishLiveDraft(row, advanced);
  }
  if (advanced.slotIndex !== live.slotIndex || advanced.deadlineAt !== live.deadlineAt) {
    const updated = await persistRow(row.id, { liveJson: advanced });
    return updated ?? { ...row, liveJson: advanced };
  }
  return row;
}

function draftLiveForStart(
  row: VsChallenge
): VsLiveState | VsHotseatState | VsTargetManState | VsDarts501State | null {
  const ids = participantsOf(row).map((p) => p.userId);
  if (row.modeId === 'draft_master') {
    return liveStateOf(row) ?? initLiveState(ids);
  }
  if (row.modeId === 'back_yourself') {
    return parseHotseat(row.liveJson) ?? initHotseat(ids);
  }
  if (row.modeId === 'target_man') {
    return parseTargetMan(row.liveJson) ?? initTargetMan(ids);
  }
  if (row.modeId === 'darts_501') {
    return parseDarts501(row.liveJson) ?? initDarts501(ids);
  }
  return null;
}

function liveJsonForActive(row: VsChallenge, userIds: string[]): unknown {
  if (row.modeId === 'draft_master') {
    return liveStateOf(row) ?? initLiveState(userIds);
  }
  if (row.modeId === 'back_yourself') {
    return parseHotseat(row.liveJson) ?? initHotseat(userIds);
  }
  if (row.modeId === 'target_man') {
    return parseTargetMan(row.liveJson) ?? initTargetMan(userIds);
  }
  if (row.modeId === 'darts_501') {
    return parseDarts501(row.liveJson) ?? initDarts501(userIds);
  }
  return row.liveJson;
}

async function finishHotseat(row: VsChallenge, hotseat: VsHotseatState): Promise<VsChallenge> {
  const now = new Date();
  const finished = { ...hotseat, finished: true };
  const next = participantsOf(row).map((p) => {
    const score = namedCount(finished, p.userId);
    return {
      ...p,
      score,
      displayScore: score,
      answerJson: { namedPlayerIds: finished.named.filter((n) => n.userId === p.userId).map((n) => n.playerId) },
      completedAt: p.completedAt ?? now.toISOString(),
    };
  });
  const host = next.find((p) => p.userId === row.hostUserId);
  const guest = next.find((p) => p.userId !== row.hostUserId);
  const updated = await persistRow(row.id, {
    liveJson: finished,
    participantsJson: next,
    status: 'complete',
    hostScore: host?.displayScore ?? null,
    hostAnswerJson: host?.answerJson ?? null,
    hostCompletedAt: now,
    guestScore: guest?.displayScore ?? null,
    guestAnswerJson: guest?.answerJson ?? null,
    guestCompletedAt: guest ? now : null,
  });
  return updated ?? { ...row, status: 'complete', liveJson: finished, participantsJson: next };
}

async function syncHotseat(row: VsChallenge): Promise<VsChallenge> {
  if (row.modeId !== 'back_yourself' || row.status !== 'active') return row;
  const userIds = participantsOf(row).map((p) => p.userId);
  let hotseat = parseHotseat(row.liveJson);
  if (!hotseat) {
    hotseat = initHotseat(userIds);
    const updated = await persistRow(row.id, { liveJson: hotseat });
    return updated ?? { ...row, liveJson: hotseat };
  }
  const advanced = applyHotseatTimeouts(hotseat);
  if (advanced.finished && !hotseat.finished) {
    return finishHotseat(row, advanced);
  }
  if (advanced.turnUserId !== hotseat.turnUserId || advanced.deadlineAt !== hotseat.deadlineAt) {
    const updated = await persistRow(row.id, { liveJson: advanced });
    return updated ?? { ...row, liveJson: advanced };
  }
  return row;
}

async function finishTargetMan(row: VsChallenge, live: VsTargetManState): Promise<VsChallenge> {
  const now = new Date();
  const finished = { ...live, finished: true };
  const meta = targetManPuzzleMeta(row.puzzleJson);
  const next = participantsOf(row).map((p) => {
    const picks = targetManPicksFor(finished, p.userId);
    const playerIds = Array.from({ length: VS_TARGET_MAN_SLOT_COUNT }, (_, i) => picks.find((x) => x.slotIndex === i)?.playerId ?? '');
    const combined = targetManCombined(finished, p.userId);
    const off = Math.abs(combined - meta.target);
    return {
      ...p,
      score: 1_000_000 - off,
      displayScore: off,
      answerJson: { playerIds },
      completedAt: p.completedAt ?? now.toISOString(),
    };
  });
  const host = next.find((p) => p.userId === row.hostUserId);
  const guest = next.find((p) => p.userId !== row.hostUserId);
  const updated = await persistRow(row.id, {
    liveJson: finished,
    participantsJson: next,
    status: 'complete',
    hostScore: host?.displayScore ?? null,
    hostAnswerJson: host?.answerJson ?? null,
    hostCompletedAt: now,
    guestScore: guest?.displayScore ?? null,
    guestAnswerJson: guest?.answerJson ?? null,
    guestCompletedAt: guest ? now : null,
  });
  return updated ?? { ...row, status: 'complete', liveJson: finished, participantsJson: next };
}

async function syncTargetMan(row: VsChallenge): Promise<VsChallenge> {
  if (row.modeId !== 'target_man' || row.status !== 'active') return row;
  const userIds = participantsOf(row).map((p) => p.userId);
  let live = parseTargetMan(row.liveJson);
  if (!live) {
    live = initTargetMan(userIds);
    const updated = await persistRow(row.id, { liveJson: live });
    return updated ?? { ...row, liveJson: live };
  }
  const advanced = advanceTargetMan(live, userIds);
  if (advanced.finished && !live.finished) {
    return finishTargetMan(row, advanced);
  }
  if (advanced.slotIndex !== live.slotIndex || advanced.deadlineAt !== live.deadlineAt) {
    const updated = await persistRow(row.id, { liveJson: advanced });
    return updated ?? { ...row, liveJson: advanced };
  }
  return row;
}

async function finishDarts501(row: VsChallenge, live: VsDarts501State): Promise<VsChallenge> {
  const now = new Date();
  const finished = { ...live, finished: true };
  const next = participantsOf(row).map((p) => {
    const board = darts501PlayerState(finished, p.userId);
    const throwCount = finished.throws.filter((t) => t.userId === p.userId).length;
    const won = finished.winnerUserId === p.userId;
    return {
      ...p,
      score: won ? 10_000 - throwCount : -board.remaining,
      displayScore: board.remaining,
      answerJson: { playerIds: finished.throws.filter((t) => t.userId === p.userId).map((t) => t.playerId) },
      completedAt: p.completedAt ?? now.toISOString(),
    };
  });
  const host = next.find((p) => p.userId === row.hostUserId);
  const guest = next.find((p) => p.userId !== row.hostUserId);
  const updated = await persistRow(row.id, {
    liveJson: finished,
    participantsJson: next,
    status: 'complete',
    hostScore: host?.displayScore ?? null,
    hostAnswerJson: host?.answerJson ?? null,
    hostCompletedAt: now,
    guestScore: guest?.displayScore ?? null,
    guestAnswerJson: guest?.answerJson ?? null,
    guestCompletedAt: guest ? now : null,
  });
  return updated ?? { ...row, status: 'complete', liveJson: finished, participantsJson: next };
}

async function syncDarts501(row: VsChallenge): Promise<VsChallenge> {
  if (row.modeId !== 'darts_501' || row.status !== 'active') return row;
  const userIds = participantsOf(row).map((p) => p.userId);
  let live = parseDarts501(row.liveJson);
  if (!live) {
    live = initDarts501(userIds);
    const updated = await persistRow(row.id, { liveJson: live });
    return updated ?? { ...row, liveJson: live };
  }
  const advanced = applyDarts501Timeouts(live);
  if (advanced.finished && !live.finished) {
    return finishDarts501(row, advanced);
  }
  if (advanced.turnUserId !== live.turnUserId || advanced.deadlineAt !== live.deadlineAt) {
    const updated = await persistRow(row.id, { liveJson: advanced });
    return updated ?? { ...row, liveJson: advanced };
  }
  return row;
}

function rankingWinner(
  completed: Array<{ userId: string; score: number }>
): { winnerUserId: string | null; isDraw: boolean } {
  if (completed.length === 0) return { winnerUserId: null, isDraw: false };
  const best = Math.max(...completed.map((p) => p.score));
  const tied = completed.filter((p) => p.score === best);
  if (tied.length !== 1) return { winnerUserId: null, isDraw: true };
  return { winnerUserId: tied[0]!.userId, isDraw: false };
}

function toView(row: VsChallenge, userId: string, names: Map<string, VsUserInfo>): VsChallengeView {
  const people = participantsOf(row);
  const youAreHost = row.hostUserId === userId;
  const you = people.find((p) => p.userId === userId);
  const youCompleted = you?.completedAt != null;
  const hotseat = parseHotseat(row.liveJson);
  const targetMan = parseTargetMan(row.liveJson);
  const darts501 = parseDarts501(row.liveJson);
  const allDone =
    hotseat?.finished === true ||
    targetMan?.finished === true ||
    darts501?.finished === true ||
    (people.length >= 2 && people.every((p) => p.completedAt != null));
  const completed = people
    .filter((p) => p.completedAt != null && p.score != null)
    .map((p) => ({ userId: p.userId, score: p.score as number, displayScore: p.displayScore ?? p.score ?? 0 }));
  const ranked = allDone ? rankingWinner(completed) : { winnerUserId: null, isDraw: false };
  const winnerUserId = hotseat?.finished
    ? hotseat.winnerUserId
    : darts501?.finished
      ? darts501.winnerUserId
      : ranked.winnerUserId;
  const isDraw = darts501?.finished
    ? darts501.winnerUserId == null
    : hotseat?.finished
      ? false
      : ranked.isDraw;

  const publicPuzzle = sanitizePublicPuzzle(row.modeId, row.puzzleJson);
  const meta = vsPuzzleMeta(row.modeId, row.puzzleJson);
  const running = liveTotals(row);
  const players: VsPlayerView[] = people.map((p) => {
    const liveScore = running?.get(p.userId);
    const score = p.displayScore ?? liveScore ?? null;
    return {
      userId: p.userId,
      displayName: displayNameOf(names, p.userId),
      avatarUrl: names.get(p.userId)?.avatarUrl ?? null,
      score,
      displayScore: score,
      completed: p.completedAt != null,
      isYou: p.userId === userId,
      isHost: p.userId === row.hostUserId,
    };
  });

  const host = players.find((p) => p.isHost) ?? players[0]!;
  const guest = players.find((p) => !p.isHost) ?? null;
  const opponent = players.find((p) => !p.isYou) ?? null;

  let winner: 'you' | 'other' | 'draw' | null = null;
  if (allDone) {
    if (isDraw) winner = 'draw';
    else if (winnerUserId === userId) winner = 'you';
    else winner = 'other';
  }

  const rankings: VsRankingView[] = allDone
    ? [...completed]
        .sort((a, b) => {
          if ((hotseat?.finished || darts501?.finished) && winnerUserId) {
            if (a.userId === winnerUserId) return -1;
            if (b.userId === winnerUserId) return 1;
          }
          if (darts501?.finished) return a.displayScore - b.displayScore;
          return b.score - a.score;
        })
        .map((p) => ({
          userId: p.userId,
          displayName: displayNameOf(names, p.userId) ?? 'Player',
          avatarUrl: names.get(p.userId)?.avatarUrl ?? null,
          score: p.score,
          displayScore: p.displayScore,
        }))
    : [];

  const draftPuzzle = row.modeId === 'draft_master' ? (row.puzzleJson as BattlePuzzleJson) : null;

  return {
    id: row.id,
    code: row.code,
    modeId: row.modeId,
    modeTitle: meta.modeTitle,
    title: meta.title,
    status: row.status,
    expiresAt: row.expiresAt.toISOString(),
    youAreHost,
    maxPlayers: VS_MAX_PLAYERS,
    canStart: youAreHost && row.status === 'waiting' && people.length >= 2,
    players,
    host,
    guest,
    puzzle: publicPuzzle,
    ...(youCompleted && draftPuzzle
      ? {
          optimalLineup: draftPuzzle.optimalLineup,
          optimalScore: draftPuzzle.optimalScore,
        }
      : {}),
    categoryNoun: meta.scoreNoun,
    result: {
      allDone,
      bothDone: allDone,
      winnerUserId: allDone ? winnerUserId : null,
      winner,
      yourScore: you?.displayScore ?? running?.get(userId) ?? null,
      theirScore: opponent ? (opponent.displayScore ?? running?.get(opponent.userId) ?? null) : null,
      rankings,
      h2h: null,
    },
    live: liveViewFor(row, userId, names),
    hotseat: hotseatViewFor(row, userId, names),
    targetMan: targetManViewFor(row, userId, names),
    darts501: darts501ViewFor(row, userId, names),
  };
}

async function viewFor(row: VsChallenge, userId: string): Promise<VsChallengeView> {
  const synced =
    row.modeId === 'back_yourself'
      ? await syncHotseat(row)
      : row.modeId === 'target_man'
        ? await syncTargetMan(row)
        : row.modeId === 'darts_501'
          ? await syncDarts501(row)
          : await syncLiveDraft(row);
  const ids = participantsOf(synced).map((p) => p.userId);
  const names = await loadUsers(ids);
  const view = toView(synced, userId, names);
  if (view.darts501 && !view.darts501.finished) {
    await attachDarts501CheckoutOptions(view.darts501, synced.puzzleJson);
  }
  if (view.result.allDone && view.players.length === 2) {
    const opponent = view.players.find((p) => !p.isYou);
    if (opponent) {
      view.result.h2h = await h2hAgainst(userId, opponent.userId, names);
    }
  }
  return view;
}

async function attachDarts501CheckoutOptions(
  live: VsDarts501View,
  puzzleJson: unknown
): Promise<void> {
  const inCheckout = live.board.filter((row) => row.inCheckout);
  if (inCheckout.length === 0) return;
  const puzzle = parseDarts501Puzzle(puzzleJson);
  if (!puzzle) return;
  const used = live.usedPlayerIds;
  const byRemaining = new Map<number, number>();
  for (const row of inCheckout) {
    if (!byRemaining.has(row.remaining)) {
      byRemaining.set(
        row.remaining,
        await countDarts501CheckoutsForPuzzle(puzzle, row.remaining, used)
      );
    }
    row.checkoutOptionCount = byRemaining.get(row.remaining) ?? 0;
  }
}

function winnerUserIdOf(row: VsChallenge): { winnerUserId: string | null; isDraw: boolean } {
  const people = participantsOf(row);
  const hotseat = parseHotseat(row.liveJson);
  if (hotseat?.finished) return { winnerUserId: hotseat.winnerUserId, isDraw: false };
  const darts501 = parseDarts501(row.liveJson);
  if (darts501?.finished) return { winnerUserId: darts501.winnerUserId, isDraw: darts501.winnerUserId == null };
  const completed = people
    .filter((p) => p.completedAt != null && p.score != null)
    .map((p) => ({ userId: p.userId, score: p.score as number }));
  return rankingWinner(completed);
}

function completedAtOf(row: VsChallenge): string {
  const times = participantsOf(row)
    .map((p) => p.completedAt)
    .filter((t): t is string => typeof t === 'string' && t.length > 0)
    .sort();
  return times.at(-1) ?? row.hostCompletedAt?.toISOString() ?? row.createdAt.toISOString();
}

async function completedGamesFor(userId: string, limit = 120): Promise<VsChallenge[]> {
  const like = `%${userId}%`;
  const rows = await db
    .select()
    .from(vsChallenges)
    .where(
      and(
        eq(vsChallenges.status, 'complete'),
        or(
          eq(vsChallenges.hostUserId, userId),
          eq(vsChallenges.guestUserId, userId),
          sql`${vsChallenges.participantsJson}::text like ${like}`
        )
      )
    )
    .orderBy(desc(vsChallenges.createdAt))
    .limit(limit);
  return rows.filter((row) => participantsOf(row).some((p) => p.userId === userId));
}

async function h2hAgainst(
  userId: string,
  opponentUserId: string,
  names: Map<string, VsUserInfo>
): Promise<VsH2hView> {
  const games = await completedGamesFor(userId, 200);
  let youWins = 0;
  let theyWins = 0;
  let draws = 0;
  for (const row of games) {
    const people = participantsOf(row);
    if (!people.some((p) => p.userId === opponentUserId)) continue;
    const { winnerUserId, isDraw } = winnerUserIdOf(row);
    if (isDraw) draws += 1;
    else if (winnerUserId === userId) youWins += 1;
    else if (winnerUserId === opponentUserId) theyWins += 1;
  }
  return {
    opponentUserId,
    opponentName: displayNameOf(names, opponentUserId) ?? 'Player',
    opponentAvatarUrl: names.get(opponentUserId)?.avatarUrl ?? null,
    youWins,
    theyWins,
    draws,
  };
}

export async function listVsHistory(userId: string): Promise<VsHistoryView> {
  const mine = (await completedGamesFor(userId, 160)).slice(0, 30);
  const allIds = [...new Set(mine.flatMap((row) => participantsOf(row).map((p) => p.userId)))];
  const names = await loadUsers(allIds);
  const games: VsHistoryGameView[] = [];
  const recordMap = new Map<string, VsH2hView>();

  for (const row of mine) {
    const view = toView(row, userId, names);
    const completedAt = completedAtOf(row);
    games.push({
      id: view.id,
      modeId: view.modeId,
      modeTitle: view.modeTitle,
      title: view.title,
      completedAt,
      winner: view.result.winner,
      players: view.players,
    });

    const { winnerUserId, isDraw } = winnerUserIdOf(row);
    for (const person of participantsOf(row)) {
      if (person.userId === userId) continue;
      const current = recordMap.get(person.userId) ?? {
        opponentUserId: person.userId,
        opponentName: displayNameOf(names, person.userId) ?? 'Player',
        opponentAvatarUrl: names.get(person.userId)?.avatarUrl ?? null,
        youWins: 0,
        theyWins: 0,
        draws: 0,
      };
      if (isDraw) current.draws += 1;
      else if (winnerUserId === userId) current.youWins += 1;
      else if (winnerUserId === person.userId) current.theyWins += 1;
      recordMap.set(person.userId, current);
    }
  }

  const records = [...recordMap.values()].sort(
    (a, b) => b.youWins + b.theyWins + b.draws - (a.youWins + a.theyWins + a.draws)
  );
  return { games, records };
}

async function requireParticipant(challengeId: string, userId: string): Promise<VsChallenge> {
  const [row] = await db.select().from(vsChallenges).where(eq(vsChallenges.id, challengeId)).limit(1);
  if (!row) throw new VsError('Challenge not found', 404, 'NOT_FOUND');
  const people = participantsOf(row);
  if (row.hostUserId !== userId && !people.some((p) => p.userId === userId)) {
    throw new VsError('Not in this challenge', 403, 'FORBIDDEN');
  }
  if (isExpired(row) && row.status !== 'complete') {
    return markExpired(row);
  }
  return row;
}

function normalizeSubmitAnswer(raw: unknown, picks?: Array<{ slotId: string; constraintId: string; playerId: string }>): unknown {
  if (picks && picks.length > 0) return { picks };
  return raw;
}

async function scoreVsAnswer(
  modeId: string,
  puzzleJson: unknown,
  answerJson: unknown,
  answer: unknown
): Promise<VsScoreResult> {
  if (modeId === 'draft_master') {
    const picks = (answer as { picks?: unknown })?.picks;
    if (!Array.isArray(picks)) throw new VsError('Invalid Draft XI answer', 400, 'INVALID_ANSWER');
    const clean = (picks as Array<{ slotId?: string; constraintId?: string; playerId?: string }>).filter(
      (p): p is { slotId: string; constraintId: string; playerId: string } =>
        typeof p.slotId === 'string' && typeof p.constraintId === 'string' && typeof p.playerId === 'string'
    );
    const { total } = await recomputeBattleScore(puzzleJson as BattlePuzzleJson, clean);
    return { score: total, displayScore: total };
  }

  if (modeId === 'target_man') {
    const playerIds = (answer as { playerIds?: unknown })?.playerIds;
    if (!Array.isArray(playerIds) || playerIds.length !== 5 || playerIds.some((x) => typeof x !== 'string')) {
      throw new VsError('Invalid Target Man answer', 400, 'INVALID_ANSWER');
    }
    const puzzle = puzzleJson as { categoryId?: string; target?: number; pool?: unknown };
    const answerMeta = answerJson as { answer?: { categoryId?: string; target?: number } } | null;
    const categoryId = puzzle.categoryId ?? answerMeta?.answer?.categoryId;
    const target = puzzle.target ?? answerMeta?.answer?.target;
    if (typeof categoryId !== 'string' || typeof target !== 'number' || target <= 0) {
      throw new VsError('Target Man puzzle is missing a category', 500, 'PUZZLE_FAILED');
    }
    const values = await playerValuesForCategory(categoryId, playerIds as string[], normalizeTargetManPool(puzzle.pool));
    const combined = values.reduce((sum, v) => sum + v.value, 0);
    const off = Math.abs(combined - target);
    return { score: 1_000_000 - off, displayScore: off };
  }

  if (modeId === 'back_yourself') {
    const body = answer as { pledge?: unknown; namedPlayerIds?: unknown };
    if (typeof body.pledge !== 'number' || !Array.isArray(body.namedPlayerIds)) {
      throw new VsError('Invalid Back Yourself answer', 400, 'INVALID_ANSWER');
    }
    const namedIds = [...new Set((body.namedPlayerIds as unknown[]).filter((id): id is string => typeof id === 'string'))];
    const stored = answerJson as { validPlayerIds?: string[] } | undefined;
    const validSet = new Set(stored?.validPlayerIds ?? []);
    const validNamedCount = validSet.size > 0 ? namedIds.filter((id) => validSet.has(id)).length : namedIds.length;
    const pledge = Math.floor(body.pledge);
    const won = validNamedCount >= pledge && pledge > 0;
    return {
      score: won ? 10_000 + pledge : validNamedCount,
      displayScore: validNamedCount,
    };
  }

  if (modeId === 'darts_501') {
    const body = answer as { playerIds?: unknown };
    if (!Array.isArray(body.playerIds) || body.playerIds.some((id) => typeof id !== 'string')) {
      throw new VsError('Invalid Football 501 answer', 400, 'INVALID_ANSWER');
    }
    const puzzle = parseDarts501Puzzle(puzzleJson);
    const formula = puzzle ? darts501FormulaById(puzzle.formulaId) : undefined;
    if (!puzzle || !formula) throw new VsError('Football 501 puzzle is missing a formula', 500, 'PUZZLE_FAILED');

    const playerIds = [...new Set(body.playerIds as string[])];
    const values = await playerValuesForDarts501(formula, playerIds);
    let remaining = puzzle.startScore;
    let inCheckout = false;
    let checkoutBusts = 0;
    let won = false;

    for (const id of playerIds) {
      const resolved = values.get(id);
      const result = resolveDarts501Throw({
        remaining,
        score: resolved?.score ?? 0,
        inCheckout,
        checkoutBusts,
        wrongCategory: !resolved?.eligible,
      });
      remaining = result.remaining;
      inCheckout = result.inCheckout;
      checkoutBusts = result.checkoutBusts;
      if (result.kind === 'perfect' || result.kind === 'checkout') {
        won = true;
        break;
      }
      if (result.kind === 'game_over') break;
    }

    return {
      score: won ? 10_000 - playerIds.length : -remaining,
      displayScore: remaining,
    };
  }

  throw new VsError('Unsupported VS mode', 400, 'INVALID_MODE');
}

export async function createVsChallenge(hostUserId: string, modeIdRaw: string): Promise<VsChallengeView> {
  if (!isVsModeId(modeIdRaw)) {
    throw new VsError('Pick Draft XI, Back Yourself, Football 501 or Target Man', 400, 'INVALID_MODE');
  }
  const modeId: VsModeId = modeIdRaw;
  const seedKey = `vs:${modeId}:${randomUUID()}`;

  let generated: { puzzle: unknown; answer: unknown };
  try {
    generated = await generateVsPuzzle(modeId, seedKey);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not generate a challenge right now. Try again.';
    throw new VsError(message, 503, 'PUZZLE_FAILED');
  }

  let code = generateCode();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const [row] = await db
        .insert(vsChallenges)
        .values({
          code,
          modeId,
          hostUserId,
          status: 'waiting',
          puzzleJson: generated.puzzle,
          answerJson: generated.answer,
          participantsJson: [emptyParticipant(hostUserId)],
          expiresAt: new Date(Date.now() + TTL_MS),
        })
        .returning();
      if (!row) throw new VsError('Failed to create challenge', 500, 'CREATE_FAILED');
      return viewFor(row, hostUserId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('vs_challenges_code_unique') || msg.includes('duplicate')) {
        code = generateCode();
        continue;
      }
      throw err;
    }
  }
  throw new VsError('Failed to allocate a challenge code', 500, 'CODE_FAILED');
}

export async function reshuffleVsChallenge(userId: string, challengeId: string): Promise<VsChallengeView> {
  const row = await requireParticipant(challengeId, userId);
  if (row.hostUserId !== userId) {
    throw new VsError('Only the host can change the category', 403, 'FORBIDDEN');
  }
  if (row.status !== 'waiting') {
    throw new VsError('The game has already started', 400, 'STARTED');
  }
  if (!isVsModeId(row.modeId)) {
    throw new VsError('Unsupported VS mode', 400, 'INVALID_MODE');
  }

  const currentTitle = vsPuzzleMeta(row.modeId, row.puzzleJson).title;
  const seedKey = `vs:${row.modeId}:${randomUUID()}`;
  let generated: { puzzle: unknown; answer: unknown };
  try {
    generated = await generateVsPuzzle(row.modeId, seedKey, { excludeTitle: currentTitle });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not change the category right now. Try again.';
    throw new VsError(message, 503, 'PUZZLE_FAILED');
  }

  const updated = await persistRow(row.id, {
    puzzleJson: generated.puzzle,
    answerJson: generated.answer,
  });
  return viewFor(updated ?? { ...row, puzzleJson: generated.puzzle, answerJson: generated.answer }, userId);
}

export async function joinVsChallenge(userId: string, rawCode: string): Promise<VsChallengeView> {
  const code = rawCode.trim().toUpperCase();
  if (!code) throw new VsError('Enter a code', 400, 'INVALID_CODE');

  const [row] = await db.select().from(vsChallenges).where(eq(vsChallenges.code, code)).limit(1);
  if (!row) throw new VsError('No challenge found for that code', 404, 'NOT_FOUND');

  let current = row;
  if (isExpired(current) && current.status !== 'complete') {
    current = await markExpired(current);
  }
  if (current.status === 'expired') {
    throw new VsError('This challenge has expired', 410, 'EXPIRED');
  }

  const people = participantsOf(current);
  if (people.some((p) => p.userId === userId) || current.hostUserId === userId) {
    return viewFor(current, userId);
  }
  if (current.status !== 'waiting') {
    throw new VsError('This challenge has already started', 409, 'STARTED');
  }
  if (people.length >= VS_MAX_PLAYERS) {
    throw new VsError('This challenge is already full', 409, 'FULL');
  }

  const next = [...people, emptyParticipant(userId)];
  const nextStatus = next.length >= VS_MAX_PLAYERS ? 'active' : current.status;
  const liveJson =
    nextStatus === 'active' ? liveJsonForActive(current, next.map((p) => p.userId)) : current.liveJson;

  const [updated] = await db
    .update(vsChallenges)
    .set({
      participantsJson: next,
      guestUserId: current.guestUserId ?? userId,
      status: nextStatus,
      liveJson,
    })
    .where(and(eq(vsChallenges.id, current.id), eq(vsChallenges.status, 'waiting')))
    .returning();

  if (!updated) {
    throw new VsError('This challenge is already full', 409, 'FULL');
  }
  return viewFor(updated, userId);
}

export async function startVsChallenge(userId: string, challengeId: string): Promise<VsChallengeView> {
  const row = await requireParticipant(challengeId, userId);
  if (row.status === 'expired') {
    throw new VsError('This challenge has expired', 410, 'EXPIRED');
  }
  if (row.hostUserId !== userId) {
    throw new VsError('Only the host can start this challenge', 403, 'FORBIDDEN');
  }
  if (row.status === 'active' || row.status === 'complete') {
    return viewFor(row, userId);
  }
  if (row.status !== 'waiting') {
    throw new VsError('This challenge cannot be started', 400, 'INVALID_STATUS');
  }
  if (participantsOf(row).length < 2) {
    throw new VsError('Wait for at least one friend to join', 400, 'WAITING');
  }

  const [updated] = await db
    .update(vsChallenges)
    .set({
      status: 'active',
      liveJson: draftLiveForStart(row) ?? liveJsonForActive(row, participantsOf(row).map((p) => p.userId)) ?? row.liveJson,
    })
    .where(and(eq(vsChallenges.id, row.id), eq(vsChallenges.status, 'waiting')))
    .returning();

  return viewFor(updated ?? row, userId);
}

function draftWrongReason(
  constraint: { type: string; label: string; club: string | null; leagueName: string | null; nationality: string | null },
  playerName: string,
  reason: 'missing' | 'position' | 'constraint'
): string {
  if (reason === 'position') return `${playerName} doesn't play this position`;
  switch (constraint.type) {
    case 'club':
      return `${playerName} never played for ${constraint.club ?? constraint.label}`;
    case 'league':
      return `${playerName} never played in ${constraint.leagueName ?? constraint.label}`;
    case 'nationality':
      return `${playerName} isn't ${constraint.nationality ?? constraint.label}`;
    default:
      return `${playerName} doesn't fit ${constraint.label}`;
  }
}

export async function lockVsPick(
  userId: string,
  challengeId: string,
  input: { slotId: string; constraintId: string; playerId: string }
): Promise<VsChallengeView> {
  const row = await syncLiveDraft(await requireParticipant(challengeId, userId));
  if (row.status === 'expired') {
    throw new VsError('This challenge has expired', 410, 'EXPIRED');
  }
  if (row.status !== 'active' || row.modeId !== 'draft_master') {
    throw new VsError('This challenge is not a live Draft XI', 400, 'INVALID_STATUS');
  }

  const puzzle = row.puzzleJson as BattlePuzzleJson;
  const live = liveStateOf(row);
  if (!live || live.finished) {
    return viewFor(row, userId);
  }

  const userIds = participantsOf(row).map((p) => p.userId);
  const slot = puzzle.slots.find((s) => s.id === input.slotId);
  if (!slot) {
    throw new VsError('Unknown position', 400, 'WRONG_SLOT');
  }
  if (turnUserId(live, userIds, puzzle.slots.length) !== userId) {
    throw new VsError('Wait for your turn', 400, 'NOT_YOUR_TURN');
  }
  if (Date.now() >= Date.parse(live.deadlineAt)) {
    return viewFor(row, userId);
  }
  if (hasLocked(live, userId, slot.id)) {
    throw new VsError('You already filled that position', 400, 'SLOT_USED');
  }
  if (usedConstraintIds(live, userId).has(input.constraintId)) {
    throw new VsError('You already used that constraint', 400, 'CONSTRAINT_USED');
  }
  if (usedPlayerIds(live).has(input.playerId)) {
    throw new VsError('Someone already named that player', 400, 'PLAYER_USED');
  }

  const constraint = puzzle.constraints.find((c) => c.id === input.constraintId);
  if (!constraint) throw new VsError('Unknown constraint', 400, 'INVALID_ANSWER');

  const scored = await scoreBattlePick(puzzle, input);
  if (!scored.valid && (scored.reason === 'missing' || !scored.playerName)) {
    throw new VsError('Invalid Draft XI pick', 400, 'INVALID_ANSWER');
  }

  const playerName = scored.playerName ?? 'Player';
  const pick = {
    slotId: slot.id,
    constraintId: constraint.id,
    playerId: input.playerId,
    playerName,
    headshotUrl: scored.headshotUrl ?? null,
    constraintLabel: constraint.label,
    statValue: scored.valid ? scored.stat : 0,
    lockedAt: new Date().toISOString(),
    correct: scored.valid,
    wrongReason: scored.valid ? null : draftWrongReason(constraint, playerName, scored.reason),
  };
  const nextLive: VsLiveState = {
    ...live,
    picksByUser: {
      ...live.picksByUser,
      [userId]: [...picksFor(live, userId), pick],
    },
  };

  const advanced = afterSuccessfulPick(puzzle, nextLive, userIds);
  if (advanced.finished) {
    return viewFor(await finishLiveDraft(row, advanced), userId);
  }

  const updated = await persistRow(row.id, { liveJson: advanced });
  return viewFor(updated ?? { ...row, liveJson: advanced }, userId);
}

export async function getVsChallenge(userId: string, challengeId: string): Promise<VsChallengeView> {
  const row = await requireParticipant(challengeId, userId);
  return viewFor(row, userId);
}

/** Most recent unfinished challenge the user is still in (waiting / active). */
export async function getActiveVsChallenge(userId: string): Promise<VsChallengeView | null> {
  const now = new Date();
  const rows = await db
    .select()
    .from(vsChallenges)
    .where(and(gt(vsChallenges.expiresAt, now), inArray(vsChallenges.status, ['waiting', 'active'])));

  const mine = rows.filter((row) => {
    if (row.hostUserId === userId) return true;
    return participantsOf(row).some((p) => p.userId === userId);
  });
  if (mine.length === 0) return null;
  mine.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return viewFor(mine[0]!, userId);
}

export async function submitVsChallenge(
  userId: string,
  challengeId: string,
  rawAnswer: unknown,
  picks?: Array<{ slotId: string; constraintId: string; playerId: string }>
): Promise<VsChallengeView> {
  const row = await requireParticipant(challengeId, userId);
  if (row.status === 'expired') {
    throw new VsError('This challenge has expired', 410, 'EXPIRED');
  }
  if (row.status === 'waiting') {
    throw new VsError('Waiting for the host to start', 400, 'WAITING');
  }
  if (row.modeId === 'draft_master' && liveStateOf(row)) {
    throw new VsError('This Draft XI is live — lock each slot instead', 400, 'LIVE');
  }
  if (row.modeId === 'back_yourself' && parseHotseat(row.liveJson)) {
    throw new VsError('This Back Yourself is live — name on your turn instead', 400, 'LIVE');
  }
  if (row.modeId === 'target_man' && parseTargetMan(row.liveJson)) {
    throw new VsError('This Target Man is live — name on your turn instead', 400, 'LIVE');
  }
  if (row.modeId === 'darts_501' && parseDarts501(row.liveJson)) {
    throw new VsError('This Football 501 is live — throw on your turn instead', 400, 'LIVE');
  }

  const people = participantsOf(row);
  const you = people.find((p) => p.userId === userId);
  if (!you) throw new VsError('Not in this challenge', 403, 'FORBIDDEN');
  if (you.completedAt != null) {
    return viewFor(row, userId);
  }

  const answer = normalizeSubmitAnswer(rawAnswer, picks);
  const scored = await scoreVsAnswer(row.modeId, row.puzzleJson, row.answerJson, answer);
  const now = new Date().toISOString();
  const next = people.map((p) =>
    p.userId === userId
      ? { ...p, score: scored.score, displayScore: scored.displayScore, answerJson: answer, completedAt: now }
      : p
  );
  const allDone = next.length >= 2 && next.every((p) => p.completedAt != null);

  const [updated] = await db
    .update(vsChallenges)
    .set({
      participantsJson: next,
      ...(row.hostUserId === userId
        ? { hostScore: scored.displayScore, hostAnswerJson: answer, hostCompletedAt: new Date(now) }
        : { guestScore: scored.displayScore, guestAnswerJson: answer, guestCompletedAt: new Date(now) }),
      ...(allDone ? { status: 'complete' } : {}),
    })
    .where(eq(vsChallenges.id, row.id))
    .returning();

  if (!updated) throw new VsError('Failed to submit', 500, 'SUBMIT_FAILED');
  return viewFor(updated, userId);
}

export async function nameVsHotseat(userId: string, challengeId: string, playerId: string): Promise<VsChallengeView> {
  const row = await syncHotseat(await requireParticipant(challengeId, userId));
  if (row.status === 'expired') throw new VsError('This challenge has expired', 410, 'EXPIRED');
  if (row.status !== 'active' || row.modeId !== 'back_yourself') {
    throw new VsError('This challenge is not a live Back Yourself', 400, 'INVALID_STATUS');
  }
  const hotseat = parseHotseat(row.liveJson);
  if (!hotseat || hotseat.finished) return viewFor(row, userId);
  if (hotseat.turnUserId !== userId) {
    throw new VsError('Wait for your turn', 400, 'NOT_YOUR_TURN');
  }
  if (Date.now() >= Date.parse(hotseat.deadlineAt)) {
    return viewFor(row, userId);
  }
  if (namedPlayerIds(hotseat).has(playerId)) {
    throw new VsError('Already named', 400, 'DUPLICATE');
  }

  const stored = row.answerJson as { validPlayerIds?: string[] } | undefined;
  const validSet = new Set(stored?.validPlayerIds ?? []);
  const puzzle = row.puzzleJson as { category?: BackYourselfCategory };
  const liveMatch = puzzle.category
    ? await playerMatchesBackYourselfCategory(playerId, puzzle.category)
    : false;
  const inPool = liveMatch || validSet.has(playerId);
  if (!inPool) {
    const next = eliminatePlayer(hotseat, userId);
    if (next.finished) return viewFor(await finishHotseat(row, next), userId);
    const updated = await persistRow(row.id, { liveJson: next });
    return viewFor(updated ?? { ...row, liveJson: next }, userId);
  }

  const card = await resolveBackYourselfPlayerCard(playerId);
  const next: VsHotseatState = passTurn(
    {
      ...hotseat,
      named: [
        ...hotseat.named,
        {
          userId,
          playerId,
          playerName: card?.name ?? 'Player',
          headshotUrl: card?.headshotUrl ?? null,
          namedAt: new Date().toISOString(),
        },
      ],
    },
    userId
  );

  if (next.finished) return viewFor(await finishHotseat(row, next), userId);
  const updated = await persistRow(row.id, { liveJson: next });
  return viewFor(updated ?? { ...row, liveJson: next }, userId);
}

export async function giveUpVsHotseat(userId: string, challengeId: string): Promise<VsChallengeView> {
  const row = await syncHotseat(await requireParticipant(challengeId, userId));
  if (row.status === 'expired') throw new VsError('This challenge has expired', 410, 'EXPIRED');
  if (row.status !== 'active' || row.modeId !== 'back_yourself') {
    throw new VsError('This challenge is not a live Back Yourself', 400, 'INVALID_STATUS');
  }
  const hotseat = parseHotseat(row.liveJson);
  if (!hotseat || hotseat.finished) return viewFor(row, userId);
  if (hotseat.turnUserId !== userId) {
    throw new VsError('Wait for your turn', 400, 'NOT_YOUR_TURN');
  }
  const next = eliminatePlayer(hotseat, userId);
  if (next.finished) return viewFor(await finishHotseat(row, next), userId);
  const updated = await persistRow(row.id, { liveJson: next });
  return viewFor(updated ?? { ...row, liveJson: next }, userId);
}

export async function pickVsTargetMan(userId: string, challengeId: string, playerId: string): Promise<VsChallengeView> {
  const row = await syncTargetMan(await requireParticipant(challengeId, userId));
  if (row.status === 'expired') throw new VsError('This challenge has expired', 410, 'EXPIRED');
  if (row.status !== 'active' || row.modeId !== 'target_man') {
    throw new VsError('This challenge is not a live Target Man', 400, 'INVALID_STATUS');
  }
  const live = parseTargetMan(row.liveJson);
  if (!live || live.finished) return viewFor(row, userId);

  const userIds = participantsOf(row).map((p) => p.userId);
  if (targetManTurnUserId(live, userIds, live.slotIndex) !== userId) {
    throw new VsError('Wait for your turn', 400, 'NOT_YOUR_TURN');
  }
  if (Date.now() >= Date.parse(live.deadlineAt)) {
    return viewFor(row, userId);
  }
  if (targetManHasLocked(live, userId, live.slotIndex)) {
    return viewFor(row, userId);
  }
  if (targetManUsedPlayerIds(live).has(playerId)) {
    throw new VsError('Someone already named that player', 400, 'PLAYER_USED');
  }

  const meta = targetManPuzzleMeta(row.puzzleJson);
  if (!meta.categoryId) {
    throw new VsError('Target Man puzzle is missing a category', 500, 'PUZZLE_FAILED');
  }
  const values = await playerValuesForCategory(meta.categoryId, [playerId], normalizeTargetManPool(meta.pool));
  const resolved = values[0];
  if (resolved && resolved.inPool === false) {
    throw new VsError("Doesn't fit this Target Man", 400, 'INVALID_ANSWER');
  }

  const card = await resolveBackYourselfPlayerCard(playerId);
  if (!card) {
    throw new VsError('Unknown player', 400, 'INVALID_ANSWER');
  }

  const nextLive: VsTargetManState = {
    ...live,
    picksByUser: {
      ...live.picksByUser,
      [userId]: [
        ...targetManPicksFor(live, userId),
        {
          slotIndex: live.slotIndex,
          playerId,
          playerName: card.name,
          headshotUrl: card.headshotUrl ?? null,
          statValue: resolved?.value ?? 0,
          lockedAt: new Date().toISOString(),
        },
      ],
    },
  };

  const advanced = afterTargetManPick(nextLive, userIds);
  if (advanced.finished) {
    return viewFor(await finishTargetMan(row, advanced), userId);
  }
  const updated = await persistRow(row.id, { liveJson: advanced });
  return viewFor(updated ?? { ...row, liveJson: advanced }, userId);
}

export async function throwVsDarts501(userId: string, challengeId: string, playerId: string): Promise<VsChallengeView> {
  const row = await syncDarts501(await requireParticipant(challengeId, userId));
  if (row.status === 'expired') throw new VsError('This challenge has expired', 410, 'EXPIRED');
  if (row.status !== 'active' || row.modeId !== 'darts_501') {
    throw new VsError('This challenge is not a live Football 501', 400, 'INVALID_STATUS');
  }
  const live = parseDarts501(row.liveJson);
  if (!live || live.finished) return viewFor(row, userId);
  if (live.turnUserId !== userId) {
    throw new VsError('Wait for your turn', 400, 'NOT_YOUR_TURN');
  }
  if (Date.now() >= Date.parse(live.deadlineAt)) {
    return viewFor(row, userId);
  }
  if (darts501UsedPlayerIds(live).has(playerId)) {
    throw new VsError('Someone already named that player', 400, 'PLAYER_USED');
  }

  const puzzle = parseDarts501Puzzle(row.puzzleJson);
  const formula = puzzle ? darts501FormulaById(puzzle.formulaId) : undefined;
  if (!puzzle || !formula) {
    throw new VsError('Football 501 puzzle is missing a formula', 500, 'PUZZLE_FAILED');
  }

  const values = await playerValuesForDarts501(formula, [playerId]);
  const resolved = values.get(playerId);
  const board = darts501PlayerState(live, userId);
  const result = resolveDarts501ThrowLive({
    remaining: board.remaining,
    score: resolved?.score ?? 0,
    inCheckout: board.inCheckout,
    checkoutBusts: board.checkoutBusts,
    wrongCategory: !resolved?.eligible,
  });

  const card = await resolveBackYourselfPlayerCard(playerId);
  if (!card) {
    throw new VsError('Unknown player', 400, 'INVALID_ANSWER');
  }

  const kind = result.kind === 'perfect' || result.kind === 'checkout' || result.kind === 'score' || result.kind === 'bust'
    ? result.kind
    : 'bust';

  const canCheckoutIds: string[] = [];
  if ((kind === 'checkout' || kind === 'perfect') && live.redemptionQueue.length === 0) {
    const used = [...darts501UsedPlayerIds(live), playerId];
    for (const id of darts501PlayersAfter(live.order, userId)) {
      const later = darts501PlayerState(live, id);
      const options = await countDarts501CheckoutsForPuzzle(puzzle, later.remaining, used);
      if (options > 0) canCheckoutIds.push(id);
    }
  }

  const next = applyDarts501Throw(
    live,
    {
      userId,
      playerId,
      playerName: card.name,
      headshotUrl: card.headshotUrl ?? null,
      score: resolved?.score ?? 0,
      kind,
      bustReason: result.bustReason,
      remainingAfter: result.remaining,
      thrownAt: new Date().toISOString(),
    },
    {
      remaining: result.remaining,
      inCheckout: result.inCheckout,
      checkoutBusts: result.checkoutBusts,
    },
    Date.now(),
    canCheckoutIds
  );

  if (next.finished) {
    return viewFor(await finishDarts501(row, next), userId);
  }
  const updated = await persistRow(row.id, { liveJson: next });
  return viewFor(updated ?? { ...row, liveJson: next }, userId);
}

export async function respondVsDarts501Draw(
  userId: string,
  challengeId: string,
  action: 'offer' | 'accept' | 'decline'
): Promise<VsChallengeView> {
  const row = await syncDarts501(await requireParticipant(challengeId, userId));
  if (row.status === 'expired') throw new VsError('This challenge has expired', 410, 'EXPIRED');
  if (row.status !== 'active' || row.modeId !== 'darts_501') {
    throw new VsError('This challenge is not a live Football 501', 400, 'INVALID_STATUS');
  }
  const live = parseDarts501(row.liveJson);
  if (!live || live.finished) return viewFor(row, userId);

  const next =
    action === 'offer'
      ? offerDarts501Draw(live, userId)
      : action === 'accept'
        ? acceptDarts501Draw(live, userId)
        : declineDarts501Draw(live, userId);

  if (next.finished) {
    return viewFor(await finishDarts501(row, next), userId);
  }
  const updated = await persistRow(row.id, { liveJson: next });
  return viewFor(updated ?? { ...row, liveJson: next }, userId);
}

export type VsLeaveResult = {
  ended: boolean;
};

async function expireChallenge(row: VsChallenge): Promise<void> {
  await persistRow(row.id, { status: 'expired' });
}

function liveJsonAfterLeave(row: VsChallenge, userId: string, remainingIds: string[]): unknown {
  if (row.modeId === 'back_yourself') {
    const hotseat = parseHotseat(row.liveJson);
    return hotseat ? eliminatePlayer(hotseat, userId) : row.liveJson;
  }
  if (row.modeId === 'darts_501') {
    const live = parseDarts501(row.liveJson);
    return live ? dropDarts501User(live, userId) : row.liveJson;
  }
  if (row.modeId === 'target_man') {
    const live = parseTargetMan(row.liveJson);
    if (!live) return row.liveJson;
    const next = dropTargetManUser(live, userId);
    const advanced = advanceTargetMan(next, remainingIds);
    if (advanced.finished) return advanced;
    return { ...advanced, deadlineAt: new Date(Date.now() + VS_TARGET_MAN_TURN_MS).toISOString() };
  }
  if (row.modeId === 'draft_master') {
    const live = liveStateOf(row);
    if (!live) return row.liveJson;
    const picksByUser = { ...live.picksByUser };
    delete picksByUser[userId];
    const next = { ...live, picksByUser };
    const puzzle = row.puzzleJson as BattlePuzzleJson;
    if (Array.isArray(puzzle.slots) && puzzle.slots.length > 0) {
      const advanced = advanceIfNeeded(puzzle, next, remainingIds);
      if (advanced.finished) return advanced;
      return { ...advanced, deadlineAt: new Date(Date.now() + VS_SLOT_TIMEOUT_MS).toISOString() };
    }
    return next;
  }
  return row.liveJson;
}

export async function cancelVsChallenge(userId: string, challengeId: string): Promise<VsLeaveResult> {
  const row = await requireParticipant(challengeId, userId);
  if (row.hostUserId !== userId) {
    throw new VsError('Only the host can cancel this challenge', 403, 'FORBIDDEN');
  }
  if (row.status === 'complete') {
    throw new VsError('This challenge is already finished', 400, 'INVALID_STATUS');
  }
  if (row.status !== 'expired') {
    await expireChallenge(row);
  }
  return { ended: true };
}

export async function leaveVsChallenge(userId: string, challengeId: string): Promise<VsLeaveResult> {
  const row = await requireParticipant(challengeId, userId);
  if (row.status === 'expired') return { ended: true };
  if (row.status === 'complete') {
    throw new VsError('This challenge is already finished', 400, 'INVALID_STATUS');
  }
  if (row.hostUserId === userId) {
    throw new VsError('The host should cancel the challenge instead', 400, 'HOST_CANCEL');
  }

  const people = participantsOf(row);
  if (!people.some((p) => p.userId === userId)) {
    throw new VsError('Not in this challenge', 403, 'FORBIDDEN');
  }

  if (people.length <= 2) {
    await expireChallenge(row);
    return { ended: true };
  }

  const next = people.filter((p) => p.userId !== userId);
  const remainingIds = next.map((p) => p.userId);
  const liveJson = liveJsonAfterLeave(row, userId, remainingIds);
  const hotseat = parseHotseat(liveJson);
  const live = parseLiveState(liveJson);
  const targetMan = parseTargetMan(liveJson);
  const darts501 = parseDarts501(liveJson);
  const allSubmitted = next.length >= 2 && next.every((p) => p.completedAt != null);

  if (hotseat?.finished) {
    await finishHotseat({ ...row, participantsJson: next, liveJson }, hotseat);
    return { ended: false };
  }
  if (live?.finished && row.modeId === 'draft_master') {
    await finishLiveDraft({ ...row, participantsJson: next, liveJson }, live);
    return { ended: false };
  }
  if (targetMan?.finished && row.modeId === 'target_man') {
    await finishTargetMan({ ...row, participantsJson: next, liveJson }, targetMan);
    return { ended: false };
  }
  if (darts501?.finished && row.modeId === 'darts_501') {
    await finishDarts501({ ...row, participantsJson: next, liveJson }, darts501);
    return { ended: false };
  }

  const guest = next.find((p) => p.userId !== row.hostUserId);
  await persistRow(row.id, {
    participantsJson: next,
    guestUserId: guest?.userId ?? null,
    liveJson,
    ...(allSubmitted ? { status: 'complete' } : {}),
  });
  return { ended: false };
}
