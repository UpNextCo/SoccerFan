import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq, gt, inArray } from 'drizzle-orm';
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
  answerFromLive,
  currentSlot,
  hasLocked,
  initLiveState,
  parseLiveState,
  picksFor,
  shortSlotLabel,
  totalFor,
  usedConstraintIds,
  usedPlayerIds,
  type VsLiveState,
} from './vsLiveDraft.js';
import { sanitizePublicPuzzle } from './dailyService.js';
import {
  playerValuesForCategory,
  normalizeTargetManPool,
} from './targetManCategories.js';
import {
  darts501FormulaById,
  parseDarts501Puzzle,
  playerValuesForDarts501,
} from './darts501Generator.js';
import { resolveDarts501Throw } from './darts501Scoring.js';
import {
  generateVsPuzzle,
  isVsModeId,
  VS_MAX_PLAYERS,
  vsPuzzleMeta,
  type VsModeId,
} from './vsPuzzle.js';

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
  score: number | null;
  displayScore: number | null;
  completed: boolean;
  isYou: boolean;
  isHost: boolean;
};

export type VsRankingView = {
  userId: string;
  displayName: string;
  score: number;
  displayScore: number;
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
  };
  live: VsLiveView | null;
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

export type VsLiveView = {
  slotIndex: number;
  slotCount: number;
  slotId: string;
  slotLabel: string;
  slotPosition: string;
  deadlineAt: string;
  youLocked: boolean;
  finished: boolean;
  usedConstraintIds: string[];
  usedPlayerIds: string[];
  board: VsLiveBoardRow[];
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

async function loadUsers(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, unique));
  return new Map(rows.map((r) => [r.id, r.displayName]));
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
  names: Map<string, string>
): VsLiveView | null {
  if (row.modeId !== 'draft_master' || row.status !== 'active') return null;
  const live = liveStateOf(row);
  const puzzle = row.puzzleJson as BattlePuzzleJson;
  if (!live || !Array.isArray(puzzle.slots)) return null;
  const slot = currentSlot(puzzle, live);
  const people = participantsOf(row);
  const slotId = slot?.id ?? '';
  return {
    slotIndex: live.slotIndex,
    slotCount: puzzle.slots.length,
    slotId,
    slotLabel: slot ? shortSlotLabel(slot.position) : '—',
    slotPosition: slot?.position ?? '',
    deadlineAt: live.deadlineAt,
    youLocked: slotId ? hasLocked(live, userId, slotId) : true,
    finished: live.finished,
    usedConstraintIds: [...usedConstraintIds(live, userId)],
    usedPlayerIds: [...usedPlayerIds(live, userId)],
    board: people.map((p) => {
      const pick = slotId ? picksFor(live, p.userId).find((x) => x.slotId === slotId) : undefined;
      return {
        userId: p.userId,
        displayName: names.get(p.userId) ?? 'Player',
        isYou: p.userId === userId,
        total: totalFor(live, p.userId),
        locked: pick != null,
        playerName: pick?.playerName ?? null,
        constraintLabel: pick?.constraintLabel ?? null,
        statValue: pick?.statValue ?? null,
        headshotUrl: pick?.headshotUrl ?? null,
      };
    }),
  };
}

