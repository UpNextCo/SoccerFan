import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import type { User } from '../db/schema.js';

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

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: { message: 'Unauthorized', code: 'NO_TOKEN' } });
    return;
  }

  try {
    req.auth = verifyToken(header.slice(7));
    next();
  } catch {
    res.status(401).json({ success: false, error: { message: 'Invalid token', code: 'INVALID_TOKEN' } });
  }
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
