/**
 * Every sharing operation the UI can trigger, wired to the vault and the
 * device store — the composition root for `sharing.ts`, exactly as
 * `sync-actions.ts` is for the engine.
 *
 * Nothing here DECIDES anything. The ceremony's refusals, the classification
 * of a grant and the rotation's keep list all live in `sharing.ts`, where they
 * are testable without a session; this file supplies the DEK, the transport
 * and the two store writes, and nothing else.
 *
 * ── Failures throw, absences do not ──────────────────────────────────────
 *
 * A deployment with `SYNC_SHARING` unset answers the ordinary unknown-route
 * 404 on every share path (ADR-0002 prohibition 10). That is not a failure and
 * it must not read like one: the list functions return `unavailable` and the
 * surface disappears. A genuine error still throws, because the callers are
 * React handlers that show one.
 */
import {
  deleteLocalSharePeer,
  getLocalShareIdentity,
  listLocalSharePeers,
  putLocalShareIdentity,
  putLocalSharePeer,
  type LocalSharePeer,
} from '#app/lib/local-store';
import { base64ToBytes, bytesToBase64 } from './engine/crypto/base64';
import { generateShareKeyPair, shareFingerprintDisplay, shareKeyFingerprint } from './engine/crypto/share-wrap';
import { generateDek, unwrapDek, wrapDek } from './engine/crypto/dek-wrap';
import { buildEnvelope } from './engine/envelope/build-envelope';
import { ENVELOPE_VERSION } from './engine/protocol';
import type { RotateDekKeyRecordWire } from './engine/protocol';
import { SyncRequestError } from './engine/client/sync-error';
import { workerArgon2idDeriver } from './engine/client/argon2-worker';
import { deriveCredentialsFromPassphrase } from './engine/client/derive-credentials';
import {
  derivePrivateStoreRecoveryKek,
  deriveRecoveryAuthHash,
  deriveRecoveryKek,
  generateRecoveryCode,
} from './engine/client/recovery-kek';
import type { Argon2idDeriver } from './engine/client/setup-keys';
import type { ReceivedShare } from './engine/client/http-client';
import { decryptWithSchemaProbe } from './orchestrator';
import { adoptRewrappedSlots } from './private-store';
import { rewrapPrivateStoreOnServer } from './private-store-rewrap';
import { getSyncVault, type SyncVault } from './sync-session';
import { markSyncPending, syncNow } from './sync-actions';
import {
  buildRotationKeepList,
  describeGrants,
  openSharedDiary,
  planRotationRewraps,
  runShareCeremony,
  type OpenSharedDiaryResult,
  type RotationDrop,
  type ShareCeremonyResult,
  type ShareGrantView,
} from './sharing';

/** A read of a surface that may not exist on this deployment. Mirrors the client's own `ShareSurfaceRead`. */
export type SharingRead<TValue> = { status: 'available'; value: TValue } | { status: 'unavailable' };

function requireVault(operation: string): SyncVault {
  const vault = getSyncVault();
  if (vault === null) throw new Error(`${operation} called without an open sync session`);
  return vault;
}

// ---------------------------------------------------------------------------
// This device's own share identity (the clinician's half)
// ---------------------------------------------------------------------------

/** This account's share identity, as the UI needs to show it. The private half never leaves `sharing.ts`'s call frames. */
export interface ShareIdentityView {
  publicKeyBase64: string;
  /** The full Crockford fingerprint, computed HERE from the key's own bytes. */
  fingerprint: string;
  /** The 60 bits a clinician actually reads aloud: 12 characters in three groups of four. */
  fingerprintDisplay: string;
  createdAt: number;
}

/** This account's share identity, or `null` on a device that has never generated one — the normal state, since sharing is opt-in. */
export async function readShareIdentity(): Promise<ShareIdentityView | null> {
  const identity = await getLocalShareIdentity();
  if (identity === null) return null;
  const fingerprint = await shareKeyFingerprint(base64ToBytes(identity.publicKeyRaw));
  return {
    publicKeyBase64: identity.publicKeyRaw,
    fingerprint,
    fingerprintDisplay: shareFingerprintDisplay(fingerprint),
    createdAt: identity.createdAt,
  };
}

/**
 * Generates this account's share key pair if it has none, and syncs so the
 * compartment carries it to the account's other devices.
 *
 * NEVER regenerates. A second key pair would silently orphan every wrap
 * already addressed to the first, and the failure would look like "my patients
 * disappeared" months later.
 */
