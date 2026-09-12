/**
 * `invalid` HAS TWO PRODUCERS, and they must not be reported as one thing.
 *
 *  - an HTTP `400`, which is the service refusing a payload. Today that is the
 *    shrink guard turning back a device that lost its local copy. Telling that
 *    person "this app and the sync server don't speak the same version yet"
 *    sends them to look for an update that will not help, and the cycle has
 *    already healed the device by then;
 *  - `decryptWithSchemaProbe`, thrown on THIS device with no HTTP status at
 *    all, when a pulled blob will not verify under any schema version this
 *    build knows. A blob a newer app wrote is exactly that, and there the
 *    version sentence is true.
 *
 * M225 first mapped both to `failed`, which silenced the true one. `status` is
 * the discriminator, and this file pins each side of it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

import { describeSyncFailure } from '../../app/lib/sync/sync-actions';
import { decryptWithSchemaProbe } from '../../app/lib/sync/orchestrator';
import { SyncRequestError } from '../../app/lib/sync/engine/client/sync-error';

test('a refused push is reported as a failure, never as a version mismatch', () => {
  const refusal = new SyncRequestError({
    kind: 'invalid',
    status: 400,
    message: 'This push would delete more than half of the stored data.',
  });
  assert.deepEqual(describeSyncFailure(refusal), { reason: 'failed', message: refusal.message });
});

test('a blob this device cannot decrypt is reported as a version mismatch', async () => {
  // THE REAL PRODUCER, not a hand-built error: the probe walks every schema
  // version this build knows and throws when the tag never verifies. Ciphertext
  // of the right shape and a key that never wrote it is that case.
  const thrown = await decryptWithSchemaProbe({
    ciphertext: new Uint8Array(64).fill(9),
    envelopeVersion: 1,
    blobVersion: 3,
    accountId: 11,
    dek: new Uint8Array(32).fill(4),
  }).then(
    () => null,
    (cause: unknown) => cause,
  );
  assert.ok(thrown instanceof SyncRequestError, 'the probe must raise a sync error');
  // CONTROL: it really is the same `kind` the 400 above carries, so the two
  // tests are about ONE value being split rather than two unrelated ones.
  assert.equal(thrown.kind, 'invalid');
  assert.equal(thrown.status, null, 'and it carries no HTTP status, because it never left this device');

  assert.deepEqual(describeSyncFailure(thrown), { reason: 'incompatible', message: thrown.message });
});
