/**
 * Unit tests for the pure parts of `#app/lib/photo-constraints` — upload
 * validation, downscale-dimension maths, and JPEG filename rewriting. The
 * browser-only `downscaleToJpeg` transcoder is not exercised here (it needs a
 * DOM canvas). No React/DB/network.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ALLOWED_MIME_TYPES,
  MAX_PHOTO_BYTES,
  computeScaledDimensions,
  toJpegFilename,
  validatePhoto,
} from '../../app/lib/photo-constraints';

/** Identity translator — each assertion pins the KEY, not the catalog's current wording. */
const t = (key: string): string => key;

describe('constraints', () => {
  it('caps uploads at 8 MB', () => {
    assert.strictEqual(MAX_PHOTO_BYTES, 8 * 1024 * 1024);
  });

  it('allows the four expected image types', () => {
    assert.deepStrictEqual([...ALLOWED_MIME_TYPES], ['image/jpeg', 'image/png', 'image/webp', 'image/heic']);
  });
});

describe('validatePhoto', () => {
  it('accepts a JPEG within the size limit', () => {
    assert.deepStrictEqual(validatePhoto({ type: 'image/jpeg', size: 1_000_000 }, t), { valid: true });
  });

  it('rejects an empty file', () => {
    assert.deepStrictEqual(validatePhoto({ type: 'image/jpeg', size: 0 }, t), {
      valid: false,
      error: 'scan.errors.photo.empty',
    });
  });

  it('rejects a file over the size limit', () => {
    assert.deepStrictEqual(validatePhoto({ type: 'image/png', size: MAX_PHOTO_BYTES + 1 }, t), {
      valid: false,
      error: 'scan.errors.photo.tooLarge',
    });
  });

  it('rejects a disallowed MIME type', () => {
    assert.deepStrictEqual(validatePhoto({ type: 'image/gif', size: 1000 }, t), {
      valid: false,
      error: 'scan.errors.photo.unsupportedType',
    });
  });
});

describe('computeScaledDimensions', () => {
  it('downscales a landscape image to fit the longest edge', () => {
    assert.deepStrictEqual(computeScaledDimensions({ width: 3200, height: 2400, maxDimension: 1600 }), {
      width: 1600,
      height: 1200,
    });
  });

  it('downscales a portrait image on its longest edge', () => {
    assert.deepStrictEqual(computeScaledDimensions({ width: 1000, height: 2000, maxDimension: 1600 }), {
      width: 800,
      height: 1600,
    });
  });

  it('never upscales an image already within bounds', () => {
    assert.deepStrictEqual(computeScaledDimensions({ width: 800, height: 600, maxDimension: 1600 }), {
      width: 800,
      height: 600,
    });
  });

  it('leaves an image exactly at the limit unchanged', () => {
    assert.deepStrictEqual(computeScaledDimensions({ width: 1600, height: 1600, maxDimension: 1600 }), {
      width: 1600,
      height: 1600,
    });
  });
});

describe('toJpegFilename', () => {
  it('replaces a single extension with .jpg', () => {
    assert.strictEqual(toJpegFilename('photo.heic'), 'photo.jpg');
    assert.strictEqual(toJpegFilename('IMG_1234.PNG'), 'IMG_1234.jpg');
  });

  it('only replaces the final extension', () => {
    assert.strictEqual(toJpegFilename('plate.dinner.webp'), 'plate.dinner.jpg');
  });

  it('appends .jpg when there is no extension', () => {
    assert.strictEqual(toJpegFilename('no-extension'), 'no-extension.jpg');
  });

  it('falls back to "photo.jpg" for an empty name', () => {
    assert.strictEqual(toJpegFilename(''), 'photo.jpg');
  });
});
