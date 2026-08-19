/**
 * The sync cycle: snapshot → stamp → pull → decrypt → merge → encrypt → push,
 * with the mandatory compare-and-swap retry loop around it.
 *
 * This is the imperative shell (`functional-core`). Every decision it makes —
 * what changed, who wins a conflict, whether a push is even needed — is a call
 * into the pure `snapshot-sync.ts`; what lives here is ordering, I/O and the
 * retry policy. Both halves are injected (`SyncCycleDeps`), so the integration
 * suite drives the real algorithm against a protocol-faithful fake service
 * without a browser or a database.
 *
 * ── The 409 loop is mandatory, not an optimization ─────────────────────────
 *
 * `PROTOCOL.md` §5.1 is explicit: a client that treats `409` as fatal strands
 * the device permanently out of sync. Losing the CAS means another device
 * wrote first, which is a NORMAL outcome — pull it, merge it, re-encrypt with
 * the AAD bound to the NEW blob version, push again. Bounded by
 * `maxAttempts` so a pathologically busy account fails loudly instead of
 * spinning.
 *
 * ── Offline is a no-op, deliberately ──────────────────────────────────────
 *
 * There is no outbound queue. The local store IS the source of truth, so an
 * offline edit is already durable and the next successful cycle carries it up
 * whole. A queue would add a second representation of the same pending work,
 * and the two would eventually disagree.
 *
 * ── The AAD, and why schema versions are probed ───────────────────────────
 *
 * Decryption binds `{accountId, blobVersion, payloadSchemaVersion}`. The first
 * two travel on the wire; the third does not — so a device pulling a blob
 * written by a peer on an OLDER `SCHEMA_VERSION` has to know which value to
 * present before it can decrypt. It cannot, so it tries the current version
 * and then walks down. That is bounded (six attempts today, one cheap GCM
 * check each) and it buys real forward compatibility: an older peer's blob
 * decrypts and is migrated forward by the backup migration chain. A blob from
 * a NEWER schema still fails every attempt, which is the correct refusal —
 * this build genuinely cannot read it, and guessing would corrupt it.
 */
import { buildEnvelope, parseEnvelope } from './engine/envelope/build-envelope';
import type { SyncPayload } from './engine/envelope/types';
import { ENVELOPE_VERSION, MAX_BLOB_BYTES } from './engine/protocol';
import type { SyncHttpClient } from './engine/client/http-client';
import { SyncRequestError } from './engine/client/sync-error';
import { SCHEMA_VERSION, type LocalStoreSnapshot } from '#app/lib/local-store';
import {
  baselineFromPayload,
  mergeSnapshots,
  payloadsEqual,
  stampSnapshot,
  type StampedSnapshot,
} from './snapshot-sync';
import type { PersistedSyncState, SyncStateStore } from './sync-state';
import { withSyncOrchestratorLock } from './sync-lock';

/** How many CAS rounds a single cycle will fight for before giving up. */
export const DEFAULT_MAX_PUSH_ATTEMPTS = 5;

export interface SyncCycleDeps {
  /** Binds the envelope's AAD — a blob cannot be replayed into another account. */
  accountId: number;
  /** The unwrapped data-encryption key. Held in memory for the session only, never persisted anywhere. */
  dek: Uint8Array;
  http: SyncHttpClient;
  state: SyncStateStore;
  deviceId: string;
  readSnapshot: () => Promise<LocalStoreSnapshot>;
  applySnapshot: (input: { merged: LocalStoreSnapshot; local: LocalStoreSnapshot }) => Promise<void>;
  parseRemoteSnapshot: (input: { snapshot: unknown; schemaVersion: number }) => LocalStoreSnapshot;
  now?: () => number;
  maxAttempts?: number;
}

export interface SyncCycleResult {
  /** The blob version this device now agrees with. */
  blobVersion: number;
  /** Whether this cycle actually wrote a new blob (false when the merge contributed nothing). */
  pushed: boolean;
  /** How many CAS rounds it took. `1` is the uncontended case. */
  attempts: number;
  lastSyncedAt: number;
}

/**
 * Runs one full sync cycle under the device's single-writer lock.
 *
 * The lock wraps the WHOLE cycle rather than just the push: read-then-write
 * across two tabs is exactly the interleaving that produces a lost update, and
 * the CAS on the server only protects the blob, not this device's baseline.
 */
export async function runSyncCycle(deps: SyncCycleDeps): Promise<SyncCycleResult> {
  return withSyncOrchestratorLock(() => runSyncCycleUnlocked(deps));
}

