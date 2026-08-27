/**
 * REWRAPPING THE COMPARTMENT'S SLOTS ON THE SERVER — the lifecycle half of the
 * partition (`openplate-sync` ADR-0002's amendment).
 *
 * The compartment lives inside the blob, so a slot cannot be rewrapped by a
 * key-record write the way the DEK's two doors are. This module is the one
 * operation that opens the current blob, replaces one or both CDK wraps, and
 * pushes the result back under the ordinary compare-and-swap.
 *
 * ── Why this exists at all, and why it is not "just call syncNow" ─────────
 *
 * A recovery reset has NO SESSION and no vault: the person forgot their
 * passphrase, they hold only the recovery code, and the code is the only thing
 * that can open slot 2. The rewrap has to happen in the same client moment,
 * while that code is still in hand — a compartment whose slot 1 belongs to a
 * passphrase nobody has any more, and whose slot 2 belongs to a code already
 * spent, is unopenable forever. So the operation must work from
 * `{http, accountId, dek}` alone.
 *
 * ── The stamp bump is load-bearing ───────────────────────────────────────
 *
 * The compartment is one entity under the per-entity Lamport clock. Writing
 * new wrap bytes at the SAME stamp would let another device's merge keep its
 * own stale copy on the `(lamport, deviceId)` tie-break — silently undoing the
 * rewrap and leaving a compartment that stops opening after a passphrase
 * change. So the stamp advances with this device's id, exactly as an ordinary
 * edit would.
 *
 * ── The residual window, stated ──────────────────────────────────────────
 *
 * A credential change is atomic for the key records (one request) but this
 * push is a second one. If the device dies between them, the compartment's
 * slot 1 still belongs to the OLD passphrase. Nothing is lost — the local
 * store holds the plaintext, and slot 2 still opens — but a fresh sign-in on a
 * second device will not adopt it until the changing device syncs again, which
 * it does on its next cycle because the session still holds the CDK. The
 * alternative orderings all have a mirrored window; this is the one where the
 * device that can repair it is the device that caused it.
 */
import { buildEnvelope } from './engine/envelope/build-envelope';
import type { SyncPayload } from './engine/envelope/types';
import { ENVELOPE_VERSION } from './engine/protocol';
import type { SyncHttpClient } from './engine/client/http-client';
import { SyncRequestError } from './engine/client/sync-error';
import { SCHEMA_VERSION } from '#app/lib/local-store';
import { base64ToBytes, bytesToBase64 } from './engine/crypto/base64';
import { unwrapCdk, wrapCdk } from './engine/crypto/private-store';
import { decryptWithSchemaProbe } from './orchestrator';
import { readSealedPrivateStore, replaceSealedPrivateStore, type SealedPrivateStore } from './snapshot-partition';
import { PRIVATE_STORE_ENTITY_KEY } from './snapshot-sync';

/** How many CAS rounds a rewrap fights for. Same shape as the sync cycle's loop, and bounded for the same reason. */
const DEFAULT_MAX_ATTEMPTS = 3;

/** Which door the caller can currently open the CDK with. */
export type PrivateStoreSlot = 'passphrase' | 'recovery';

/**
 * The two calls a rewrap makes, and no more.
 *
 * Narrowed from `SyncHttpClient` on purpose: this operation must not be able
 * to touch a key record, and a test must not have to fake one to exercise it.
 */
export type BlobTransport = Pick<SyncHttpClient, 'pullBlob' | 'pushBlob'>;

export interface RewrapPrivateStoreInput {
  http: BlobTransport;
  accountId: number;
  /** The account's data key — needed to open the blob the compartment rides in, never to open the compartment itself. */
  dek: Uint8Array;
  /** Stamped onto the compartment entity, so the rewrap outranks any peer's stale copy. */
  deviceId: string;
  /** The KEK that opens the CDK today. */
  currentKek: CryptoKey;
  /** Which slot {@link RewrapPrivateStoreInput.currentKek} opens. */
  currentSlot: PrivateStoreSlot;
  /** The new `K_pp`, or `null` to leave slot 1 as it is. */
  nextPassphraseKek: CryptoKey | null;
  /** The new `K_pr`, or `null` to leave slot 2 as it is. */
  nextRecoveryKek: CryptoKey | null;
  maxAttempts?: number;
}

/** What a rewrap did. `no-compartment` is an ordinary outcome, not a failure — most accounts have never generated a share key. */
export type RewrapPrivateStoreResult =
  | { status: 'no-compartment' }
  /** The caller's key did not open the slot it named. The compartment is left untouched. */
  | { status: 'unopenable' }
  | { status: 'rewrapped'; cdk: Uint8Array; sealed: SealedPrivateStore };

