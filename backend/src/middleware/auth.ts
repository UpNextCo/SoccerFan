import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users, type User } from '../db/schema.js';

export interface AuthPayload {
  userId: string;
  appleSub: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: User;
      auth?: AuthPayload;
    }
  }
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return secret;
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: '30d' });
}

export function verifyToken(token: string): AuthPayload {
  return jwt.verify(token, getJwtSecret()) as AuthPayload;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USER_EXISTS_TTL_MS = 60_000;
const USER_EXISTS_MAX_ENTRIES = 20_000;

/** userId -> epoch ms until which we trust that the account exists. Positives only. */
const knownUsers = new Map<string, number>();

export function forgetUser(userId: string): void {
  knownUsers.delete(userId);
}

/**
 * Tokens last 30 days, so one can outlive its account (deleted account, wiped database). Without
 * this check the app keeps presenting a token for a user that no longer exists, /auth/me answers
 * 404, and the client treats that as a network blip — leaving it stuck half-signed-in with stale
 * local XP forever. Answering 401 instead makes the client drop the token and sign in fresh.
 *
 * Only positive results are cached, and a database failure fails OPEN so an outage can never sign
 * every player out.
 */
async function userStillExists(userId: string): Promise<boolean> {
  if (!UUID_PATTERN.test(userId)) return false;

  const now = Date.now();
  const trustedUntil = knownUsers.get(userId);
  if (trustedUntil !== undefined && trustedUntil > now) return true;

  try {
    const rows = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
    if (!rows[0]) {
      knownUsers.delete(userId);
      return false;
    }
    if (knownUsers.size >= USER_EXISTS_MAX_ENTRIES) {
      for (const [id, expiry] of knownUsers) if (expiry <= now) knownUsers.delete(id);
    }
    knownUsers.set(userId, now + USER_EXISTS_TTL_MS);
    return true;
  } catch (err) {
    console.warn(
      `Account existence check failed (${err instanceof Error ? err.message : String(err)}); allowing request`
    );
    return true;
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: { message: 'Unauthorized', code: 'NO_TOKEN' } });
    return;
  }

  let auth: AuthPayload;
  try {
    auth = verifyToken(header.slice(7));
  } catch {
    res.status(401).json({ success: false, error: { message: 'Invalid token', code: 'INVALID_TOKEN' } });
    return;
  }

  if (!(await userStillExists(auth.userId))) {
    res.status(401).json({
      success: false,
      error: { message: 'Account no longer exists. Please sign in again.', code: 'USER_NOT_FOUND' },
    });
    return;
  }

  req.auth = auth;
  next();
}

export function sendSuccess<T>(res: Response, data: T, status = 200): void {
  res.status(status).json({ success: true, data });
}

export function sendError(
  res: Response,
  message: string,
  status = 400,
  code?: string,
  details?: unknown
): void {
  res.status(status).json({
    success: false,
    error: { message, code, ...(details === undefined ? {} : { details }) },
  });
}
