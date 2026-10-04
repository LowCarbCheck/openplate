/**
 * Unit tests for `#app/lib/shared-photo` — the pure query-string helpers behind
 * the Web Share Target flow (flag detection + URL cleaning). The cache reader
 * (`readSharedPhoto`) is browser-shaped and exercised in device testing, not
 * here.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  SHARED_AT_HEADER,
  SHARED_PHOTO_KEY,
  SHARED_PHOTO_MAX_AGE_MS,
  buildUrlWithoutSharedParam,
  hasSharedPhotoFlag,
  sweepStaleSharedPhoto,
  type SharedPhotoCacheStorage,
} from '../../app/lib/shared-photo';
import { ADD_PHOTO_PATH } from '../../app/lib/intake-hrefs';

describe('hasSharedPhotoFlag', () => {
  it('is true for ?shared=1', () => {
    assert.equal(hasSharedPhotoFlag('?shared=1'), true);
  });

  it('is true when other params are present alongside shared=1', () => {
    assert.equal(hasSharedPhotoFlag('?date=2026-07-14&shared=1'), true);
  });

  it('is false when shared has any other value', () => {
    assert.equal(hasSharedPhotoFlag('?shared=0'), false);
    assert.equal(hasSharedPhotoFlag('?shared=true'), false);
  });

  it('is false when the flag is absent', () => {
    assert.equal(hasSharedPhotoFlag(''), false);
    assert.equal(hasSharedPhotoFlag('?date=2026-07-14'), false);
  });
});

describe('buildUrlWithoutSharedParam', () => {
  it('drops the only param and returns a bare pathname', () => {
    assert.equal(buildUrlWithoutSharedParam(ADD_PHOTO_PATH, '?shared=1'), ADD_PHOTO_PATH);
  });

  it('preserves other params while removing shared', () => {
    assert.equal(
      buildUrlWithoutSharedParam(ADD_PHOTO_PATH, '?date=2026-07-14&shared=1'),
      `${ADD_PHOTO_PATH}?date=2026-07-14`,
    );
  });

  it('returns the bare pathname when there was no query string', () => {
    assert.equal(buildUrlWithoutSharedParam(ADD_PHOTO_PATH, ''), ADD_PHOTO_PATH);
  });

  it('leaves a query string with no shared flag untouched in content', () => {
    assert.equal(buildUrlWithoutSharedParam(ADD_PHOTO_PATH, '?date=2026-07-14'), `${ADD_PHOTO_PATH}?date=2026-07-14`);
  });
});

/** A fake cache and the answer to "is the photo still there". */
interface HeldCache {
  storage: SharedPhotoCacheStorage;
  hasPhoto: () => boolean;
}

/** A cache holding at most the one entry the worker writes, with the stamp the test names. */
function cacheHolding(stamp: string | null): HeldCache {
  let isStored = true;
  const headers = new Headers({ 'X-Shared-Filename': 'plate.jpg' });
  if (stamp !== null) headers.set(SHARED_AT_HEADER, stamp);
  const storage: SharedPhotoCacheStorage = {
    open: () =>
      Promise.resolve({
        match: (request) =>
          Promise.resolve(isStored && request === SHARED_PHOTO_KEY ? new Response('bytes', { headers }) : undefined),
        delete: (request) => {
          const hadIt = isStored && request === SHARED_PHOTO_KEY;
          isStored = false;
          return Promise.resolve(hadIt);
        },
      }),
  };
  return { storage, hasPhoto: () => isStored };
}

/**
 * THE SWEEP (M3/05, 2026-10-04). The stored shared photo is the ORIGINAL file,
 * EXIF included, and nothing removed it when the page never opened. The
 * control is the pair: a fresh entry STAYS, an aged one GOES. A sweep that
 * deleted everything fails the first, and one that deleted nothing fails the
 * second.
 */
describe('sweepStaleSharedPhoto', () => {
  const NOW = Date.UTC(2026, 9, 4, 12, 0, 0);

  it('keeps a photo shared a minute ago', async () => {
    const held = cacheHolding(String(NOW - 60_000));
    await sweepStaleSharedPhoto({ cacheStorage: held.storage, nowMs: NOW });
    assert.equal(held.hasPhoto(), true);
  });

  it('keeps a photo just inside the day', async () => {
    const held = cacheHolding(String(NOW - SHARED_PHOTO_MAX_AGE_MS + 1));
    await sweepStaleSharedPhoto({ cacheStorage: held.storage, nowMs: NOW });
    assert.equal(held.hasPhoto(), true);
  });

  it('removes a photo shared more than a day ago', async () => {
    const held = cacheHolding(String(NOW - SHARED_PHOTO_MAX_AGE_MS - 1));
    await sweepStaleSharedPhoto({ cacheStorage: held.storage, nowMs: NOW });
    assert.equal(held.hasPhoto(), false);
  });

  it('removes a photo stored by a worker that left no stamp', async () => {
    const held = cacheHolding(null);
    await sweepStaleSharedPhoto({ cacheStorage: held.storage, nowMs: NOW });
    assert.equal(held.hasPhoto(), false);
  });

  it('removes a photo whose stamp is not a number', async () => {
    const held = cacheHolding('yesterday');
    await sweepStaleSharedPhoto({ cacheStorage: held.storage, nowMs: NOW });
    assert.equal(held.hasPhoto(), false);
  });

  it('does nothing when no photo is stored', async () => {
    const held = cacheHolding(String(NOW));
    await held.storage.open('share-target').then((cache) => cache.delete(SHARED_PHOTO_KEY));
    await sweepStaleSharedPhoto({ cacheStorage: held.storage, nowMs: NOW });
    assert.equal(held.hasPhoto(), false);
  });
});
