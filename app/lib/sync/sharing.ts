/**
 * CLINICIAN SHARING, as decisions rather than screens (`openplate-sync`
 * ADR-0002, `PROTOCOL.md` §5.16–§5.17).
 *
 * Everything here is pure with respect to the device: it takes the pinned
 * peers, the server's rows and an injected transport, and returns what should
 * happen. The store writes and the vault live one level up in
 * `share-actions.ts`, which is what makes every rule below testable without an
 * IndexedDB or a session.
 *
 * ── The one attack this module exists to stop ────────────────────────────
 *
 * ADR-0002 ranks GRANT-TIME KEY SUBSTITUTION WITH A SKIPPED OR THEATRICAL
 * CEREMONY as the attack that breaks the whole design. So:
 *
 *  - {@link runShareCeremony} refuses before ANY side effect when the typed
 *    fingerprint does not match the key actually received. No pin is written,
 *    no wrap is produced, no request is sent.
 *  - There is no confirm-what-you-see path anywhere above it. The value is
 *    TYPED, and a mismatch physically cannot proceed.
 *  - A pinned peer offering a DIFFERENT key is `key-changed` — never
 *    auto-accepted, never silently re-pinned. Rotation and substitution are
 *    indistinguishable, and correctly so: both need a new ceremony.
 *
 * ── The second rule: a missing pin is never a verified one ────────────────
 *
 * The owner-private compartment merges whole at one Lamport stamp, so two
 * devices pinning different peers concurrently means one compartment wins and
 * the other's new pin is lost. That is accepted (a ceremony happens with both
 * people in one room, and repeating it is cheap) — but it makes
 * {@link describeGrants} load-bearing: a grant whose peer is not pinned ON
 * THIS DEVICE reports `unpinned`, with NO fingerprint to display, and every
 * re-wrap path skips it. A silently absent pin is how someone shares to an
 * unverified key believing they verified it.
 *
 * ── The fingerprint shown is always computed here ─────────────────────────
 *
 * From key bytes this device holds, never from `recipientKeyFingerprint` —
 * that string is the SERVER's copy of pinning metadata, and rendering it would
 * be the attacker reading you its own key (ADR-0002 prohibition 6). The
 * server's string is only ever COMPARED, and a difference voids the row.
 */
import type { LocalSharePeer } from '#app/lib/local-store';
import type { ReceivedShare, ShareGrant, SyncHttpClient } from './engine/client/http-client';
import type { RotateDekShareWire } from './engine/protocol';
import { base64ToBytes, bytesToBase64 } from './engine/crypto/base64';
import {
  shareFingerprintDisplay,
  shareFingerprintMatchesTyped,
  shareKeyFingerprint,
  unwrapDekAsRecipient,
  wrapDekForRecipient,
} from './engine/crypto/share-wrap';
import { decryptWithSchemaProbe } from './orchestrator';
import { parseRemoteSnapshot } from './local-store-bridge';
import type { ShareableSnapshot } from './snapshot-partition';

/** What the grantor's side of this module is allowed to touch. Narrowed from the client so nothing here can reach a key record. */
export type GrantorShareTransport = Pick<SyncHttpClient, 'listShares' | 'putShare' | 'deleteShare'>;

/** What the grantee's side is allowed to touch. READ ONLY against the grantor, by construction (ADR-0002 prohibition 4). */
export type GranteeShareTransport = Pick<SyncHttpClient, 'listSharedWithMe' | 'pullSharedBlob' | 'deleteSharedWithMe'>;

/** A peer's key as it arrived — from an invite, a QR code, anywhere. UNVERIFIED until a ceremony says otherwise. */
export interface OfferedShareKey {
  accountId: number;
  publicKeyRaw: Uint8Array;
  /** The person's own label for this peer ("Dr. Meier"). Local only; the server never sees it. */
  label: string | null;
}

/**
 * Everything {@link runShareCeremony} needs. `pinPeer` is injected rather than
 * imported so the ceremony's refusals can be asserted by a test that has no
 * device store — and so that "was a pin written?" is answerable by looking at
 * one call.
 */
export interface ShareCeremonyInput {
  transport: GrantorShareTransport;
  /** The account's data key. Wrapped to the recipient, never sent anywhere else. */
  dek: Uint8Array;
  grantorAccountId: number;
  offered: OfferedShareKey;
  /** What the patient TYPED after the clinician read it aloud. */
  typedFingerprint: string;
  pinnedPeers: readonly LocalSharePeer[];
  pinPeer: (peer: LocalSharePeer) => Promise<void>;
  /**
   * Set only when the person has been shown that this peer's key CHANGED and
   * has re-run the ceremony against the new one. It never skips the typed
   * check — it acknowledges that the old pin is being replaced.
   */
  acceptsKeyChange?: boolean;
  now?: number;
}

