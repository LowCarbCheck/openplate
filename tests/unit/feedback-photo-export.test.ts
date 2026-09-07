/**
 * The ONE route out of the photo cache
 * (`app/lib/feedback/feedback-photo-export`), and the isolation it must not
 * weaken.
 *
 * Two halves. The first drives `exportPhotoForFeedback` against an injected
 * cache read and an injected downscaler, so the seam's behaviour is asserted
 * without IndexedDB and without a canvas. The second is STRUCTURAL: it reads
 * the app's own source and pins that nothing else reaches the photo store for
 * this purpose, because the property under test is "there is exactly one seam"
 * and no amount of behavioural testing can observe a second one being added.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { exportPhotoForFeedback, parsePhotoDataUrl } from '../../app/lib/feedback/feedback-photo-export';
import { MAX_FEEDBACK_IMAGE_BYTES } from '../../app/lib/feedback/feedback-report';

const APP_DIR = fileURLToPath(new URL('../../app/', import.meta.url));

/** A base64 data URL of `size` bytes of a given type. */
function dataUrl(contentType: string, size: number): string {
  return `data:${contentType};base64,${Buffer.alloc(size, 7).toString('base64')}`;
}

describe('parsePhotoDataUrl', () => {
  it('splits a base64 data URL into its type and payload', () => {
    assert.deepEqual(parsePhotoDataUrl('data:image/jpeg;base64,AAAB'), { contentType: 'image/jpeg', base64: 'AAAB' });
  });

  it('misses cleanly on anything that is not one', () => {
    for (const value of ['', 'https://example.org/plate.jpg', 'data:image/jpeg,AAAB', 'data:;base64,AAAB', 'data:image/jpeg;base64,']) {
      assert.equal(parsePhotoDataUrl(value), null, value);
    }
  });
});

describe('exportPhotoForFeedback', () => {
  it('returns the cached photograph when the cache still holds it', async () => {
    const blob = await exportPhotoForFeedback({
      userId: 1,
      logBatchId: 'batch-a',
      readDataUrl: async () => dataUrl('image/jpeg', 1024),
    });

    assert.notEqual(blob, null);
    assert.equal(blob?.type, 'image/jpeg');
    assert.equal(blob?.size, 1024);
  });

  // The requirement, stated literally: an evicted photograph must not block a
  // report, so this answers null rather than throwing.
  it('answers null for an EVICTED photograph instead of throwing', async () => {
    const blob = await exportPhotoForFeedback({ userId: 1, logBatchId: 'batch-a', readDataUrl: async () => null });
    assert.equal(blob, null);
  });

  it('answers null for an entry that never came from a scan, without touching the cache', async () => {
    let reads = 0;
    const blob = await exportPhotoForFeedback({
      userId: 1,
      logBatchId: null,
      readDataUrl: async () => {
        reads += 1;
        return dataUrl('image/jpeg', 10);
      },
    });

    assert.equal(blob, null);
    assert.equal(reads, 0, 'an entry with no batch must not open the photo cache at all');
  });

  it('answers null when the photo database refuses to open, rather than throwing', async () => {
    const blob = await exportPhotoForFeedback({
      userId: 1,
      logBatchId: 'batch-a',
      readDataUrl: async () => {
        throw new Error('IndexedDB is unavailable');
      },
    });
    assert.equal(blob, null);
  });

  it('answers null for a row that is not a usable data URL', async () => {
    const blob = await exportPhotoForFeedback({ userId: 1, logBatchId: 'b', readDataUrl: async () => 'not-a-data-url' });
    assert.equal(blob, null);
  });

  it('caps an oversized photograph through downscaleToJpeg rather than queueing it', async () => {
    let downscaled = 0;
    const blob = await exportPhotoForFeedback({
      userId: 1,
      logBatchId: 'huge',
      readDataUrl: async () => dataUrl('image/jpeg', MAX_FEEDBACK_IMAGE_BYTES + 1),
      downscale: async () => {
        downscaled += 1;
        return new File([Buffer.alloc(2048)], 'plate.jpg', { type: 'image/jpeg' });
      },
    });

    assert.equal(downscaled, 1, 'the shared downscaler is the only size cap');
    assert.equal(blob?.size, 2048);
  });

  it('answers null when even the downscaled image is over the cap', async () => {
    const blob = await exportPhotoForFeedback({
      userId: 1,
      logBatchId: 'huge',
      readDataUrl: async () => dataUrl('image/jpeg', MAX_FEEDBACK_IMAGE_BYTES + 1),
      downscale: async () => new File([Buffer.alloc(MAX_FEEDBACK_IMAGE_BYTES + 1)], 'plate.jpg', { type: 'image/jpeg' }),
    });
    assert.equal(blob, null);
  });

  it('re-encodes a type the server refuses instead of queueing it', async () => {
    let seen: string | null = null;
    const blob = await exportPhotoForFeedback({
      userId: 1,
      logBatchId: 'gif',
      readDataUrl: async () => dataUrl('image/gif', 64),
      downscale: async (file) => {
        seen = file.type;
        return new File([Buffer.alloc(64)], 'plate.jpg', { type: 'image/jpeg' });
      },
    });

    assert.equal(seen, 'image/gif');
    assert.equal(blob?.type, 'image/jpeg');
  });

  it('answers null when the browser cannot decode the image at all', async () => {
    const blob = await exportPhotoForFeedback({
      userId: 1,
      logBatchId: 'gif',
      readDataUrl: async () => dataUrl('image/gif', 64),
      downscale: async () => {
        throw new Error('createImageBitmap is unavailable');
      },
    });
    assert.equal(blob, null);
  });
});

/** Every `.ts`/`.tsx` under `app/`, recursively. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Comments are stripped first: several of these modules NAME the thing they forbid, on purpose. */
function executableCode(path: string): string {
  return readFileSync(path, 'utf8')
    .replaceAll(/\/\*[\s\S]*?\*\//g, '')
    .replaceAll(/^\s*\/\/.*$/gm, '');
}

describe('the photo cache has exactly one seam for feedback', () => {
  it('is read for a report by feedback-photo-export.ts and by nothing else', () => {
    const seam = join(APP_DIR, 'lib/feedback/feedback-photo-export.ts');
    const readers = sourceFiles(APP_DIR).filter(
      (path) => path !== seam && /getPhotoDataUrl|readPhotoDataUrl|getPhotosStore/.test(executableCode(path)),
    );

    // The photo cache's OWN modules and the receipt's reactive hook are the
    // legitimate readers. Anything else appearing here is a second way out of
    // that database, which is the arrangement this feature was built not to
    // create.
    const allowed = new Set(
      [
        'lib/local-store/photos.ts',
        'lib/local-store/persist.ts',
        'lib/local-store/photo-rekey.ts',
        'hooks/use-plate-photo.ts',
      ].map((relative) => join(APP_DIR, relative)),
    );

    const unexpected = readers.filter((path) => !allowed.has(path));
    assert.deepEqual(unexpected, [], `unexpected readers of the photo cache:\n${unexpected.join('\n')}`);
  });

  it('is not reachable from the backup or the sync bridge', () => {
    for (const relative of ['lib/local-store/backup.ts', 'lib/sync/local-store-bridge.ts']) {
      const code = executableCode(join(APP_DIR, relative));
      assert.equal(/photos|Photo/.test(code), false, `${relative} must not reach the photo cache`);
    }
  });
});
