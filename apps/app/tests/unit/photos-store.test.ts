/**
 * Unit tests for the on-device photo store's low-level helpers
 * (`app/lib/local-store/photos`), driven against a REAL in-memory TinyBase store
 * (no IndexedDB persister, no `FileReader`). Covers user-scoped keying, cross-
 * user isolation, delete, retention eviction (including legacy unscoped rows),
 * the per-user count cap, size accounting, and the (device-global) enabled
 * preference.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createPhotosStore, PHOTOS_TABLE } from '../../app/lib/local-store/store';
import {
  clearPhotoRows,
  deletePhotoRow,
  enforcePhotoCap,
  evictExpiredPhotos,
  readPhotoDataUrl,
  readPhotoEnabled,
  readPhotoUsage,
  writePhotoEnabled,
  writePhotoRow,
} from '../../app/lib/local-store/photos';
import { MAX_CACHED_PHOTOS, PHOTO_RETENTION_DAYS } from '../../app/lib/local-store/photo-policy';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-07-14T12:00:00Z');

const USER_A = 1;
const USER_B = 2;

describe('photo store keying (user-scoped)', () => {
  it('reads back a photo by its owner + logBatchId and misses cleanly for an unknown batch', () => {
    const store = createPhotosStore();
    writePhotoRow(store, {
      userId: USER_A,
      logBatchId: 'batch-a',
      dataUrl: 'data:image/jpeg;base64,AAAA',
      byteSize: 3,
      createdAt: NOW,
    });

    assert.equal(readPhotoDataUrl(store, { userId: USER_A, logBatchId: 'batch-a' }), 'data:image/jpeg;base64,AAAA');
    assert.equal(readPhotoDataUrl(store, { userId: USER_A, logBatchId: 'batch-b' }), null);
  });

  it('never leaks a photo across users, even for the same logBatchId', () => {
    const store = createPhotosStore();
    writePhotoRow(store, {
      userId: USER_A,
      logBatchId: 'shared-batch',
      dataUrl: 'a-photo',
      byteSize: 1,
      createdAt: NOW,
    });

    // Same batch id, different owner -- a real collision would only happen if a
    // client id somehow repeated across accounts, but the store must still keep
    // them apart.
    assert.equal(readPhotoDataUrl(store, { userId: USER_B, logBatchId: 'shared-batch' }), null);
    assert.equal(readPhotoDataUrl(store, { userId: USER_A, logBatchId: 'shared-batch' }), 'a-photo');
  });

  it('deletes only the addressed user + batch', () => {
    const store = createPhotosStore();
    writePhotoRow(store, { userId: USER_A, logBatchId: 'a', dataUrl: 'x', byteSize: 3, createdAt: NOW });
    writePhotoRow(store, { userId: USER_A, logBatchId: 'b', dataUrl: 'y', byteSize: 3, createdAt: NOW });

    deletePhotoRow(store, { userId: USER_A, logBatchId: 'a' });

    assert.equal(readPhotoDataUrl(store, { userId: USER_A, logBatchId: 'a' }), null);
    assert.equal(readPhotoDataUrl(store, { userId: USER_A, logBatchId: 'b' }), 'y');
  });

  it('clears only photos owned by the addressed user, leaving other accounts untouched', () => {
    const store = createPhotosStore();
    writePhotoRow(store, { userId: USER_A, logBatchId: 'a', dataUrl: 'x', byteSize: 1, createdAt: NOW });
    writePhotoRow(store, { userId: USER_A, logBatchId: 'b', dataUrl: 'y', byteSize: 1, createdAt: NOW });
    writePhotoRow(store, { userId: USER_B, logBatchId: 'c', dataUrl: 'z', byteSize: 1, createdAt: NOW });

    clearPhotoRows(store, USER_A);

    assert.deepEqual(readPhotoUsage(store, USER_A), { count: 0, totalBytes: 0 });
    assert.deepEqual(readPhotoUsage(store, USER_B), { count: 1, totalBytes: 1 });
  });
});

describe('readPhotoUsage', () => {
  it('counts and sums byte sizes for one user only', () => {
    const store = createPhotosStore();
    writePhotoRow(store, { userId: USER_A, logBatchId: 'a', dataUrl: 'x', byteSize: 1000, createdAt: NOW });
    writePhotoRow(store, { userId: USER_A, logBatchId: 'b', dataUrl: 'y', byteSize: 2500, createdAt: NOW });
    writePhotoRow(store, { userId: USER_B, logBatchId: 'c', dataUrl: 'z', byteSize: 9999, createdAt: NOW });

    assert.deepEqual(readPhotoUsage(store, USER_A), { count: 2, totalBytes: 3500 });
    assert.deepEqual(readPhotoUsage(store, USER_B), { count: 1, totalBytes: 9999 });
  });
});

describe('evictExpiredPhotos', () => {
  it('drops photos owned by the current user past the retention window and keeps recent ones', () => {
    const store = createPhotosStore();
    writePhotoRow(store, {
      userId: USER_A,
      logBatchId: 'fresh',
      dataUrl: 'x',
      byteSize: 1,
      createdAt: NOW - 1 * MS_PER_DAY,
    });
    writePhotoRow(store, {
      userId: USER_A,
      logBatchId: 'stale',
      dataUrl: 'y',
      byteSize: 1,
      createdAt: NOW - (PHOTO_RETENTION_DAYS + 5) * MS_PER_DAY,
    });

    const evicted = evictExpiredPhotos(store, USER_A, NOW);

    assert.equal(evicted, 1);
    assert.equal(readPhotoDataUrl(store, { userId: USER_A, logBatchId: 'fresh' }), 'x');
    assert.equal(readPhotoDataUrl(store, { userId: USER_A, logBatchId: 'stale' }), null);
  });

  it('never touches rows owned by a different, known user, even expired ones', () => {
    const store = createPhotosStore();
    writePhotoRow(store, {
      userId: USER_B,
      logBatchId: 'ancient',
      dataUrl: 'z',
      byteSize: 1,
      createdAt: NOW - 400 * MS_PER_DAY,
    });

    evictExpiredPhotos(store, USER_A, NOW);

    assert.equal(readPhotoDataUrl(store, { userId: USER_B, logBatchId: 'ancient' }), 'z');
  });

  it('unconditionally drops legacy rows written before user-scoping existed, regardless of age', () => {
    const store = createPhotosStore();
    // A legacy row: bare logBatchId key, no `userId::` prefix -- written by a
    // pre-scoping build of the app. It can't be attributed to any account.
    store.setRow(PHOTOS_TABLE, 'legacy-bare-batch-id', {
      dataUrl: 'legacy',
      byteSize: 1,
      createdAt: NOW, // fresh by age, but still unattributable
    });

    const evicted = evictExpiredPhotos(store, USER_A, NOW);

    assert.equal(evicted, 1);
    assert.equal(store.hasRow(PHOTOS_TABLE, 'legacy-bare-batch-id'), false);
  });
});

describe('enforcePhotoCap', () => {
  it('drops the oldest photos over MAX_CACHED_PHOTOS for that user only', () => {
    const store = createPhotosStore();
    for (let index = 0; index < MAX_CACHED_PHOTOS + 2; index += 1) {
      writePhotoRow(store, {
        userId: USER_A,
        logBatchId: `batch-${index}`,
        dataUrl: 'x',
        byteSize: 1,
        createdAt: index, // ascending -- batch-0 is oldest
      });
    }
    writePhotoRow(store, { userId: USER_B, logBatchId: 'other', dataUrl: 'y', byteSize: 1, createdAt: 0 });

    enforcePhotoCap(store, USER_A);

    assert.equal(readPhotoUsage(store, USER_A).count, MAX_CACHED_PHOTOS);
    assert.equal(readPhotoDataUrl(store, { userId: USER_A, logBatchId: 'batch-0' }), null); // oldest, evicted
    assert.equal(readPhotoDataUrl(store, { userId: USER_A, logBatchId: 'batch-1' }), null); // 2nd oldest, evicted
    assert.equal(readPhotoDataUrl(store, { userId: USER_A, logBatchId: `batch-${MAX_CACHED_PHOTOS + 1}` }), 'x'); // newest, kept
    // A different user's photo, even though it's oldest by timestamp, is untouched.
    assert.equal(readPhotoDataUrl(store, { userId: USER_B, logBatchId: 'other' }), 'y');
  });

  it('is a no-op when at or under the cap', () => {
    const store = createPhotosStore();
    writePhotoRow(store, { userId: USER_A, logBatchId: 'a', dataUrl: 'x', byteSize: 1, createdAt: 1 });

    enforcePhotoCap(store, USER_A);

    assert.equal(readPhotoUsage(store, USER_A).count, 1);
  });
});

describe('photo enabled preference (device-global, not user-scoped)', () => {
  it('defaults to ON when never set, and round-trips a written value', () => {
    const store = createPhotosStore();
    assert.equal(readPhotoEnabled(store), true);

    writePhotoEnabled(store, false);
    assert.equal(readPhotoEnabled(store), false);

    writePhotoEnabled(store, true);
    assert.equal(readPhotoEnabled(store), true);
  });
});
