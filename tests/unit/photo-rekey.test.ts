/**
 * Unit tests for the photo-cache re-key onto the anonymous owner
 * (`app/lib/local-store/photo-rekey`, M128 spec 03).
 *
 * The photo cache is the ONE local surface that was account-keyed
 * (`${userId}::${logBatchId}`), so the accountless cutover has to move those
 * rows onto the `ANONYMOUS_USER_ID` sentinel — otherwise a device that used to
 * be signed in keeps its own photos in a store that no read, usage, clear or GC
 * path can see any more.
 *
 * The pure planner is asserted directly (classification, collision, legacy
 * rows, idempotency); the store-applying shell is driven against a REAL
 * in-memory TinyBase store — no IndexedDB, no `FileReader` — the same harness
 * `photos-store.test.ts` uses.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ANONYMOUS_USER_ID, createPhotosStore, PHOTOS_TABLE } from '../../app/lib/local-store/store';
import { planPhotoKeyRekey, runPhotoCacheRekey } from '../../app/lib/local-store/photo-rekey';
import { readPhotoDataUrl, readPhotoUsage, writePhotoRow } from '../../app/lib/local-store/photos';

const NOW = Date.parse('2026-08-03T12:00:00Z');

const USER_A = 1;
const USER_B = 7;

describe('planPhotoKeyRekey', () => {
  it('moves an account-keyed row onto the anonymous owner, keeping its logBatchId', () => {
    assert.deepEqual(planPhotoKeyRekey(['1::batch-a']), {
      renames: [{ from: '1::batch-a', to: '0::batch-a' }],
      drops: [],
    });
  });

  it('leaves a row that is ALREADY anonymous-owned alone — this is what makes a second pass a no-op', () => {
    assert.deepEqual(planPhotoKeyRekey(['0::batch-a', '0::batch-b']), { renames: [], drops: [] });
  });

  it('is idempotent: re-planning over the post-rename key set produces an empty plan', () => {
    const first = planPhotoKeyRekey(['1::batch-a', '7::batch-b']);
    const afterFirstPass = first.renames.map((rename) => rename.to);

    assert.deepEqual(afterFirstPass, ['0::batch-a', '0::batch-b']);
    assert.deepEqual(planPhotoKeyRekey(afterFirstPass), { renames: [], drops: [] });
  });

  it('drops (never overwrites) an account-keyed row whose anonymous target already exists', () => {
    assert.deepEqual(planPhotoKeyRekey(['0::batch-a', '1::batch-a']), {
      renames: [],
      drops: ['1::batch-a'],
    });
  });

  it('keeps only the first of two account-keyed rows that collide on the same batch id', () => {
    // logBatchIds are crypto.randomUUID()s so this cannot really happen — the
    // point is that the plan stays deterministic rather than order-dependent
    // garbage if it ever did.
    assert.deepEqual(planPhotoKeyRekey(['1::batch-a', '7::batch-a']), {
      renames: [{ from: '1::batch-a', to: '0::batch-a' }],
      drops: ['7::batch-a'],
    });
  });

  it('leaves a LEGACY unscoped key untouched — it is unattributable, not this migration to claim', () => {
    // A bare logBatchId predates user scoping entirely. `evictExpiredPhotos`
    // already drops these unconditionally; adopting them here would hand one
    // account's photos to whoever holds the device now.
    assert.deepEqual(planPhotoKeyRekey(['legacy-batch', '1::batch-a']), {
      renames: [{ from: '1::batch-a', to: '0::batch-a' }],
      drops: [],
    });
  });

  it('returns an empty plan for an empty table', () => {
    assert.deepEqual(planPhotoKeyRekey([]), { renames: [], drops: [] });
  });
});

describe('runPhotoCacheRekey (against a real store)', () => {
  it("makes a previously signed-in account's photos readable as the anonymous owner", () => {
    const store = createPhotosStore();
    writePhotoRow(store, {
      userId: USER_A,
      logBatchId: 'batch-a',
      dataUrl: 'data:image/jpeg;base64,AAAA',
      byteSize: 3,
      createdAt: NOW,
    });

    // Before: invisible to the only owner id the app has left.
    assert.equal(readPhotoDataUrl(store, { userId: ANONYMOUS_USER_ID, logBatchId: 'batch-a' }), null);

    const result = runPhotoCacheRekey(store);

    assert.deepEqual(result, { renamed: 1, dropped: 0 });
    assert.equal(
      readPhotoDataUrl(store, { userId: ANONYMOUS_USER_ID, logBatchId: 'batch-a' }),
      'data:image/jpeg;base64,AAAA',
    );
    assert.equal(readPhotoDataUrl(store, { userId: USER_A, logBatchId: 'batch-a' }), null);
  });

  it('carries the byte-size and cached-at cells across, so usage accounting and retention GC still work', () => {
    const store = createPhotosStore();
    writePhotoRow(store, {
      userId: USER_A,
      logBatchId: 'batch-a',
      dataUrl: 'data:image/jpeg;base64,AAAA',
      byteSize: 1234,
      createdAt: NOW,
    });

    runPhotoCacheRekey(store);

    assert.deepEqual(readPhotoUsage(store, ANONYMOUS_USER_ID), { count: 1, totalBytes: 1234 });
    assert.equal(store.getCell(PHOTOS_TABLE, '0::batch-a', 'createdAt'), NOW);
  });

  it('merges several accounts on a shared device into the single owner', () => {
    const store = createPhotosStore();
    for (const [userId, logBatchId] of [
      [USER_A, 'batch-a'],
      [USER_B, 'batch-b'],
    ] as const) {
      writePhotoRow(store, {
        userId,
        logBatchId,
        dataUrl: 'data:image/jpeg;base64,AAAA',
        byteSize: 10,
        createdAt: NOW,
      });
    }

    assert.deepEqual(runPhotoCacheRekey(store), { renamed: 2, dropped: 0 });
    assert.deepEqual(readPhotoUsage(store, ANONYMOUS_USER_ID), { count: 2, totalBytes: 20 });
    assert.deepEqual(store.getRowIds(PHOTOS_TABLE).toSorted(), ['0::batch-a', '0::batch-b']);
  });

  it('is a no-op on a second run', () => {
    const store = createPhotosStore();
    writePhotoRow(store, {
      userId: USER_A,
      logBatchId: 'batch-a',
      dataUrl: 'data:image/jpeg;base64,AAAA',
      byteSize: 3,
      createdAt: NOW,
    });

    runPhotoCacheRekey(store);
    assert.deepEqual(runPhotoCacheRekey(store), { renamed: 0, dropped: 0 });
    assert.deepEqual(store.getRowIds(PHOTOS_TABLE), ['0::batch-a']);
  });

  it('never resurrects a dropped collision row under the anonymous key', () => {
    const store = createPhotosStore();
    writePhotoRow(store, {
      userId: ANONYMOUS_USER_ID,
      logBatchId: 'batch-a',
      dataUrl: 'data:image/jpeg;base64,KEEP',
      byteSize: 4,
      createdAt: NOW,
    });
    writePhotoRow(store, {
      userId: USER_A,
      logBatchId: 'batch-a',
      dataUrl: 'data:image/jpeg;base64,LOSE',
      byteSize: 4,
      createdAt: NOW,
    });

    assert.deepEqual(runPhotoCacheRekey(store), { renamed: 0, dropped: 1 });
    assert.equal(
      readPhotoDataUrl(store, { userId: ANONYMOUS_USER_ID, logBatchId: 'batch-a' }),
      'data:image/jpeg;base64,KEEP',
    );
    assert.deepEqual(store.getRowIds(PHOTOS_TABLE), ['0::batch-a']);
  });
});