export async function ensureShareIdentity(): Promise<ShareIdentityView> {
  const existing = await readShareIdentity();
  if (existing !== null) return existing;

  const pair = await generateShareKeyPair();
  await putLocalShareIdentity({
    publicKeyRaw: bytesToBase64(pair.publicKeyRaw),
    privateKeyPkcs8: bytesToBase64(pair.privateKeyPkcs8),
    createdAt: Date.now(),
  });
  markSyncPending();
  await syncNow();

  const created = await readShareIdentity();
  if (created === null) throw new Error('the share key pair was generated but could not be read back');
  return created;
}

// ---------------------------------------------------------------------------
// The patient's side: grant, list, revoke
// ---------------------------------------------------------------------------

/** Reads the account's grants and classifies each against what THIS device has pinned. */
export async function loadShareGrants(): Promise<SharingRead<ShareGrantView[]>> {
  const vault = requireVault('loadShareGrants');
  const grants = await vault.http.listShares();
  if (grants.status === 'unavailable') return { status: 'unavailable' };
  return {
    status: 'available',
    value: await describeGrants({ grants: grants.value, pinnedPeers: await listLocalSharePeers() }),
  };
}

/** Every key this device has pinned through a passed ceremony, whether or not a live share points at it. */
export async function loadPinnedPeers(): Promise<LocalSharePeer[]> {
  return listLocalSharePeers();
}

/**
 * The grant, ceremony and all.
 *
 * The typed fingerprint is checked against the key that actually arrived
 * before anything is written — see `sharing.ts`. A successful grant syncs,
 * because the pin lives in the owner-private compartment and a pin that never
 * reaches the blob is a pin the account's other devices do not have.
 */
export async function grantShare({
  granteeAccountId,
  publicKeyBase64,
  label,
  typedFingerprint,
  acceptsKeyChange,
}: {
  granteeAccountId: number;
  publicKeyBase64: string;
  label: string | null;
  typedFingerprint: string;
  acceptsKeyChange?: boolean;
}): Promise<ShareCeremonyResult> {
  const vault = requireVault('grantShare');
  const result = await runShareCeremony({
    transport: vault.http,
    dek: vault.dek,
    grantorAccountId: vault.accountId,
    offered: { accountId: granteeAccountId, publicKeyRaw: base64ToBytes(publicKeyBase64), label },
    typedFingerprint,
    pinnedPeers: await listLocalSharePeers(),
    pinPeer: async (peer) => void (await putLocalSharePeer(peer)),
    acceptsKeyChange,
  });
  if (result.status !== 'granted') return result;

  markSyncPending();
  await syncNow();
  return result;
}

/**
 * Tier 1 revocation: deletes the share row.
 *
 * The server stops serving on the very next request, because the row is read
 * every time and never cached. It CANNOT un-know — the clinician may hold the
 * DEK and everything already pulled — and the copy shown beside this call must
 * say so rather than imply an erasure that did not happen (ADR-0002
 * prohibition 7).
 */
export async function revokeShare(granteeAccountId: number): Promise<void> {
  const vault = requireVault('revokeShare');
  await vault.http.deleteShare(granteeAccountId);
}

/**
 * Forgets a pinned key on this device.
 *
 * Separate from {@link revokeShare} on purpose: un-pinning revokes nothing
 * server-side, and revoking does not throw away a verification the two people
 * performed in a room. Forgetting means the next grant needs a new ceremony.
 */
export async function forgetPinnedPeer(accountId: number): Promise<void> {
  await deleteLocalSharePeer(accountId);
  markSyncPending();
  await syncNow();
}

// ---------------------------------------------------------------------------
// Tier 2: rotating the data key (§5.17)
// ---------------------------------------------------------------------------

/**
 * What a rotation did, and what it could not carry across.
 *
 * THERE IS NO `recoveryCode` HERE, and the absence is the point (M192). A
 * rotation still mints a fresh code — the `recovery` key record has to wrap
 * the new DEK — but the code is escrowed with the service in the same
 * transaction and never shown, exactly as it is at signup. A field for it
 * would be a field a screen could render.
 */
export interface RotateDekOutcome {
  keptShares: number;
  revokedShares: number;
  /** The grants this device could not re-wrap, and why. They are revoked by the rotation. */
  dropped: RotationDrop[];
}

/** The plan a rotation would follow, so the person sees what it costs BEFORE they confirm it. */
export async function planDekRotation(): Promise<SharingRead<{ keep: number; drop: RotationDrop[] }>> {
  const vault = requireVault('planDekRotation');
  const grants = await vault.http.listShares();
  if (grants.status === 'unavailable') return { status: 'unavailable' };
  const plan = await planRotationRewraps({ grants: grants.value, pinnedPeers: await listLocalSharePeers() });
  return { status: 'available', value: { keep: plan.keep.length, drop: plan.drop } };
}

