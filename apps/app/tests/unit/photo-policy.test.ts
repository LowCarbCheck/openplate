/**
 * Unit tests for the pure photo-cache policy (`app/lib/local-store/photo-policy`):
 * user-scoped row keying, retention-window selection, the per-user count cap,
 * base64 data-URL size estimation, human-readable size formatting, and usage
 * aggregation. No browser APIs, no TinyBase.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_CACHED_PHOTOS,
  PHOTO_RETENTION_DAYS,
  buildPhotoKey,
  estimateDataUrlBytes,
  formatPhotoSize,
  keyBelongsToUser,
  parsePhotoKey,
  selectExpiredPhotoKeys,
  selectOverflowPhotoKeys,
  summarizePhotoUsage,
} from '../../app/lib/local-store/photo-policy';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-07-14T12:00:00Z');

describe('buildPhotoKey / parsePhotoKey', () => {
  it('round-trips a userId + logBatchId through the scoped key scheme', () => {
    const key = buildPhotoKey({ userId: 42, logBatchId: 'abc-123' });
    assert.equal(key, '42::abc-123');
    assert.deepEqual(parsePhotoKey(key), { userId: 42, logBatchId: 'abc-123' });
  });

  it('returns null for a legacy (pre-scoping) bare-batch-id key', () => {
    assert.equal(parsePhotoKey('abc-123'), null);
  });

  it('returns null for a key with a non-numeric or empty user segment', () => {
    assert.equal(parsePhotoKey('notanumber::abc-123'), null);
    assert.equal(parsePhotoKey('::abc-123'), null);
  });

  it('returns null when the batch-id segment is empty', () => {
    assert.equal(parsePhotoKey('42::'), null);
  });
});

describe('keyBelongsToUser', () => {
  it('matches only the scoped key for the given user', () => {
    const key = buildPhotoKey({ userId: 7, logBatchId: 'batch-1' });
    assert.equal(keyBelongsToUser(key, 7), true);
    assert.equal(keyBelongsToUser(key, 8), false);
  });

  it('never matches a legacy unscoped key, regardless of user id', () => {
    assert.equal(keyBelongsToUser('legacy-batch-id', 7), false);
  });
});

describe('selectExpiredPhotoKeys', () => {
  it('evicts only photos strictly older than the retention window', () => {
    const entries = [
      { key: 'fresh', createdAt: NOW - 1 * MS_PER_DAY },
      { key: 'edge-inside', createdAt: NOW - PHOTO_RETENTION_DAYS * MS_PER_DAY },
      { key: 'just-past', createdAt: NOW - (PHOTO_RETENTION_DAYS + 1) * MS_PER_DAY },
      { key: 'ancient', createdAt: NOW - 400 * MS_PER_DAY },
    ];

    assert.deepEqual(selectExpiredPhotoKeys(entries, NOW), ['just-past', 'ancient']);
  });

  it('never evicts a future-dated photo (clock skew yields a negative age)', () => {
    const entries = [{ key: 'future', createdAt: NOW + 5 * MS_PER_DAY }];
    assert.deepEqual(selectExpiredPhotoKeys(entries, NOW), []);
  });

  it('returns an empty list for an empty cache', () => {
    assert.deepEqual(selectExpiredPhotoKeys([], NOW), []);
  });

  it('honors a custom retention window', () => {
    const entries = [{ key: 'a', createdAt: NOW - 10 * MS_PER_DAY }];
    assert.deepEqual(selectExpiredPhotoKeys(entries, NOW, 7), ['a']);
    assert.deepEqual(selectExpiredPhotoKeys(entries, NOW, 30), []);
  });
});

describe('selectOverflowPhotoKeys', () => {
  it('returns nothing when at or under the cap', () => {
    const entries = [
      { key: 'a', createdAt: 1 },
      { key: 'b', createdAt: 2 },
    ];
    assert.deepEqual(selectOverflowPhotoKeys(entries, 2), []);
    assert.deepEqual(selectOverflowPhotoKeys(entries, 5), []);
  });

  it('drops the oldest entries first when over the cap', () => {
    const entries = [
      { key: 'newest', createdAt: 300 },
      { key: 'oldest', createdAt: 100 },
      { key: 'middle', createdAt: 200 },
    ];
    assert.deepEqual(selectOverflowPhotoKeys(entries, 2), ['oldest']);
    assert.deepEqual(selectOverflowPhotoKeys(entries, 1), ['oldest', 'middle']);
  });

  it('defaults to MAX_CACHED_PHOTOS and does not mutate its input', () => {
    const entries = Array.from({ length: MAX_CACHED_PHOTOS + 3 }, (_, index) => ({
      key: `photo-${index}`,
      createdAt: index,
    }));
    const original = [...entries];

    const overflow = selectOverflowPhotoKeys(entries);

    assert.equal(overflow.length, 3);
    assert.deepEqual(overflow, ['photo-0', 'photo-1', 'photo-2']);
    assert.deepEqual(entries, original);
  });
});

describe('estimateDataUrlBytes', () => {
  it('decodes the byte size of a base64 data-URL, accounting for padding', () => {
    // "AAAA" (4 chars, no padding) encodes 3 bytes.
    assert.equal(estimateDataUrlBytes('data:image/jpeg;base64,AAAA'), 3);
    // "AAA=" one pad -> 2 bytes; "AA==" two pads -> 1 byte.
    assert.equal(estimateDataUrlBytes('data:image/jpeg;base64,AAA='), 2);
    assert.equal(estimateDataUrlBytes('data:image/jpeg;base64,AA=='), 1);
  });

  it('handles a bare base64 payload (no data-URL prefix)', () => {
    assert.equal(estimateDataUrlBytes('AAAAAAAA'), 6);
  });

  it('returns 0 for an empty payload', () => {
    assert.equal(estimateDataUrlBytes('data:image/jpeg;base64,'), 0);
    assert.equal(estimateDataUrlBytes(''), 0);
  });
});

describe('formatPhotoSize', () => {
  it('formats KB below a megabyte and MB above, never showing 0 KB for a non-empty cache', () => {
    assert.equal(formatPhotoSize(0), '0 KB');
    assert.equal(formatPhotoSize(200), '1 KB'); // rounds up so a small cache isn't shown as empty
    assert.equal(formatPhotoSize(150 * 1024), '150 KB');
    assert.equal(formatPhotoSize(2.5 * 1024 * 1024), '2.5 MB');
  });
});

describe('summarizePhotoUsage', () => {
  it('counts photos and sums their byte sizes', () => {
    assert.deepEqual(summarizePhotoUsage([{ byteSize: 100 }, { byteSize: 250 }, { byteSize: 50 }]), {
      count: 3,
      totalBytes: 400,
    });
  });

  it('ignores non-finite byte sizes and reports an empty cache as zeroed', () => {
    assert.deepEqual(summarizePhotoUsage([]), { count: 0, totalBytes: 0 });
    assert.deepEqual(summarizePhotoUsage([{ byteSize: Number.NaN }, { byteSize: 120 }]), {
      count: 2,
      totalBytes: 120,
    });
  });
});
