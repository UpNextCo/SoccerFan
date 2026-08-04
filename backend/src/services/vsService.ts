import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq, gt, inArray, isNull, or } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users, vsChallenges, type VsChallenge } from '../db/schema.js';
import {
  generateBattlePuzzleFromSeed,
  recomputeBattleScore,
  type BattlePuzzleJson,
} from './battleGenerator.js';
import { sanitizePublicPuzzle } from './dailyService.js';

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
  completed: boolean;
};

export type VsChallengeView = {
  id: string;
  code: string;
  modeId: string;
  status: string;
  expiresAt: string;
  youAreHost: boolean;
  host: VsPlayerView;
  guest: VsPlayerView | null;
  puzzle: unknown;
  optimalLineup?: BattlePuzzleJson['optimalLineup'];
  optimalScore?: number;
  categoryNoun: string;
  result: {
    bothDone: boolean;
    winner: 'host' | 'guest' | 'draw' | null;
    yourScore: number | null;
    theirScore: number | null;
  };
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
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, ids));
  return new Map(rows.map((r) => [r.id, r.displayName]));
}

function winnerOf(hostScore: number | null, guestScore: number | null): 'host' | 'guest' | 'draw' | null {
  if (hostScore == null || guestScore == null) return null;
  if (hostScore > guestScore) return 'host';
  if (guestScore > hostScore) return 'guest';
  return 'draw';
}

function toView(
  row: VsChallenge,
  userId: string,
  names: Map<string, string>
): VsChallengeView {
  const puzzle = row.puzzleJson as BattlePuzzleJson;
  const youAreHost = row.hostUserId === userId;
  const youCompleted = youAreHost ? row.hostCompletedAt != null : row.guestCompletedAt != null;
  const bothDone = row.hostCompletedAt != null && row.guestCompletedAt != null;
  const winner = winnerOf(row.hostScore, row.guestScore);

  const publicPuzzle = sanitizePublicPuzzle('draft_master', puzzle);
  const host: VsPlayerView = {
    userId: row.hostUserId,
    displayName: names.get(row.hostUserId) ?? 'Player',
    score: row.hostScore,
    completed: row.hostCompletedAt != null,
  };
  const guest: VsPlayerView | null = row.guestUserId
    ? {
        userId: row.guestUserId,
        displayName: names.get(row.guestUserId) ?? 'Player',
        score: row.guestScore,
        completed: row.guestCompletedAt != null,
      }
    : null;

  return {
    id: row.id,
    code: row.code,
    modeId: row.modeId,
    status: row.status,
    expiresAt: row.expiresAt.toISOString(),
    youAreHost,
    host,
    guest,
    puzzle: publicPuzzle,
    ...(youCompleted
      ? {
          optimalLineup: puzzle.optimalLineup,
          optimalScore: puzzle.optimalScore,
        }
      : {}),
    categoryNoun: puzzle.category?.noun ?? 'pts',
    result: {
      bothDone,
      winner: bothDone ? winner : null,
      yourScore: youAreHost ? row.hostScore : row.guestScore,
      theirScore: youAreHost ? row.guestScore : row.hostScore,
    },
  };
}

async function requireParticipant(challengeId: string, userId: string): Promise<VsChallenge> {
  const [row] = await db.select().from(vsChallenges).where(eq(vsChallenges.id, challengeId)).limit(1);
  if (!row) throw new VsError('Challenge not found', 404, 'NOT_FOUND');
  if (row.hostUserId !== userId && row.guestUserId !== userId) {
    throw new VsError('Not in this challenge', 403, 'FORBIDDEN');
  }
  if (isExpired(row) && row.status !== 'complete') {
    return markExpired(row);
  }
  return row;
}