/**
 * Rewraps the compartment's slots in the account's current blob.
 *
 * Leaves the compartment's CIPHERTEXT byte-identical: only the wraps change,
 * because the CDK does not. Re-encrypting the plaintext here would need the
 * region in the clear, which this operation deliberately never has to touch.
 */
export async function rewrapPrivateStoreOnServer(input: RewrapPrivateStoreInput): Promise<RewrapPrivateStoreResult> {
  const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const pulled = await input.http.pullBlob();
    // A fresh account with nothing pushed yet has no compartment to rewrap.
    // The session's own wraps are updated by the caller either way, so the
    // first push carries the new ones.
    if (pulled === null) return { status: 'no-compartment' };

    const decrypted = await decryptWithSchemaProbe({
      ciphertext: pulled.ciphertext,
      envelopeVersion: pulled.envelopeVersion,
      blobVersion: pulled.blobVersion,
      accountId: input.accountId,
      dek: input.dek,
    });

    const sealed = readSealedPrivateStore({ snapshot: decrypted.payload.snapshot });
    if (sealed === null) return { status: 'no-compartment' };

    const cdk = await openCdk({ sealed, kek: input.currentKek, slot: input.currentSlot });
    if (cdk === null) return { status: 'unopenable' };

    const rewrapped = await rewrapSlots({ sealed, cdk, input });
    const targetVersion = pulled.blobVersion + 1;
    const envelope = await buildEnvelope({
      payload: withRewrappedCompartment({ payload: decrypted.payload, sealed: rewrapped, deviceId: input.deviceId }),
      dek: input.dek,
      // The blob is re-framed at the version it is about to occupy, and at
      // THIS build's schema version — the payload it carries came back through
      // the same probe that would have migrated it, so claiming an older
      // version here would be a lie the next reader has to guess around.
      aadFields: { accountId: input.accountId, blobVersion: targetVersion, payloadSchemaVersion: SCHEMA_VERSION },
    });

    const result = await input.http.pushBlob({
      baseVersion: pulled.blobVersion,
      envelopeVersion: ENVELOPE_VERSION,
      ciphertext: envelope.ciphertext,
    });
    if (result.status === 'conflict') continue;

    return { status: 'rewrapped', cdk, sealed: rewrapped };
  }

  throw new SyncRequestError({
    kind: 'conflict',
    message: `Could not update this account’s share keys after ${maxAttempts} attempts — another device is writing continuously. Try again.`,
  });
}

async function openCdk({
  sealed,
  kek,
  slot,
}: {
  sealed: SealedPrivateStore;
  kek: CryptoKey;
  slot: PrivateStoreSlot;
}): Promise<Uint8Array | null> {
  const wrapped = slot === 'passphrase' ? sealed.cdkWrapPassphrase : sealed.cdkWrapRecovery;
  try {
    return await unwrapCdk({ wrappedCdk: base64ToBytes(wrapped), kek });
  } catch {
    return null;
  }
}

async function rewrapSlots({
  sealed,
  cdk,
  input,
}: {
  sealed: SealedPrivateStore;
  cdk: Uint8Array;
  input: RewrapPrivateStoreInput;
}): Promise<SealedPrivateStore> {
  return {
    ciphertext: sealed.ciphertext,
    cdkWrapPassphrase:
      input.nextPassphraseKek === null ?
        sealed.cdkWrapPassphrase
      : bytesToBase64(await wrapCdk({ cdk, kek: input.nextPassphraseKek })),
    cdkWrapRecovery:
      input.nextRecoveryKek === null ?
        sealed.cdkWrapRecovery
      : bytesToBase64(await wrapCdk({ cdk, kek: input.nextRecoveryKek })),
  };
}

/**
 * Puts the rewrapped compartment back into the payload and advances its stamp.
 *
 * Everything else in the payload — every diary entry, every other stamp, every
 * tombstone — is passed through untouched. This operation is not a sync cycle
 * and must not decide anything about the diary.
 */
function withRewrappedCompartment({
  payload,
  sealed,
  deviceId,
}: {
  payload: SyncPayload;
  sealed: SealedPrivateStore;
  deviceId: string;
}): SyncPayload {
  const previous = payload.syncMeta.perEntity[PRIVATE_STORE_ENTITY_KEY];
  return {
    snapshot: replaceSealedPrivateStore({ snapshot: payload.snapshot, sealed }),
    syncMeta: {
      ...payload.syncMeta,
      perEntity: {
        ...payload.syncMeta.perEntity,
        [PRIVATE_STORE_ENTITY_KEY]: { lamport: (previous?.lamport ?? 0) + 1, deviceId },
      },
    },
  };
}
