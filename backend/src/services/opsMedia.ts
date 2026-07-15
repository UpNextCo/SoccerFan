import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { opsMedia } from '../db/schema.js';
import { publicApiBaseUrl } from '../utils/avatarUrl.js';
import { decodeOpsImageBase64, type OpsImageMimeType } from './opsMediaValidation.js';

export function opsMediaPublicUrl(id: string): string {
  return `${publicApiBaseUrl()}/media/${id}`;
}

export async function createOpsImage(input: {
  fileBase64: string;
  suppliedMimeType: string;
  filename?: string;
  createdBy: string;
}): Promise<{ id: string; url: string; mimeType: OpsImageMimeType; size: number; filename?: string }> {
  const decoded = decodeOpsImageBase64(input.fileBase64);
  if (input.suppliedMimeType !== decoded.mimeType) {
    throw new Error(`Image content does not match supplied MIME type (${decoded.mimeType}).`);
  }
  const filename = input.filename?.trim() || undefined;
  if (filename && filename.length > 255) throw new Error('Filename is too long.');
  const [row] = await db
    .insert(opsMedia)
    .values({
      kind: 'lms_custom_image',
      mimeType: decoded.mimeType,
      bytes: decoded.bytes,
      size: decoded.bytes.length,
      originalFilename: filename,
      createdBy: input.createdBy,
    })
    .returning({ id: opsMedia.id });
  if (!row) throw new Error('Image upload failed.');
  return {
    id: row.id,
    url: opsMediaPublicUrl(row.id),
    mimeType: decoded.mimeType,
    size: decoded.bytes.length,
    filename,
  };
}

export async function getOpsImage(id: string): Promise<{
  bytes: Buffer;
  mimeType: string;
} | null> {
  const [row] = await db
    .select({ bytes: opsMedia.bytes, mimeType: opsMedia.mimeType })
    .from(opsMedia)
    .where(eq(opsMedia.id, id))
    .limit(1);
  return row ?? null;
}

export async function opsImageExists(id: string): Promise<boolean> {
  const [row] = await db
    .select({ id: opsMedia.id })
    .from(opsMedia)
    .where(eq(opsMedia.id, id))
    .limit(1);
  return Boolean(row);
}
