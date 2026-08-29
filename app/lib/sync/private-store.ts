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
 * ── A compartment this session cannot open is CARRIED, never dropped ─────
 *
 * The seal is the hop that WRITES, so it is the hop that can destroy. A
 * session that failed to adopt a pulled compartment holds no CDK, and a seal
 * that answered `null` there made the next push replace live key material
 * with nothing — the exact loss `readSealedPrivateStore` refuses at the read
 * (M164/01). So the session remembers the bytes it PULLED, and the seal
 * re-emits them verbatim. A client that cannot open a compartment goes on
 * carrying it, unchanged, forever; `null` is pushed only when the pull
 * carried none.
 *
 * ── A key this build does not know is CARRIED too (M164/03) ─────────────
 *
 * The same rule one level in. `ownerPrivateRegionSchema` is a `z.object`, so it
 * STRIPS what it does not list — and a field a NEWER client added is one this
 * build cannot list. Without care, an older device opens the compartment, loses
 * that field, and its next push writes the loss back. Two devices on either
 * side of a release is an ordinary state.
 *
 * So the session remembers the leftover keys from the last successful open and
 * the seal puts them back (`compartment-kind.ts`). They never leave the
 * compartment: only the region is returned to the sync cycle, because the
 * snapshot's own fail-closed rule — `classifySnapshotKey` throws on a key
 * nobody has classified — is a different rule and must stay strict.
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
import { ownerPrivateRegionSchema } from '#app/lib/local-store/backup';
import {
  COMPARTMENT_KIND,
  parseCompartmentPlaintext,
  taggedCompartmentPlaintext,
  WrongCompartmentKindError,
  type CompartmentExtras,
  type ParsedCompartment,
} from './compartment-kind';
import type { OwnerPrivateRegion, SealedPrivateStore } from './snapshot-partition';

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
  /** The last sealed compartment and the hash of the plaintext it corresponds to. See this module's header on why it exists. */
  cache: { plaintextHash: string; sealed: SealedPrivateStore } | null;
  /**
   * The compartment keys THIS BUILD DOES NOT RECOGNISE, as the last successful
   * open found them — a field a newer client added, carried verbatim (M164/03).
   *
   * Never inspected, never validated, and never allowed into a snapshot:
   * `recomposeSnapshot` would have to classify it, and `classifySnapshotKey` is
   * right to refuse a key nobody has put on a side of the partition.
   *
   * `null` IS NOT `{}` (M164/06). `{}` is knowledge — an open, or an establish,
   * that found nothing this build cannot name. `null` is ignorance: this
   * session has never seen the plaintext, so it cannot say what is in it. Only
   * one state produces it while a CDK is present, and it is an ordinary one:
   * {@link adoptRewrappedSlots}, which gets its CDK out of a slot without ever
   * decrypting the compartment. {@link sealOwnerPrivateRegion} refuses to write
   * a plaintext from that state.
   */
  extras: CompartmentExtras | null;
  /**
   * The compartment EXACTLY AS LAST PULLED, written on every pull that carried
   * one — whether or not this session could open it.
   *
   * NOT the cache above, which answers a different question. That one is keyed
   * on a region HASH and exists so an unchanged plaintext does not burn a blob
   * version on a fresh IV; it is only ever populated by a session that holds
   * the CDK. This one is the record a session with NO CDK has to seal from,
   * and there is no region to hash for it — the bytes were never opened.
   *
   * `null` means no pull has carried a compartment yet, which is the
   * genuinely compartment-less account and the only state that may seal to
   * `null`.
   */
  pulled: SealedPrivateStore | null;
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
    // AN ESTABLISH IS KNOWLEDGE, A SIGN-IN IS NOT. A session that minted the
    // compartment is the authority on what is inside it — nothing, yet — so
    // `{}` is a true statement there. A sign-in has seen no plaintext at all
    // and must say so, which is what stops a rewrap from turning "I hold a
    // CDK" into "I know what it protects".
    extras: established ? {} : null,
    pulled: null,
  };
}