function liveTotals(row: VsChallenge): Map<string, number> | null {
  const live = liveStateOf(row);
  if (!live || row.modeId !== 'draft_master') return null;
  return new Map(participantsOf(row).map((p) => [p.userId, totalFor(live, p.userId)]));
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

function draftLiveForStart(row: VsChallenge): VsLiveState | null {
  if (row.modeId !== 'draft_master') return null;
  return liveStateOf(row) ?? initLiveState(participantsOf(row).map((p) => p.userId));
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

function toView(row: VsChallenge, userId: string, names: Map<string, string>): VsChallengeView {
  const people = participantsOf(row);
  const youAreHost = row.hostUserId === userId;
  const you = people.find((p) => p.userId === userId);
  const youCompleted = you?.completedAt != null;
  const allDone = people.length >= 2 && people.every((p) => p.completedAt != null);
  const completed = people
    .filter((p) => p.completedAt != null && p.score != null)
    .map((p) => ({ userId: p.userId, score: p.score as number, displayScore: p.displayScore ?? p.score ?? 0 }));
  const { winnerUserId, isDraw } = allDone ? rankingWinner(completed) : { winnerUserId: null, isDraw: false };

  const publicPuzzle = sanitizePublicPuzzle(row.modeId, row.puzzleJson);
  const meta = vsPuzzleMeta(row.modeId, row.puzzleJson);
  const running = liveTotals(row);
  const players: VsPlayerView[] = people.map((p) => {
    const liveScore = running?.get(p.userId);
    const score = p.displayScore ?? liveScore ?? null;
    return {
      userId: p.userId,
      displayName: names.get(p.userId) ?? 'Player',
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
        .sort((a, b) => b.score - a.score)
        .map((p) => ({
          userId: p.userId,
          displayName: names.get(p.userId) ?? 'Player',
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
    },
    live: liveViewFor(row, userId, names),
  };
}

async function viewFor(row: VsChallenge, userId: string): Promise<VsChallengeView> {
  const synced = await syncLiveDraft(row);
  const ids = participantsOf(synced).map((p) => p.userId);
  const names = await loadUsers(ids);
  return toView(synced, userId, names);
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
    nextStatus === 'active' && current.modeId === 'draft_master'
      ? (liveStateOf(current) ?? initLiveState(next.map((p) => p.userId)))
      : current.liveJson;

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
      liveJson: draftLiveForStart(row) ?? row.liveJson,
    })
    .where(and(eq(vsChallenges.id, row.id), eq(vsChallenges.status, 'waiting')))
    .returning();

  return viewFor(updated ?? row, userId);
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

  const slot = currentSlot(puzzle, live);
  if (!slot || slot.id !== input.slotId) {
    throw new VsError('That position is not open right now', 400, 'WRONG_SLOT');
  }
  if (Date.now() >= Date.parse(live.deadlineAt)) {
    return viewFor(row, userId);
  }
  if (hasLocked(live, userId, slot.id)) {
    return viewFor(row, userId);
  }
  if (usedConstraintIds(live, userId).has(input.constraintId)) {
    throw new VsError('You already used that constraint', 400, 'CONSTRAINT_USED');
  }
  if (usedPlayerIds(live, userId).has(input.playerId)) {
    throw new VsError('That player is already in your XI', 400, 'PLAYER_USED');
  }

  const constraint = puzzle.constraints.find((c) => c.id === input.constraintId);
  if (!constraint) throw new VsError('Unknown constraint', 400, 'INVALID_ANSWER');

  const scored = await scoreBattlePick(puzzle, input);
  if (!scored.valid) {
    if (scored.reason === 'position') {
      throw new VsError('That player does not play this position', 400, 'INVALID_ANSWER');
    }
    if (scored.reason === 'constraint') {
      throw new VsError('That player does not fit this constraint', 400, 'INVALID_ANSWER');
    }
    throw new VsError('Invalid Draft XI pick', 400, 'INVALID_ANSWER');
  }

  const pick = {
    slotId: slot.id,
    constraintId: constraint.id,
    playerId: input.playerId,
    playerName: scored.playerName,
    headshotUrl: scored.headshotUrl,
    constraintLabel: constraint.label,
    statValue: scored.stat,
    lockedAt: new Date().toISOString(),
  };
  const nextLive: VsLiveState = {
    ...live,
    picksByUser: {
      ...live.picksByUser,
      [userId]: [...picksFor(live, userId), pick],
    },
  };

  const userIds = participantsOf(row).map((p) => p.userId);
  const advanced = advanceIfNeeded(puzzle, nextLive, userIds);
  if (advanced.finished) {
    return viewFor(await finishLiveDraft(row, advanced), userId);
  }

  const updated = await persistRow(row.id, { liveJson: advanced });
  return viewFor(updated ?? { ...row, liveJson: advanced }, userId);
}

export async function getVsChallenge(userId: string, challengeId: string): Promise<VsChallengeView> {
  const row = await requireParticipant(challengeId, userId);
  if (row.status === 'expired') {
    throw new VsError('This challenge has expired', 410, 'EXPIRED');
  }
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