/** Every way a ceremony can end. Only `granted` writes anything anywhere. */
export type ShareCeremonyResult =
  /** The typed value is not this key's fingerprint. Nothing was pinned, wrapped or sent. */
  | { status: 'fingerprint-mismatch' }
  /** This peer is pinned to a DIFFERENT key. Rotation or substitution — indistinguishable, so both need a fresh, explicit ceremony. */
  | { status: 'key-changed'; pinnedFingerprintDisplay: string; offeredFingerprintDisplay: string }
  /** This deployment has no sharing at all. Nothing was pinned. */
  | { status: 'unavailable' }
  /** No such account on this server — or, on a dark deployment, the same 404. */
  | { status: 'unknown-grantee' }
  /** Another device wrote this share row first. The pin stands; retry the grant. */
  | { status: 'conflict' }
  | { status: 'granted'; grant: ShareGrant; fingerprintDisplay: string };

/**
 * The whole grant: verify what was typed, pin the key, wrap the DEK to it,
 * write the row.
 *
 * THE GUARDS COME FIRST AND RETURN BEFORE ANY EFFECT. That ordering is the
 * security property, not a style choice — see this module's header.
 */
export async function runShareCeremony(input: ShareCeremonyInput): Promise<ShareCeremonyResult> {
  const fingerprint = await shareKeyFingerprint(input.offered.publicKeyRaw);
  if (!shareFingerprintMatchesTyped({ typed: input.typedFingerprint, fingerprint })) {
    return { status: 'fingerprint-mismatch' };
  }

  const pinned = findPinnedPeer({ peers: input.pinnedPeers, accountId: input.offered.accountId });
  const pinnedKey = pinned === null ? null : base64ToBytes(pinned.publicKeyRaw);
  if (pinnedKey !== null && !bytesEqual(pinnedKey, input.offered.publicKeyRaw) && input.acceptsKeyChange !== true) {
    return {
      status: 'key-changed',
      pinnedFingerprintDisplay: shareFingerprintDisplay(await shareKeyFingerprint(pinnedKey)),
      offeredFingerprintDisplay: shareFingerprintDisplay(fingerprint),
    };
  }

  // Read the existing row FIRST, for its CAS token: a re-grant can race a
  // rotation's re-wrap, and a blind write would clobber whichever landed last.
  const existing = await input.transport.listShares();
  if (existing.status === 'unavailable') return { status: 'unavailable' };
  const previous = existing.value.find((grant) => grant.granteeAccountId === input.offered.accountId) ?? null;

  // Pinned BEFORE the request, deliberately. A pin with no share row is a
  // retry away from a grant; a share row with no pin would be a capability
  // this device cannot describe, and the next rotation would silently drop it.
  await input.pinPeer({
    id: String(input.offered.accountId),
    accountId: input.offered.accountId,
    publicKeyRaw: bytesToBase64(input.offered.publicKeyRaw),
    label: input.offered.label,
    createdAt: input.now ?? Date.now(),
  });

  const result = await input.transport.putShare({
    granteeAccountId: input.offered.accountId,
    wrappedDek: await wrapDekForRecipient({
      dek: input.dek,
      recipientPublicKeyRaw: input.offered.publicKeyRaw,
      grantorAccountId: input.grantorAccountId,
    }),
    recipientKeyFingerprint: fingerprint,
    expectedUpdatedAt: previous?.updatedAt ?? null,
  });

  if (result.status === 'not-found') return { status: 'unknown-grantee' };
  if (result.status === 'conflict') return { status: 'conflict' };
  return { status: 'granted', grant: result.grant, fingerprintDisplay: shareFingerprintDisplay(fingerprint) };
}

/** How a grant stands on THIS device. There is no fourth value, and `verified` is only ever reached by a local key comparison. */
export type ShareGrantStatus = 'verified' | 'unpinned' | 'key-changed';

