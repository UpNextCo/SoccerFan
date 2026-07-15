import { publicApiBaseUrl } from '../utils/avatarUrl.js';

export const OPS_MEDIA_MAX_BYTES = 2_621_440;
export type OpsImageMimeType = 'image/jpeg' | 'image/png' | 'image/webp';

export function sniffImageMimeType(bytes: Uint8Array): OpsImageMimeType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

export function decodeOpsImageBase64(fileBase64: string): {
  bytes: Buffer;
  mimeType: OpsImageMimeType;
} {
  if (!fileBase64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(fileBase64) || fileBase64.length % 4 !== 0) {
    throw new Error('Image data must be valid base64.');
  }
  const bytes = Buffer.from(fileBase64, 'base64');
  if (bytes.length === 0) throw new Error('Image is empty.');
  if (bytes.length > OPS_MEDIA_MAX_BYTES) throw new Error('Image must be 2.5 MB or smaller.');
  const mimeType = sniffImageMimeType(bytes);
  if (!mimeType) throw new Error('Only JPEG, PNG, and WebP images are supported.');
  return { bytes, mimeType };
}

export function isConfiguredOpsMediaUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    const base = new URL(publicApiBaseUrl());
    return (
      url.origin === base.origin &&
      /^\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(url.pathname) &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

export function opsMediaIdFromUrl(value: string | undefined): string | null {
  if (!isConfiguredOpsMediaUrl(value)) return null;
  return new URL(value!).pathname.split('/').at(-1) ?? null;
}