/** The cycle itself, lock-free — exported for tests that supply their own serialization. */
export async function runSyncCycleUnlocked(deps: SyncCycleDeps): Promise<SyncCycleResult> {
  const now = deps.now ?? Date.now;
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_PUSH_ATTEMPTS;

  const local = await deps.readSnapshot();
  const persisted = deps.state.load();
  const stamped = stampSnapshot({ snapshot: local, baseline: persisted.baseline, deviceId: deps.deviceId });
  const localPayload: StampedSnapshot = { snapshot: local, meta: stamped.meta };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const remote = await pullRemotePayload(deps);
    const baseVersion = remote?.blobVersion ?? 0;
    const merged = remote === null ? localPayload : mergeSnapshots({ local: localPayload, remote: remote.payload });

    // Nothing local to contribute: adopt the remote blob as-is and stop. This
    // is the common case on every boot, and skipping the push is what keeps
    // "open the app" from consuming a blob version.
    if (remote !== null && payloadsEqual(merged, remote.payload)) {
      await deps.applySnapshot({ merged: merged.snapshot, local });
      const settled = commitState({ deps, merged, blobVersion: baseVersion, at: now() });
      return {
        blobVersion: baseVersion,
        pushed: false,
        attempts: attempt,
        lastSyncedAt: settled.lastSyncedAt ?? now(),
      };
    }

    const targetVersion = baseVersion + 1;
    const envelope = await buildEnvelope({
      payload: toWirePayload(merged),
      dek: deps.dek,
      aadFields: { accountId: deps.accountId, blobVersion: targetVersion, payloadSchemaVersion: SCHEMA_VERSION },
    });

    // Mirror the service's cap client-side (`PROTOCOL.md` §8) so the failure
    // names the real problem instead of arriving as an opaque 413.
    if (envelope.ciphertext.byteLength > MAX_BLOB_BYTES) {
      throw new SyncRequestError({
        kind: 'too-large',
        message: `This device's encrypted diary is ${envelope.ciphertext.byteLength} bytes, over the ${MAX_BLOB_BYTES}-byte sync limit.`,
      });
    }

    const result = await deps.http.pushBlob({
      baseVersion,
      envelopeVersion: ENVELOPE_VERSION,
      ciphertext: envelope.ciphertext,
    });
    if (result.status === 'conflict') continue;

    await deps.applySnapshot({ merged: merged.snapshot, local });
    const at = now();
    commitState({ deps, merged, blobVersion: result.newVersion, at });
    return { blobVersion: result.newVersion, pushed: true, attempts: attempt, lastSyncedAt: at };
  }

  throw new SyncRequestError({
    kind: 'conflict',
    message: `Sync could not settle after ${maxAttempts} attempts — another device is writing continuously.`,
  });
}

interface RemotePayload {
  blobVersion: number;
  payload: StampedSnapshot;
}

async function pullRemotePayload(deps: SyncCycleDeps): Promise<RemotePayload | null> {
  const pulled = await deps.http.pullBlob();
  // A 404 is how a fresh account looks, not an error (`PROTOCOL.md` §5.2).
  if (pulled === null) return null;

  const decrypted = await decryptWithSchemaProbe({
    ciphertext: pulled.ciphertext,
    envelopeVersion: pulled.envelopeVersion,
    blobVersion: pulled.blobVersion,
    accountId: deps.accountId,
    dek: deps.dek,
  });

  return {
    blobVersion: pulled.blobVersion,
    payload: {
      snapshot: deps.parseRemoteSnapshot({
        snapshot: decrypted.payload.snapshot,
        schemaVersion: decrypted.schemaVersion,
      }),
      meta: decrypted.payload.syncMeta,
    },
  };
}

/**
 * Decrypts a pulled blob, walking `payloadSchemaVersion` down from this
 * build's current value until the GCM tag verifies (see the module header for
 * why the value cannot simply be read off the wire).
 *
 * Every attempt failing is reported as ONE clear error rather than the last
 * cipher exception: "wrong key or a newer app wrote this" is actionable;
 * "OperationError" is not.
 */
async function decryptWithSchemaProbe({
  ciphertext,
  envelopeVersion,
  blobVersion,
  accountId,
  dek,
}: {
  ciphertext: Uint8Array;
  envelopeVersion: number;
  blobVersion: number;
  accountId: number;
  dek: Uint8Array;
}): Promise<{ payload: SyncPayload; schemaVersion: number }> {
  for (let schemaVersion = SCHEMA_VERSION; schemaVersion >= 1; schemaVersion -= 1) {
    try {
      const payload = await parseEnvelope({
        envelope: { envelopeVersion, ciphertext },
        dek,
        aadFields: { accountId, blobVersion, payloadSchemaVersion: schemaVersion },
      });
      return { payload, schemaVersion };
    } catch {
      // Wrong AAD guess, or genuinely undecryptable. Keep walking down; the
      // loop's exhaustion below is the only place this becomes an error.
    }
  }
  throw new SyncRequestError({
    kind: 'invalid',
    message:
      'This account’s synced data could not be decrypted on this device. Either the passphrase is wrong, or it was written by a newer version of the app.',
  });
}

function toWirePayload(payload: StampedSnapshot): SyncPayload {
  return { snapshot: payload.snapshot, syncMeta: payload.meta };
}

/** Persists the new baseline. Hashes are recomputed from what was just agreed, so the NEXT cycle sees "unchanged". */
function commitState({
  deps,
  merged,
  blobVersion,
  at,
}: {
  deps: SyncCycleDeps;
  merged: StampedSnapshot;
  blobVersion: number;
  at: number;
}): PersistedSyncState {
  const next: PersistedSyncState = {
    formatVersion: deps.state.load().formatVersion,
    lastBlobVersion: blobVersion,
    lastSyncedAt: at,
    baseline: baselineFromPayload(merged),
  };
  deps.state.save(next);
  return next;
}