/**
 * Seals the owner-private region for a push.
 *
 * WITHOUT A CDK IT RE-EMITS THE PULLED BYTES, unchanged. Not re-sealed and not
 * rebuilt from the wraps: this session could not open the compartment, so it
 * has no key to seal with, and a rebuilt {@link SealedPrivateStore} would
 * carry a recovery slot under a KEK that was never in this session. The bytes
 * are opaque, AAD-bound to the account and already the server's own — passing
 * them through costs nothing and preserves everything.
 *
 * Returns `null` ONLY when no pull has carried a compartment — an account
 * created before the partition, whose first device has not yet minted one.
 * That is a DEGRADED but SAFE state: the key material simply stays on this
 * device instead of being published in the clear. Regenerating the recovery
 * code establishes a compartment and ends it (see `sync-actions.ts`).
 *
 * ── RE-EMITTING IS ALSO A DROP, and that must be visible ─────────────────
 *
 * Carrying the pulled bytes means this session's own owner-private changes
 * are NOT published: a share identity generated here is written to the device
 * and never leaves it. That is strictly better than the destruction it
 * replaced (M164/01) — and it is still silent, so it must not be reported as
 * a clean sync.
 *
 * Since M164/02 this case is also NARROWER. "Could not open" used to include
 * "opened fine, but belongs to a study console"; that one now throws at the
 * open and is visible on its own. What is left here is exactly one thing: a
 * compartment under a passphrase this session does not hold. {@link
 * hasUnopenedCompartment} is how `syncNow` says so.
 */
export async function sealOwnerPrivateRegion({
  session,
  region,
}: {
  session: PrivateStoreSession;
  region: OwnerPrivateRegion;
}): Promise<SealedPrivateStore | null> {
  const { cdk, wraps, extras } = session;
  // A SESSION MAY ONLY WRITE A PLAINTEXT IT HAS READ (M164/06).
  //
  // The first two are M164/01's rule: no key, nothing to seal with. The third
  // is the same rule one level in, and it covers a state that has a key and
  // still knows nothing — a CDK adopted from a rewrapped slot
  // ({@link adoptRewrappedSlots}), where the compartment was never decrypted.
  // Sealing from there writes `{ ...{}, kind, ...region }` and silently deletes
  // every key a newer client put in the compartment, with the LOCAL region —
  // which on the fresh device this happens to is empty.
  //
  // Re-emitting is exactly right rather than merely safe: the rewrap left the
  // CIPHERTEXT byte-identical and only moved a door, so `session.pulled` (which
  // the rewrap adopt writes) already carries both the newer client's keys and
  // the new wraps. Nothing is lost by not re-sealing it.
  //
  // The state is also transient, by one cycle at most: this session now holds
  // the CDK, so its next pull opens the compartment on the first candidate and
  // `extras` stops being `null` forever after.
  if (cdk === null || wraps === null || extras === null) return session.pulled;

  const plaintextHash = sealCacheKey({ region, extras });
  if (session.cache !== null && session.cache.plaintextHash === plaintextHash) return session.cache.sealed;

  const ciphertext = await sealPrivateStore({
    cdk,
    // TAGGED, always. An untagged compartment is readable — it defaults to
    // `diary` — but it is the state the sniff exists to cover, and there is no
    // reason to keep writing one.
    //
    // And carrying the EXTRAS, which is the other half of not destroying data:
    // the region is what this build understands, `extras` is what a newer one
    // added, and a seal that wrote only the first would delete the second.
    plaintext: taggedCompartmentPlaintext({ region, kind: COMPARTMENT_KIND.diary, extras }),
    accountId: session.accountId,
  });
  const sealed: SealedPrivateStore = { ciphertext: bytesToBase64(ciphertext), ...wraps };
  session.cache = { plaintextHash, sealed };
  return sealed;
}

/**
 * The cache key: a hash of EVERYTHING the sealed bytes contain, not just the
 * region.
 *
 * The extras are in the ciphertext, so they have to be in the key that says
 * "these bytes are still current" — a key covering only the region would go on
 * answering "unchanged" after they moved, and the cache would re-emit bytes
 * carrying the old ones.
 *
 * Today that window cannot open: `openOwnerPrivateRegion` writes `extras` and
 * `cache` in the same breath, from the same plaintext, so they cannot disagree.
 * That is a fact about two adjacent lines, not a property of the design, and it
 * is not what this cache should rest on — the hash makes the invariant
 * structural instead, at the cost of hashing one more (usually empty) object.
 */