/**
 * TIER 2 REVOCATION — a new data key, the whole blob re-encrypted under it,
 * both key records re-wrapped, and a fresh wrap for every share being kept.
 * One request, one transaction, all or nothing (ADR-0002 prohibition 8).
 *
 * ── Why it asks for the passphrase ───────────────────────────────────────
 *
 * The new DEK has to be wrapped under the passphrase KEK, and the vault does
 * not hold it — only the DEK it once unwrapped. Deriving it needs the
 * passphrase. Verifying the derived KEK against the EXISTING record before
 * submitting is the load-bearing part: a wrong passphrase would otherwise
 * write a `passphrase` record wrapping the new DEK under a key nobody has, and
 * the account would sign in fine and decrypt nothing ever again.
 *
 * ── Why it mints a new recovery code ─────────────────────────────────────
 *
 * §5.17 requires BOTH key records, and the recovery KEK can only be derived
 * from the code itself — which nobody keeps in a session. So a rotation issues
 * a new code and shows it once, exactly as the setup ceremony does. The
 * compartment's slot 2 moves with it in the same client moment; forgetting
 * that would leave the code the user is about to discard as the only thing
 * that opens their share keys.
 *
 * @throws when the passphrase is wrong, when this account has never pushed a
 * blob, or when the blob CAS lost. Nothing is written in any of those cases.
 */
export async function rotateSyncDek({
  passphrase,
  deriveHash = workerArgon2idDeriver,
}: {
  passphrase: string;
  deriveHash?: Argon2idDeriver;
}): Promise<RotateDekOutcome> {
  const vault = requireVault('rotateSyncDek');

  const descriptor = await vault.authClient.fetchKdfDescriptor(vault.email);
  const credentials = await deriveCredentialsFromPassphrase({
    passphrase,
    descriptor: { salt: descriptor.salt, params: descriptor.params },
    deriveHash,
  });

  const records = await vault.http.listKeyRecords();
  const passphraseRecord = records.find((record) => record.kind === 'passphrase');
  if (passphraseRecord === undefined) {
    throw new SyncRequestError({ kind: 'invalid', message: 'This account has no passphrase key record to rotate.' });
  }
  // PROVES the passphrase before anything is submitted. Skipping this is how a
  // typo becomes an account that logs in and decrypts nothing.
  try {
    (await unwrapDek({ wrappedDek: passphraseRecord.wrappedDek, kek: credentials.passphraseKek })).fill(0);
  } catch {
    throw new SyncRequestError({ kind: 'unauthorized', message: 'That passphrase is not this account’s passphrase.' });
  }

  const pulled = await vault.http.pullBlob();
  if (pulled === null) {
    throw new SyncRequestError({
      kind: 'invalid',
      message: 'There is nothing to rotate yet — sync this device once, then try again.',
    });
  }
  const decrypted = await decryptWithSchemaProbe({
    ciphertext: pulled.ciphertext,
    envelopeVersion: pulled.envelopeVersion,
    blobVersion: pulled.blobVersion,
    accountId: vault.accountId,
    dek: vault.dek,
  });

  const grants = await vault.http.listShares();
  const plan = await planRotationRewraps({
    // A deployment with sharing off has no grants and no keep list. The
    // rotation still runs: it is the answer to a DEK the owner believes
    // leaked, and that belief does not depend on anyone else's flag.
    grants: grants.status === 'available' ? grants.value : [],
    pinnedPeers: await listLocalSharePeers(),
  });

  const newDek = generateDek();
  const targetVersion = pulled.blobVersion + 1;
  const envelope = await buildEnvelope({
    payload: decrypted.payload,
    dek: newDek,
    // Framed at the version it is about to occupy, and at the schema version
    // the payload ACTUALLY carries — this operation re-keys bytes, it does not
    // migrate them, and claiming this build's version for an older payload
    // would be a lie the next reader has to guess around.
    aadFields: {
      accountId: vault.accountId,
      blobVersion: targetVersion,
      payloadSchemaVersion: decrypted.schemaVersion,
    },
  });

  const recovery = generateRecoveryCode();
  const keyRecords: RotateDekKeyRecordWire[] = [
    {
      kind: 'passphrase',
      kdfDescriptor: { salt: descriptor.salt, params: descriptor.params },
      wrappedDek: bytesToBase64(await wrapDek({ dek: newDek, kek: credentials.passphraseKek })),
    },
    {
      kind: 'recovery',
      kdfDescriptor: null,
      wrappedDek: bytesToBase64(await wrapDek({ dek: newDek, kek: await deriveRecoveryKek(recovery.raw) })),
    },
  ];

  const result = await vault.http.rotateDek({
    blob: {
      baseVersion: pulled.blobVersion,
      envelopeVersion: ENVELOPE_VERSION,
      ciphertext: bytesToBase64(envelope.ciphertext),
    },
    keyRecords,
    shares: await buildRotationKeepList({ keep: plan.keep, dek: newDek, grantorAccountId: vault.accountId }),
    // THE VERIFIER AND THE ESCROW, in the same transaction as the key records
    // they belong to (M192 addendum). Until this existed the service kept both
    // on the OLD code while the `recovery` record above moved to the new one,
    // so the account ended with a code that authenticated and a different one
    // that decrypted, and neither opened it. Nothing threw; the failure
    // surfaced on a later reset.
    newRecoveryAuthHash: await deriveRecoveryAuthHash(recovery.raw),
    recoveryCode: recovery.formatted,
  });
  if (result.status === 'conflict') {
    throw new SyncRequestError({
      kind: 'conflict',
      message: 'Another device wrote while this rotation was being prepared. Nothing was changed — try again.',
    });
  }

  vault.dek.fill(0);
  vault.dek = newDek;
  vault.state.save({ ...vault.state.load(), lastBlobVersion: result.newVersion });
  await moveCompartmentOntoNewRecoveryCode({ vault, recoveryRaw: recovery.raw });

  return { keptShares: result.keptShares, revokedShares: result.revokedShares, dropped: plan.drop };
}

