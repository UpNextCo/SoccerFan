import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { sendError } from './auth.js';

const COOKIE_NAME = 'bk_admin_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

declare global {
  namespace Express {
    interface Request {
      adminName?: string;
    }
  }
}

function sessionSecret(): string {
  return process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || 'dev-admin-secret';
}

function adminPassword(): string | undefined {
  return process.env.ADMIN_PASSWORD;
}

function signPayload(payload: string): string {
  return createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
}

export function createAdminSessionToken(adminName?: string): string {
  const exp = Date.now() + SESSION_TTL_MS;
  const name = (adminName || 'ops').slice(0, 64);
  const body = Buffer.from(JSON.stringify({ exp, name }), 'utf8').toString('base64url');
  const sig = signPayload(body);
  return `${body}.${sig}`;
}

export function verifyAdminSessionToken(token: string): { name: string } | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = signPayload(body);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
      exp?: number;
      name?: string;
    };
    if (!parsed.exp || parsed.exp < Date.now()) return null;
    return { name: parsed.name || 'ops' };
  } catch {
    return null;
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function checkAdminPassword(password: string): boolean {
  const expected = adminPassword();
  if (!expected) return false;
  const a = Buffer.from(password);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function setAdminSessionCookie(res: Response, token: string): void {
  const secure = process.env.NODE_ENV === 'production' || process.env.ADMIN_COOKIE_SECURE === '1';
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearAdminSessionCookie(res: Response): void {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!adminPassword()) {
    sendError(res, 'Admin not configured (ADMIN_PASSWORD)', 503, 'ADMIN_DISABLED');
    return;
  }

  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[COOKIE_NAME];
  if (!token) {
    sendError(res, 'Unauthorized', 401, 'NO_ADMIN_SESSION');
    return;
  }

  const session = verifyAdminSessionToken(token);
  if (!session) {
    clearAdminSessionCookie(res);
    sendError(res, 'Unauthorized', 401, 'INVALID_ADMIN_SESSION');
    return;
  }

  req.adminName = session.name;
  const headerName = req.headers['x-admin-name'];
  if (typeof headerName === 'string' && headerName.trim()) {
    req.adminName = headerName.trim().slice(0, 64);
  }
  next();
}
