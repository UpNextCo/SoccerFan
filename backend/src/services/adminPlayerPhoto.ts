import { and, asc, isNotNull, ne, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { players } from '../db/schema.js';
import { resolveHeadshot } from '../constants/footballMedia.js';
import { createOpsImage } from './opsMedia.js';
import { clearPhotoOverridesCache } from './photoOverrides.js';

export type AdminPlayerPhotoResult = {
  id: string;
  name: string;
  club: string;
  nationality: string;
  position: string;
  photoUrl: string | null;
  headshotUrl: string | null;
  hasCustomPhoto: boolean;
};

function toResult(row: {
  id: string;
  name: string;
  currentClub: string;
  nationality: string;
  position: string;
  photoUrl: string | null;
  apiFootballId: number | null;
}): AdminPlayerPhotoResult {
  const photoUrl = row.photoUrl?.trim() || null;
  return {
    id: row.id,
    name: row.name,
    club: row.currentClub,
    nationality: row.nationality,
    position: row.position,
    photoUrl,
    headshotUrl: resolveHeadshot(photoUrl, row.apiFootballId),
    hasCustomPhoto: Boolean(photoUrl),
  };
}

async function loadPlayer(playerId: string) {
  const [row] = await db
    .select({
      id: players.id,
      name: players.name,
      currentClub: players.currentClub,
      nationality: players.nationality,
      position: players.position,
      photoUrl: players.photoUrl,
      apiFootballId: players.apiFootballId,
    })
    .from(players)
    .where(eq(players.id, playerId))
    .limit(1);
  return row ?? null;
}

export async function getAdminPlayerPhoto(playerId: string): Promise<AdminPlayerPhotoResult | null> {
  const row = await loadPlayer(playerId);
  return row ? toResult(row) : null;
}

export async function setAdminPlayerPhoto(input: {
  playerId: string;
  fileBase64: string;
  mimeType: string;
  filename?: string;
  createdBy: string;
}): Promise<AdminPlayerPhotoResult> {
  const existing = await loadPlayer(input.playerId);
  if (!existing) throw new Error('Player not found.');

  const media = await createOpsImage({
    fileBase64: input.fileBase64,
    suppliedMimeType: input.mimeType,
    filename: input.filename,
    createdBy: input.createdBy,
    kind: 'player_headshot',
  });

  const [updated] = await db
    .update(players)
    .set({ photoUrl: media.url })
    .where(eq(players.id, input.playerId))
    .returning({
      id: players.id,
      name: players.name,
      currentClub: players.currentClub,
      nationality: players.nationality,
      position: players.position,
      photoUrl: players.photoUrl,
      apiFootballId: players.apiFootballId,
    });
  if (!updated) throw new Error('Failed to save player photo.');
  clearPhotoOverridesCache();
  return toResult(updated);
}

export async function clearAdminPlayerPhoto(playerId: string): Promise<AdminPlayerPhotoResult> {
  const existing = await loadPlayer(playerId);
  if (!existing) throw new Error('Player not found.');

  const [updated] = await db
    .update(players)
    .set({ photoUrl: null })
    .where(eq(players.id, playerId))
    .returning({
      id: players.id,
      name: players.name,
      currentClub: players.currentClub,
      nationality: players.nationality,
      position: players.position,
      photoUrl: players.photoUrl,
      apiFootballId: players.apiFootballId,
    });
  if (!updated) throw new Error('Failed to clear player photo.');
  clearPhotoOverridesCache();
  return toResult(updated);
}

export async function listAdminPlayerPhotoOverrides(limit = 40): Promise<AdminPlayerPhotoResult[]> {
  const listed = await db
    .select({
      id: players.id,
      name: players.name,
      currentClub: players.currentClub,
      nationality: players.nationality,
      position: players.position,
      photoUrl: players.photoUrl,
      apiFootballId: players.apiFootballId,
    })
    .from(players)
    .where(and(isNotNull(players.photoUrl), ne(players.photoUrl, '')))
    .orderBy(asc(players.name))
    .limit(Math.max(1, Math.min(limit, 100)));

  return listed.map(toResult);
}
