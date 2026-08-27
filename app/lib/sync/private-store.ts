/**
 * The OWNER-PRIVATE COMPARTMENT, as a live session concept — the layer between
 * `engine/crypto/private-store.ts` (bytes) and the sync cycle (snapshots).
 *
 * It owns three things and nothing else:
 *
 *  1. **Establishing** a compartment when both doors are in hand at once
 *     (first-time setup, and the reset that mints a new recovery code).
 *  2. **Sealing** the owner-private region for a push — reusing the sealed
 *     bytes verbatim while the plaintext has not changed.
 *  3. **Adopting** a pulled compartment: opening it with `K_pp`, remembering
 *     the CDK for the rest of the session.
 *
 * ── Why the seal is CACHED, and why that is not an optimisation ───────────
 *
 * AES-GCM takes a fresh random IV on every encryption, so re-sealing an
 * unchanged compartment produces different bytes every time. The compartment
 * is one entity under the per-entity Lamport clock, and a changed entity means
 * a new stamp, a failed `payloadsEqual`, and a push. Without the cache, EVERY
 * BOOT OF EVERY DEVICE would write a new blob version — burning the 5-version
 * retention window and turning "open the app" into a write. The cache keys on
 * the region's content hash, the same hasher the sync baseline uses.
 *
 * ── The CDK lives exactly as long as the DEK ─────────────────────────────
 *
 * In memory, in the vault, for the session. It is never persisted, never
 * logged and never serialized into a snapshot — the only form of it that
 * leaves this device is the two wrapped slots.
 */
import { base64ToBytes, bytesToBase64 } from './engine/crypto/base64';
import { openPrivateStore, sealPrivateStore, unwrapCdk } from './engine/crypto/private-store';
import type { EstablishedPrivateStore } from './engine/crypto/private-store';
import { contentHash } from './snapshot-sync';
import { parseOwnerPrivateRegion, type OwnerPrivateRegion, type SealedPrivateStore } from './snapshot-partition';

export type { EstablishedPrivateStore };

/**
 * The session's view of the compartment. MUTABLE, and held in the vault beside
 * the DEK — a passphrase change and a first pull both rewrite it in place, and
 * every reader must see the change or it will re-emit a stale wrap.
 */
export interface PrivateStoreSession {
  /** Binds the compartment's AAD. A blob replayed into another account fails the tag check. */
  accountId: number;
  /** `K_pp` for the CURRENT passphrase — the door this session can open, and the one a passphrase change replaces. */
  passphraseKek: CryptoKey;
  /** The compartment data key, once known (from setup, or from an adopted pull). `null` means this session has no compartment yet. */
  cdk: Uint8Array | null;
  /** The two wraps exactly as they must be re-emitted. Never rebuilt from the CDK on a push — a rebuild would rewrap slot 2 under a KEK this session does not have. */
  wraps: { cdkWrapPassphrase: string; cdkWrapRecovery: string } | null;
  /** The last sealed compartment and the region hash it corresponds to. See this module's header on why it exists. */
  cache: { regionHash: string; sealed: SealedPrivateStore } | null;
}

/** Opens a session view. `established` is present for a first-time setup and absent for a sign-in, which adopts on its first pull instead. */
export function createPrivateStoreSession({
  accountId,
  passphraseKek,
  established,
}: {
  accountId: number;
  passphraseKek: CryptoKey;
  established?: EstablishedPrivateStore | null;
}): PrivateStoreSession {
  return {
    accountId,
    passphraseKek,
    cdk: established?.cdk ?? null,
    wraps:
      established ?
        { cdkWrapPassphrase: established.cdkWrapPassphrase, cdkWrapRecovery: established.cdkWrapRecovery }
      : null,
    cache: null,
  };
}

/**
 * Seals the owner-private region for a push.
 *
 * Returns `null` when this session has no compartment — an account created
 * before the partition, whose first device has not yet minted one. That is a
 * DEGRADED but SAFE state: the key material simply stays on this device
 * instead of being published in the clear. Regenerating the recovery code
 * establishes a compartment and ends it (see `sync-actions.ts`).
 */
