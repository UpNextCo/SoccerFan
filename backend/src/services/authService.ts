import appleSignin from 'apple-signin-auth';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users, userProgress } from '../db/schema.js';
import { signToken } from '../middleware/auth.js';
import type { UserProfile } from '../types.js';
import { resolveClientDailyDate } from '../utils/dailyDate.js';
import { avatarPublicUrl } from '../utils/avatarUrl.js';

function computeLevel(xp: number): number {
  return Math.max(1, Math.floor(Math.sqrt(xp / 100)));
}

const MAX_AVATAR_BYTES = 400_000; // ~400KB compressed JPEG

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
    avatarUrl: avatarPublicUrl(user.id, user.avatarJpeg != null),
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

/** Update display name and/or favorite team. Returns the refreshed profile. */
export async function updateUserProfile(
  userId: string,
  patch: { displayName?: string; favoriteTeamId?: number | null },
  clientDate?: string
): Promise<UserProfile | null> {
  const updates: Partial<typeof users.$inferInsert> = {};
  if (typeof patch.displayName === 'string') {
    const trimmed = patch.displayName.trim().slice(0, 40);
    if (trimmed.length > 0) updates.displayName = trimmed;
  }
  if (patch.favoriteTeamId !== undefined) {
    updates.favoriteTeamId = patch.favoriteTeamId;
  }
  if (Object.keys(updates).length > 0) {
    await db.update(users).set(updates).where(eq(users.id, userId));
  }
  return getUserProfile(userId, clientDate);
}

/** Store a compressed JPEG avatar (raw bytes). Pass null to clear. */
export async function setUserAvatar(userId: string, jpeg: Buffer | null): Promise<UserProfile | null> {
  if (jpeg && jpeg.length > MAX_AVATAR_BYTES) {
    throw new Error(`Avatar too large (max ${MAX_AVATAR_BYTES} bytes)`);
  }
  if (jpeg && jpeg.length >= 3) {
    // JPEG magic: FF D8 FF
    if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || jpeg[2] !== 0xff) {
      throw new Error('Avatar must be a JPEG image');
    }
  }
  await db.update(users).set({ avatarJpeg: jpeg }).where(eq(users.id, userId));
  return getUserProfile(userId);
}

/** Raw JPEG bytes for public avatar serving, or null if none. */
export async function getUserAvatarJpeg(userId: string): Promise<Buffer | null> {
  const rows = await db
    .select({ avatarJpeg: users.avatarJpeg })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const bytes = rows[0]?.avatarJpeg;
  return bytes ?? null;
}

export async function deleteUserAccount(userId: string): Promise<void> {
  await db.delete(users).where(eq(users.id, userId));
}

export { computeLevel };
