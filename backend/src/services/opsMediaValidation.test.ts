import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeOpsImageBase64,
  opsMediaIdFromUrl,
  OPS_MEDIA_MAX_BYTES,
  sniffImageMimeType,
} from './opsMediaValidation.js';
import { publicApiBaseUrl } from '../utils/avatarUrl.js';

test('sniffs supported image magic bytes rather than extensions', () => {
  assert.equal(sniffImageMimeType(Buffer.from([0xff, 0xd8, 0xff, 0x00])), 'image/jpeg');
  assert.equal(
    sniffImageMimeType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    'image/png'
  );
  assert.equal(sniffImageMimeType(Buffer.from('RIFF1234WEBP')), 'image/webp');
  assert.equal(sniffImageMimeType(Buffer.from('<svg>')), null);
});

test('decodes valid images and enforces the raw 2.5 MB limit', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
  assert.equal(decodeOpsImageBase64(jpeg.toString('base64')).mimeType, 'image/jpeg');
  const oversized = Buffer.alloc(OPS_MEDIA_MAX_BYTES + 1);
  oversized.set([0xff, 0xd8, 0xff]);
  assert.throws(() => decodeOpsImageBase64(oversized.toString('base64')), /2.5 MB/);
  assert.throws(() => decodeOpsImageBase64('not base64'), /valid base64/);
});

test('extracts only configured public media ids', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  assert.equal(opsMediaIdFromUrl(`${publicApiBaseUrl()}/media/${id}`), id);
  assert.equal(opsMediaIdFromUrl(`https://example.com/media/${id}`), null);
});
