import appleSignin from 'apple-signin-auth';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users, userProgress } from '../db/schema.js';
import { signToken } from '../middleware/auth.js';
import type { UserProfile } from '../types.js';

function computeLevel(xp: number): number {
  return Math.max(1, Math.floor(Math.sqrt(xp / 100)));
}

import { resolveClientDailyDate } from '../utils/dailyDate.js';

function toUserProfile(
  user: typeof users.$inferSelect,
  progress: typeof userProgress.$inferSelect,
  clientDate?: string
): UserProfile {
  const dailyDate = resolveClientDailyDate(clientDate);
  const todayXp = progress.todayXpDate === dailyDate ? progress.todayXp : 0;
  return {
    id: user.id,
    displayName: user.displayName,
    xp: progress.xp,
    level: progress.level,
    streak: progress.streak,
    todayXp,
    favoriteTeamId: user.favoriteTeamId ?? null,
  };
}

export async function authenticateWithApple(
  identityToken: string,
  displayName?: string
): Promise<{ token: string; user: UserProfile }> {
  const clientId = process.env.APPLE_CLIENT_ID;
  if (!clientId) {
    throw new Error('APPLE_CLIENT_ID is not configured');
  }

  let appleSub: string;
  try {
    const payload = await appleSignin.verifyIdToken(identityToken, {
      audience: clientId,
      ignoreExpiration: false,
    });
    appleSub = payload.sub;
  } catch {
    // Dev fallback when Apple credentials aren't configured
    const allowDevAuth =
      process.env.ALLOW_DEV_AUTH === 'true' || process.env.NODE_ENV === 'development';
    if (allowDevAuth && identityToken.startsWith('dev:')) {
      appleSub = identityToken.slice(4);
    } else {
      throw new Error('Invalid Apple identity token');
    }
  }

  const existing = await db.select().from(users).where(eq(users.appleSub, appleSub)).limit(1);
  let user = existing[0];

  if (!user) {
    const inserted = await db
      .insert(users)
      .values({
        appleSub,
        displayName: displayName?.trim() || 'Player',
      })
      .returning();
    user = inserted[0]!;

    await db.insert(userProgress).values({
      userId: user.id,
      xp: 0,
      level: 1,
      streak: 0,
      todayXp: 0,
    });
  } else if (displayName?.trim()) {
    const updated = await db
      .update(users)
      .set({ displayName: displayName.trim() })
      .where(eq(users.id, user.id))
      .returning();
    user = updated[0]!;
  }

  const progressRows = await db
    .select()
    .from(userProgress)
    .where(eq(userProgress.userId, user.id))
    .limit(1);
  const progress = progressRows[0]!;

  const token = signToken({ userId: user.id, appleSub: user.appleSub });
  return { token, user: toUserProfile(user, progress) };
}

export async function getUserProfile(userId: string, clientDate?: string): Promise<UserProfile | null> {
  const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = userRows[0];
  if (!user) return null;

  const progressRows = await db
    .select()
    .from(userProgress)
    .where(eq(userProgress.userId, userId))
    .limit(1);
  const progress = progressRows[0];
  if (!progress) return null;

  return toUserProfile(user, progress, clientDate);
}

export async function deleteUserAccount(userId: string): Promise<void> {
  await db.delete(users).where(eq(users.id, userId));
}

export { computeLevel };