export async function createVsChallenge(hostUserId: string): Promise<VsChallengeView> {
  const seedKey = `vs:${randomUUID()}`;
  const puzzle = await generateBattlePuzzleFromSeed(seedKey);
  if (!puzzle) {
    throw new VsError('Could not generate a Draft XI challenge right now. Try again.', 503, 'PUZZLE_FAILED');
  }

  let code = generateCode();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const [row] = await db
        .insert(vsChallenges)
        .values({
          code,
          modeId: 'draft_master',
          hostUserId,
          status: 'waiting',
          puzzleJson: puzzle,
          expiresAt: new Date(Date.now() + TTL_MS),
        })
        .returning();
      if (!row) throw new VsError('Failed to create challenge', 500, 'CREATE_FAILED');
      const names = await loadUsers([hostUserId]);
      return toView(row, hostUserId, names);
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
  if (current.hostUserId === userId) {
    const names = await loadUsers([current.hostUserId, current.guestUserId].filter(Boolean) as string[]);
    return toView(current, userId, names);
  }
  if (current.guestUserId === userId) {
    const names = await loadUsers([current.hostUserId, current.guestUserId]);
    return toView(current, userId, names);
  }
  if (current.guestUserId != null || current.status !== 'waiting') {
    throw new VsError('This challenge is already full', 409, 'FULL');
  }

  const [updated] = await db
    .update(vsChallenges)
    .set({ guestUserId: userId, status: 'active' })
    .where(and(eq(vsChallenges.id, current.id), isNull(vsChallenges.guestUserId), eq(vsChallenges.status, 'waiting')))
    .returning();

  if (!updated) {
    throw new VsError('This challenge is already full', 409, 'FULL');
  }

  const names = await loadUsers([updated.hostUserId, userId]);
  return toView(updated, userId, names);
}

export async function getVsChallenge(userId: string, challengeId: string): Promise<VsChallengeView> {
  const row = await requireParticipant(challengeId, userId);
  if (row.status === 'expired') {
    throw new VsError('This challenge has expired', 410, 'EXPIRED');
  }
  const ids = [row.hostUserId, row.guestUserId].filter(Boolean) as string[];
  const names = await loadUsers(ids);
  return toView(row, userId, names);
}

/** Most recent unfinished challenge the user is still in (waiting / active). */
export async function getActiveVsChallenge(userId: string): Promise<VsChallengeView | null> {
  const now = new Date();
  const rows = await db
    .select()
    .from(vsChallenges)
    .where(
      and(
        or(eq(vsChallenges.hostUserId, userId), eq(vsChallenges.guestUserId, userId)),
        gt(vsChallenges.expiresAt, now),
        inArray(vsChallenges.status, ['waiting', 'active'])
      )
    );

  if (rows.length === 0) return null;
  rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const chosen = rows[0]!;
  const names = await loadUsers([chosen.hostUserId, chosen.guestUserId].filter(Boolean) as string[]);
  return toView(chosen, userId, names);
}

export async function submitVsChallenge(
  userId: string,
  challengeId: string,
  picks: Array<{ slotId: string; constraintId: string; playerId: string }>
): Promise<VsChallengeView> {
  const row = await requireParticipant(challengeId, userId);
  if (row.status === 'expired') {
    throw new VsError('This challenge has expired', 410, 'EXPIRED');
  }
  if (row.status === 'waiting') {
    throw new VsError('Waiting for an opponent to join', 400, 'WAITING');
  }

  const youAreHost = row.hostUserId === userId;
  if (youAreHost && row.hostCompletedAt != null) {
    const names = await loadUsers([row.hostUserId, row.guestUserId].filter(Boolean) as string[]);
    return toView(row, userId, names);
  }
  if (!youAreHost && row.guestCompletedAt != null) {
    const names = await loadUsers([row.hostUserId, row.guestUserId].filter(Boolean) as string[]);
    return toView(row, userId, names);
  }

  const puzzle = row.puzzleJson as BattlePuzzleJson;
  const { total } = await recomputeBattleScore(puzzle, picks);
  const now = new Date();

  const patch = youAreHost
    ? {
        hostScore: total,
        hostAnswerJson: { picks },
        hostCompletedAt: now,
      }
    : {
        guestScore: total,
        guestAnswerJson: { picks },
        guestCompletedAt: now,
      };

  const bothDone =
    (youAreHost ? true : row.hostCompletedAt != null) &&
    (!youAreHost ? true : row.guestCompletedAt != null);

  const [updated] = await db
    .update(vsChallenges)
    .set({
      ...patch,
      ...(bothDone ? { status: 'complete' } : {}),
    })
    .where(eq(vsChallenges.id, row.id))
    .returning();

  if (!updated) throw new VsError('Failed to submit', 500, 'SUBMIT_FAILED');
  const names = await loadUsers([updated.hostUserId, updated.guestUserId].filter(Boolean) as string[]);
  return toView(updated, userId, names);
}
