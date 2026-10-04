/**
 * The step that decides what leaves the device for an AI (M3/05, 2026-10-04).
 *
 * THE CLAIM: a photo whose re-encode fails is NOT sent. The old `/add/photo`
 * caught the failure and sent the picked file itself, which still carries its
 * EXIF. `downscaleToJpeg` needs a canvas, which this runner does not have, so
 * the transcoder is injected: this file holds the decision, and
 * `tests/e2e/scan-photo-leaves-re-encoded.spec.ts` holds the bytes in a real
 * browser.
 *
 * THE CONTROL. The old behaviour is the same function answering `ready` with
 * the PICKED file when the transcoder throws. The first test fails against it,
 * because it asks for `not-prepared` and for no `file` at all. The second test
 * is the other half: when the transcoder works, the file that comes out is the
 * transcoder's, never the picked one.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { prepareUploadPhoto } from '../../app/lib/prepare-upload-photo';

const PICKED = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe1])], 'IMG_0001.heic', { type: 'image/heic' });
const REENCODED = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xdb])], 'IMG_0001.jpg', { type: 'image/jpeg' });

describe('prepareUploadPhoto', () => {
  it('sends nothing when the re-encode fails, and offers no file to send', async () => {
    const outcome = await prepareUploadPhoto({
      picked: PICKED,
      downscale: () => Promise.reject(new Error('The source image cannot be decoded.')),
    });
    assert.deepEqual(outcome, { kind: 'not-prepared' });
    assert.equal('file' in outcome, false, 'a failed re-encode left a file for the caller to send');
  });

  it('hands over the re-encoded file and never the picked one', async () => {
    const outcome = await prepareUploadPhoto({ picked: PICKED, downscale: () => Promise.resolve(REENCODED) });
    assert.equal(outcome.kind, 'ready');
    if (outcome.kind !== 'ready') return;
    assert.equal(outcome.file, REENCODED);
    assert.notEqual(outcome.file, PICKED);
  });

  it('passes the picked file to the transcoder', async () => {
    const seen: File[] = [];
    await prepareUploadPhoto({
      picked: PICKED,
      downscale: (file) => {
        seen.push(file);
        return Promise.resolve(REENCODED);
      },
    });
    assert.deepEqual(seen, [PICKED]);
  });
});