/**
 * Moves the compartment's slot 2 onto the code the rotation just minted.
 *
 * A DEK rotation does not touch the CDK (ADR-0002's amendment), but it DOES
 * replace the recovery code, and slot 2 is wrapped under a key derived from
 * it. An unopenable outcome is not thrown: the rotation itself already
 * committed, and reporting it as a failure would invite the user to run the
 * whole thing again.
 */
async function moveCompartmentOntoNewRecoveryCode({
  vault,
  recoveryRaw,
}: {
  vault: SyncVault;
  recoveryRaw: Uint8Array;
}): Promise<void> {
  const rewrapped = await rewrapPrivateStoreOnServer({
    http: vault.http,
    accountId: vault.accountId,
    dek: vault.dek,
    deviceId: vault.deviceId,
    currentKek: vault.privateStore.passphraseKek,
    currentSlot: 'passphrase',
    nextPassphraseKek: null,
    nextRecoveryKek: await derivePrivateStoreRecoveryKek(recoveryRaw),
  });
  if (rewrapped.status !== 'rewrapped') return;
  adoptRewrappedSlots({ session: vault.privateStore, cdk: rewrapped.cdk, sealed: rewrapped.sealed });
}

// ---------------------------------------------------------------------------
// The clinician's side: read a patient's diary, on this device
// ---------------------------------------------------------------------------

/** One patient's share, as the clinician's list shows it. */
export interface SharedWithMeView {
  grantorAccountId: number;
  createdAt: string;
  updatedAt: string;
}

/** The shares addressed to this account. `unavailable` when the deployment has no sharing at all. */
export async function loadSharedWithMe(): Promise<SharingRead<SharedWithMeView[]>> {
  const vault = requireVault('loadSharedWithMe');
  const shares = await vault.http.listSharedWithMe();
  if (shares.status === 'unavailable') return { status: 'unavailable' };
  return {
    status: 'available',
    value: shares.value.map((share) => ({
      grantorAccountId: share.grantorAccountId,
      createdAt: share.createdAt,
      updatedAt: share.updatedAt,
    })),
  };
}

/**
 * Opens one patient's diary ON THIS DEVICE — the pull, the unwrap and the
 * decrypt all happen in the browser, and no server ever holds the plaintext.
 *
 * @throws only when this device has no share key pair at all, which is a
 * programming error: nobody can have been granted a share without one.
 */
export async function openSharedPatientDiary(grantorAccountId: number): Promise<OpenSharedDiaryResult> {
  const vault = requireVault('openSharedPatientDiary');
  const identity = await getLocalShareIdentity();
  if (identity === null) {
    return {
      status: 'undecryptable',
      message: 'This device has no sharing key yet. Set one up, then ask for a new invitation.',
    };
  }
  const shares = await vault.http.listSharedWithMe();
  if (shares.status === 'unavailable') return { status: 'unavailable' };
  const share: ReceivedShare | undefined = shares.value.find((entry) => entry.grantorAccountId === grantorAccountId);
  if (share === undefined) return { status: 'unavailable' };

  return openSharedDiary({
    transport: vault.http,
    share,
    identity: {
      publicKeyRaw: base64ToBytes(identity.publicKeyRaw),
      privateKeyPkcs8: base64ToBytes(identity.privateKeyPkcs8),
    },
  });
}

/** Drops a share aimed at this account. Idempotent, and it revokes nothing on the patient's side — their row is theirs to keep or delete. */
export async function dropSharedWithMe(grantorAccountId: number): Promise<void> {
  const vault = requireVault('dropSharedWithMe');
  await vault.http.deleteSharedWithMe(grantorAccountId);
}