export async function sealOwnerPrivateRegion({
  session,
  region,
}: {
  session: PrivateStoreSession;
  region: OwnerPrivateRegion;
}): Promise<SealedPrivateStore | null> {
  const { cdk, wraps } = session;
  if (cdk === null || wraps === null) return null;

  const regionHash = contentHash(region);
  if (session.cache !== null && session.cache.regionHash === regionHash) return session.cache.sealed;

  const ciphertext = await sealPrivateStore({
    cdk,
    plaintext: new TextEncoder().encode(JSON.stringify(region)),
    accountId: session.accountId,
  });
  const sealed: SealedPrivateStore = { ciphertext: bytesToBase64(ciphertext), ...wraps };
  session.cache = { regionHash, sealed };
  return sealed;
}

/**
 * Opens a pulled compartment, adopting its CDK into the session on the way.
 *
 * Returns `null` rather than throwing when it cannot be opened, and the caller
 * keeps whatever the device already holds. That is deliberate: the states this
 * covers — a slot another device rewrapped moments ago, a pre-partition blob,
 * a compartment belonging to a passphrase this session no longer has — are all
 * "we learned nothing", and none of them justifies blanking a share key pair
 * that is sitting in IndexedDB and working fine.
 */
export async function openOwnerPrivateRegion({
  session,
  sealed,
}: {
  session: PrivateStoreSession;
  sealed: SealedPrivateStore | null;
}): Promise<OwnerPrivateRegion | null> {
  if (sealed === null) return null;

  for (const cdk of await candidateCdks({ session, sealed })) {
    const region = await tryOpen({ cdk, sealed, accountId: session.accountId });
    if (region === null) continue;
    session.cdk = cdk;
    session.wraps = { cdkWrapPassphrase: sealed.cdkWrapPassphrase, cdkWrapRecovery: sealed.cdkWrapRecovery };
    // Cache the bytes that were just pulled, so the next push re-emits this
    // compartment VERBATIM instead of re-sealing it under a fresh IV and
    // making every boot write a blob version.
    session.cache = { regionHash: contentHash(region), sealed };
    return region;
  }
  return null;
}

/** Replaces the session's wraps after a rewrap landed on the server, and drops the seal cache so the next push carries them. */
export function adoptRewrappedSlots({
  session,
  cdk,
  sealed,
}: {
  session: PrivateStoreSession;
  cdk: Uint8Array;
  sealed: SealedPrivateStore;
}): void {
  session.cdk = cdk;
  session.wraps = { cdkWrapPassphrase: sealed.cdkWrapPassphrase, cdkWrapRecovery: sealed.cdkWrapRecovery };
  session.cache = null;
}

/**
 * The CDKs worth trying against `sealed`, in order.
 *
 * The session's own comes first: a device that has just rewrapped its own slot
 * must not be talked out of its CDK by a blob it has not overwritten yet. Slot
 * 1 comes second, which is the second-device and fresh-sign-in case — and it
 * is also the recovery from the rare double-establish, where two devices each
 * minted a compartment and last-writer-wins kept one of them.
 */
async function candidateCdks({
  session,
  sealed,
}: {
  session: PrivateStoreSession;
  sealed: SealedPrivateStore;
}): Promise<Uint8Array[]> {
  const candidates = session.cdk === null ? [] : [session.cdk];
  try {
    candidates.push(
      await unwrapCdk({ wrappedCdk: base64ToBytes(sealed.cdkWrapPassphrase), kek: session.passphraseKek }),
    );
  } catch {
    // Slot 1 belongs to a passphrase this session does not hold (a change that
    // landed on another device first). Not an error here: the session's own
    // CDK may still open the ciphertext, and if it does not, the caller keeps
    // what the device already has.
  }
  return candidates;
}

/** One decrypt attempt. `null` for every failure — a GCM tag check does not say why it failed, and this must not pretend to know. */
async function tryOpen({
  cdk,
  sealed,
  accountId,
}: {
  cdk: Uint8Array;
  sealed: SealedPrivateStore;
  accountId: number;
}): Promise<OwnerPrivateRegion | null> {
  try {
    const plaintext = await openPrivateStore({ cdk, ciphertext: base64ToBytes(sealed.ciphertext), accountId });
    return parseOwnerPrivateRegion({ value: JSON.parse(new TextDecoder().decode(plaintext)) });
  } catch {
    return null;
  }
}