function sealCacheKey({ region, extras }: { region: OwnerPrivateRegion; extras: CompartmentExtras }): string {
  return contentHash({ region, extras });
}

/**
 * Whether this session is carrying a compartment it could not open — the
 * DEGRADED sync {@link sealOwnerPrivateRegion} describes.
 *
 * A predicate rather than a message, because the sentence a person reads is
 * the status surface's business (`sync-actions.ts`) and this module must not
 * grow a second opinion about copy. It answers only the state: a pull carried
 * a compartment, and this session has no key for it.
 *
 * Deliberately NOT the same question as "did the last cycle fail". The cycle
 * succeeded — data moved, the diary is in sync — and what did not happen is
 * that this device's key material was published. Reporting that as a clean
 * sync is how a device ends up looking healthy for a week while its share
 * identity exists nowhere but here.
 */
export function hasUnopenedCompartment(session: PrivateStoreSession): boolean {
  return session.cdk === null && session.pulled !== null;
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
 *
 * The bytes are recorded on the session either way, so the next push re-emits
 * this compartment rather than a `null` — see {@link sealOwnerPrivateRegion}.
 */
export async function openOwnerPrivateRegion({
  session,
  sealed,
}: {
  session: PrivateStoreSession;
  sealed: SealedPrivateStore | null;
}): Promise<OwnerPrivateRegion | null> {
  // A pull that carried NO compartment leaves the record alone rather than
  // clearing it: this device's memory of the account's bytes is not evidence
  // that the account has none, and dropping it here would hand the next push
  // the `null` this whole path exists to prevent.
  if (sealed === null) return null;
  // Recorded BEFORE the attempt, and for the failure as much as the success —
  // the failure is the case that needs it.
  session.pulled = sealed;

  for (const cdk of await candidateCdks({ session, sealed })) {
    const opened = await tryOpen({ cdk, sealed, accountId: session.accountId });
    if (opened === null) continue;
    const { region, extras } = opened;
    session.cdk = cdk;
    session.wraps = { cdkWrapPassphrase: sealed.cdkWrapPassphrase, cdkWrapRecovery: sealed.cdkWrapRecovery };
    // The keys a newer client added, remembered so the next seal can put them
    // back. They stop here: only the region is returned, so nothing above this
    // line can route an extra into a snapshot.
    session.extras = extras;
    // Cache the bytes that were just pulled, so the next push re-emits this
    // compartment VERBATIM instead of re-sealing it under a fresh IV and
    // making every boot write a blob version.
    session.cache = { plaintextHash: sealCacheKey({ region, extras }), sealed };
    return region;
  }
  return null;
}

/**
 * Refuses a PULLED compartment that belongs to the other kind of account —
 * the check that has to happen before this device writes anything (M164/06).
 *
 * ── Why {@link openOwnerPrivateRegion} was not enough ────────────────────
 *
 * It throws the right error in the right place, and the sync cycle calls it
 * from `applySnapshot`, which the orchestrator runs on the line AFTER
 * `pushBlob`. So a person who typed a STUDY address into the diary sign-in
 * pushed this device's whole diary into the study account's blob and only then
 * saw the refusal. A study passphrase is normally held by more than one
 * researcher, which makes that a disclosure and not merely a mess. The console
 * side never had the problem — `loadStudyIdentity` runs at sign-in and pushes
 * nothing — so this is the diary's missing half of ADR-0009.
 *
 * ── The BOUNDARY is the whole design ─────────────────────────────────────
 *
 * Three ordinary states reach this same code and mean nothing is wrong, and a
 * check that fired on any of them would turn an everyday hiccup into a hard
 * sync failure:
 *
 *  - a compartment under a passphrase this session does not hold (another
 *    device changed it moments ago) — no candidate CDK opens it,
 *  - a pre-partition blob with no compartment at all — `sealed` is `null`,
 *  - an account whose first device has not minted one — likewise `null`.
 *
 * All three are "we learned nothing", and this function is silent for every
 * one of them. It refuses exactly when the bytes DECRYPTED and said they
 * belong to the other kind, which is the one case where guessing is the harm.
 *
 * ── It adopts NOTHING, on purpose ────────────────────────────────────────
 *
 * No CDK, no wraps, no extras, not even `pulled`. Being free of side effects is
 * what lets it sit anywhere before the push without changing what the cycle
 * does — the adoption still happens exactly once, where it always did, in
 * {@link openOwnerPrivateRegion}. The cost is one extra GCM open per cycle that
 * pulled a compartment, which is a few hundred microseconds against a network
 * round trip.
 *
 * @throws {WrongCompartmentKindError} and nothing else.
 */
export async function assertOwnerPrivateCompartment({
  session,
  sealed,
}: {
  session: PrivateStoreSession;
  sealed: SealedPrivateStore | null;
}): Promise<void> {
  if (sealed === null) return;
  for (const cdk of await candidateCdks({ session, sealed })) {
    // `tryOpen` rethrows only `WrongCompartmentKindError` and answers `null`
    // for every other failure, so the refusal and the silence below are the
    // same two exits the adopt already uses. A successful open ends the walk:
    // the plaintext read as ours, which is all this was asked.
    if ((await tryOpen({ cdk, sealed, accountId: session.accountId })) !== null) return;
  }
}

/**
 * Replaces the session's wraps after a rewrap landed on the server, and drops
 * the seal cache so the next push carries them.
 *
 * `extras` is deliberately untouched — and on a session that has never opened
 * the compartment that leaves it `null`, which is the point. A rewrap unwraps
 * ONE SLOT; it never decrypts the compartment (`private-store-rewrap.ts` says
 * so, and keeping the plaintext out of that operation is a property worth
 * having). So the CDK arrives here without any knowledge of what it protects,
 * and {@link sealOwnerPrivateRegion} must not write a plaintext from it.
 *
 * ── Why the rewrapped bytes become `pulled` (M164/06) ────────────────────
 *
 * Because they ARE what the account's blob now holds: the rewrap pushed them
 * itself, with the ciphertext byte-identical and only the slots changed. A
 * session that cannot seal has to re-emit something, and re-emitting these
 * publishes the new door while preserving every key inside — the older
 * `session.pulled` would republish the door the rewrap just replaced.
 *
 * ── The Lamport tie, stated rather than relied on ────────────────────────
 *
 * Until this change the loss was masked by ordering: the rewrap bumps the
 * compartment entity to `previous + 1`, so the remote copy normally outranks a
 * fresh device's own stamp of `1` and the merge brings the extras back. That
 * is an accident, not an invariant, and it is NOT safe in the tie case — a blob
 * carrying a compartment with no `perEntity` stamp for it makes the rewrap's
 * bump `1` too, against the same device id, and a tie is decided by neither
 * copy being newer. With the seal refusing, the tie stops mattering for the
 * reason a tie should: both candidates carry the same ciphertext, so whichever
 * one wins is the same bytes.
 */
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
  session.pulled = sealed;
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

/**
 * One decrypt attempt. `null` for every failure — a GCM tag check does not say
 * why it failed, and this must not pretend to know.
 *
 * THE ONE EXCEPTION IS A WRONG KIND, and it is not an exception to the reason
 * above so much as the point where that reason stops applying: the bytes have
 * decrypted, so this side is holding plaintext and can read what it is. A
 * `null` there would report "we learned nothing" about the single case where
 * it learned exactly what it is holding — and the caller's `null` path ends in
 * a compartment carried forever with a share identity that never publishes.
 * See `compartment-kind.ts` (M164/02).
 */
async function tryOpen({
  cdk,
  sealed,
  accountId,
}: {
  cdk: Uint8Array;
  sealed: SealedPrivateStore;
  accountId: number;
}): Promise<ParsedCompartment<OwnerPrivateRegion> | null> {
  try {
    const plaintext = await openPrivateStore({ cdk, ciphertext: base64ToBytes(sealed.ciphertext), accountId });
    return parseCompartmentPlaintext({
      value: JSON.parse(new TextDecoder().decode(plaintext)),
      expected: COMPARTMENT_KIND.diary,
      schema: ownerPrivateRegionSchema,
    });
  } catch (cause) {
    if (cause instanceof WrongCompartmentKindError) throw cause;
    return null;
  }
}