/** One row of the patient's sharing list, ready to render. */
export interface ShareGrantView {
  granteeAccountId: number;
  /** The label this device recorded during the ceremony, or `null` when nothing is pinned here. */
  label: string | null;
  status: ShareGrantStatus;
  /**
   * The 60-bit display of the PINNED key, computed here from key bytes.
   * `null` whenever nothing is pinned — an unpinned peer has no fingerprint to
   * show, and showing the server's string instead is exactly the substitution
   * this design refuses.
   */
  pinnedFingerprintDisplay: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Classifies every grant the server holds against what this device has pinned.
 *
 * ABSENT MEANS UNVERIFIED, never verified-by-default. A grant with no local
 * pin is `unpinned`: the share is live and the clinician can read, but THIS
 * device cannot vouch for the key it was made to, so the UI must say so and
 * offer the ceremony again.
 */
export async function describeGrants({
  grants,
  pinnedPeers,
}: {
  grants: readonly ShareGrant[];
  pinnedPeers: readonly LocalSharePeer[];
}): Promise<ShareGrantView[]> {
  const views: ShareGrantView[] = [];
  for (const grant of grants) {
    const pinned = findPinnedPeer({ peers: pinnedPeers, accountId: grant.granteeAccountId });
    if (pinned === null) {
      views.push({
        granteeAccountId: grant.granteeAccountId,
        label: null,
        status: 'unpinned',
        pinnedFingerprintDisplay: null,
        createdAt: grant.createdAt,
        updatedAt: grant.updatedAt,
      });
      continue;
    }
    const fingerprint = await shareKeyFingerprint(base64ToBytes(pinned.publicKeyRaw));
    views.push({
      granteeAccountId: grant.granteeAccountId,
      label: pinned.label,
      status: fingerprint === grant.recipientKeyFingerprint ? 'verified' : 'key-changed',
      pinnedFingerprintDisplay: shareFingerprintDisplay(fingerprint),
      createdAt: grant.createdAt,
      updatedAt: grant.updatedAt,
    });
  }
  return views;
}

/** A share a rotation can re-wrap, because its key is pinned here and still matches the row. */
export interface RotationKeep {
  granteeAccountId: number;
  publicKeyRaw: Uint8Array;
  recipientKeyFingerprint: string;
  label: string | null;
}

/** A share a rotation CANNOT re-wrap, and therefore revokes. Shown before the rotation runs, never after. */
export interface RotationDrop {
  granteeAccountId: number;
  reason: Exclude<ShareGrantStatus, 'verified'>;
}

/**
 * Splits the server's grants into "can be carried across a rotation" and
 * "cannot".
 *
 * A rotation's keep list is the ONLY thing that survives it, so anything this
 * device cannot re-wrap — an unpinned peer, or a pinned key that no longer
 * matches the row — is revoked by the rotation. That is the correct direction
 * (silence is revocation, ADR-0002 Tier 2) and it is why the UI must show this
 * plan BEFORE the person confirms: a lost pin costs a repeated ceremony, and
 * they should learn that from a screen rather than from their dietician.
 */
export async function planRotationRewraps({
  grants,
  pinnedPeers,
}: {
  grants: readonly ShareGrant[];
  pinnedPeers: readonly LocalSharePeer[];
}): Promise<{ keep: RotationKeep[]; drop: RotationDrop[] }> {
  const keep: RotationKeep[] = [];
  const drop: RotationDrop[] = [];
  for (const view of await describeGrants({ grants, pinnedPeers })) {
    const pinned = findPinnedPeer({ peers: pinnedPeers, accountId: view.granteeAccountId });
    if (pinned === null) {
      drop.push({ granteeAccountId: view.granteeAccountId, reason: 'unpinned' });
      continue;
    }
    if (view.status !== 'verified') {
      drop.push({ granteeAccountId: view.granteeAccountId, reason: 'key-changed' });
      continue;
    }
    const publicKeyRaw = base64ToBytes(pinned.publicKeyRaw);
    keep.push({
      granteeAccountId: view.granteeAccountId,
      publicKeyRaw,
      recipientKeyFingerprint: await shareKeyFingerprint(publicKeyRaw),
      label: pinned.label,
    });
  }
  return { keep, drop };
}

/** Re-wraps a NEW dek to every kept share, producing §5.17's keep list. Each wrap is fresh — a rotation reuses nothing. */
export async function buildRotationKeepList({
  keep,
  dek,
  grantorAccountId,
}: {
  keep: readonly RotationKeep[];
  dek: Uint8Array;
  grantorAccountId: number;
}): Promise<RotateDekShareWire[]> {
  const wires: RotateDekShareWire[] = [];
  for (const entry of keep) {
    wires.push({
      granteeAccountId: entry.granteeAccountId,
      wrappedDek: bytesToBase64(
        await wrapDekForRecipient({ dek, recipientPublicKeyRaw: entry.publicKeyRaw, grantorAccountId }),
      ),
      recipientKeyFingerprint: entry.recipientKeyFingerprint,
    });
  }
  return wires;
}

// ---------------------------------------------------------------------------
// The grantee's read — on her device, never on a server
// ---------------------------------------------------------------------------

/** This device's own share key pair, as the grantee side needs it. Both halves are raw bytes here. */
export interface ShareIdentityKeys {
  publicKeyRaw: Uint8Array;
  privateKeyPkcs8: Uint8Array;
}

/** A patient's diary as a grantee sees it: the shareable region, and nothing else. No key records, no compartment, no history. */
export interface SharedDiary {
  grantorAccountId: number;
  blobVersion: number;
  /** When the grantor's current blob was written. The only freshness signal a grantee gets. */
  createdAt: string;
  snapshot: ShareableSnapshot;
}

/** Every way opening a shared diary can end. */
export type OpenSharedDiaryResult =
  /**
   * No blob was served. Revoked, never pushed, or a deployment with sharing
   * off — the service answers ONE 404 for all three, so this client must not
   * invent a distinction it cannot make.
   */
  | { status: 'unavailable' }
  /** The wrap or the blob would not open with this device's key. Never silently blank — a clinician must know she is seeing nothing. */
  | { status: 'undecryptable'; message: string }
  | { status: 'opened'; diary: SharedDiary };

/**
 * Opens one patient's diary ON THIS DEVICE.
 *
 * The decryption happens here and only here: the share wrap is opened with the
 * grantee's private key, and the blob with the DEK that comes out of it. No
 * server sees either, which is why the clinician's screens have no loader
 * (`app/routes/settings.data.tsx`'s rule — the diary lives on the device — has
 * to hold for somebody else's diary too, or it was never a rule).
 *
 * THE SCHEMA VERSION IS PROBED, not assumed. §3.4's AAD binds
 * `payloadSchemaVersion` and a grantee cannot know the grantor's: the patient
 * may be running an older build. {@link decryptWithSchemaProbe} walks it down
 * from this build's current value, which is the same walk an owner's own pull
 * does.
 */
export async function openSharedDiary({
  transport,
  share,
  identity,
}: {
  transport: GranteeShareTransport;
  share: ReceivedShare;
  identity: ShareIdentityKeys;
}): Promise<OpenSharedDiaryResult> {
  const blob = await transport.pullSharedBlob(share.grantorAccountId);
  if (blob === null) return { status: 'unavailable' };

  let dek: Uint8Array;
  try {
    dek = await unwrapDekAsRecipient({
      wrap: share.wrappedDek,
      privateKeyPkcs8: identity.privateKeyPkcs8,
      grantorAccountId: share.grantorAccountId,
      ownPublicKeyRaw: identity.publicKeyRaw,
    });
  } catch {
    return {
      status: 'undecryptable',
      message: 'This share was not addressed to the key on this device. Ask for a new invitation.',
    };
  }

  try {
    const decrypted = await decryptWithSchemaProbe({
      ciphertext: blob.ciphertext,
      envelopeVersion: blob.envelopeVersion,
      blobVersion: blob.blobVersion,
      accountId: blob.grantorAccountId,
      dek,
    });
    return {
      status: 'opened',
      diary: {
        grantorAccountId: blob.grantorAccountId,
        blobVersion: blob.blobVersion,
        createdAt: blob.createdAt,
        snapshot: toShareableSnapshot(
          parseRemoteSnapshot({ snapshot: decrypted.payload.snapshot, schemaVersion: decrypted.schemaVersion }),
        ),
      },
    };
  } catch {
    return {
      status: 'undecryptable',
      message: 'This diary could not be read on this device. It may have been written by a newer version of openplate.',
    };
  } finally {
    // The patient's DEK exists for this call and no longer. Best-effort
    // hygiene, exactly as `closeSyncSession` does it for the owner's own key.
    dek.fill(0);
  }
}

/**
 * Narrows a parsed remote snapshot to the shareable region, NAME BY NAME.
 *
 * A spread would carry the sealed compartment into a value the clinician's
 * screens render — opaque ciphertext she cannot open, but material that has no
 * business travelling any further than the parse that produced it.
 */
function toShareableSnapshot(parsed: ShareableSnapshot): ShareableSnapshot {
  const { foods, foodLogs, weightEntries, profile, fasts, savedMeals } = parsed;
  return { foods, foodLogs, weightEntries, profile, fasts, savedMeals };
}

function findPinnedPeer({
  peers,
  accountId,
}: {
  peers: readonly LocalSharePeer[];
  accountId: number;
}): LocalSharePeer | null {
  return peers.find((peer) => peer.accountId === accountId) ?? null;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  return left.every((byte, index) => byte === right[index]);
}
