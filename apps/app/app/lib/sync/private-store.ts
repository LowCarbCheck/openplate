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
import { contentHash, isTableTrusted, type LocalStoreIntegrity } from './snapshot-sync';
import {
  RESEARCH_IDENTITY_TABLE,
  SHARE_IDENTITY_TABLE,
  SHARE_PEERS_TABLE,
  STUDY_ENROLMENTS_TABLE,
} from '#app/lib/local-store/schema';
import { ownerPrivateRegionSchema } from '#app/lib/local-store/backup';
import {
  COMPARTMENT_KIND,
  parseCompartmentPlaintext,
  taggedCompartmentPlaintext,
  WrongCompartmentKindError,
  type CompartmentExtras,
  type ParsedCompartment,
} from './compartment-kind';
import {
  EMPTY_OWNER_PRIVATE_REGION,
  ownerPrivateRegionKeys,
  type OwnerPrivateRegion,
  type SealedPrivateStore,
} from './snapshot-partition';

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
   * THE PLAINTEXT THIS SESSION LAST READ OR WROTE, and the only thing that can
   * say a compartment SHRANK (M226).
   *
   * Written by {@link openOwnerPrivateRegion} on a successful open, by
   * {@link adoptEstablishedCompartment} (a compartment nobody has put anything
   * in yet, so the empty region), and by every seal that actually writes.
   * `null` is a session that has never held the plaintext, which is where
   * {@link adoptRewrappedSlots} leaves one.
   *
   * The seal compares it against the region it is handed. A key that was in
   * here and is not in the new one is a ROW THIS DEVICE STOPPED HAVING, and
   * the compartment is pushed whole, so writing it would publish the loss. It
   * is legitimate exactly when the delete journal names the key.
   */
  region: OwnerPrivateRegion | null;
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
  /**
   * Has a pull COMPLETED in this session, whatever it carried?
   *
   * The field that tells "this account has no compartment" apart from "I have
   * not looked yet" (M224). {@link PrivateStoreSession.pulled} cannot: it is
   * `null` for both, and the sync cycle reads the snapshot BEFORE it pulls, so
   * on the first cycle of every resumed session it is `null` for the second
   * reason while looking exactly like the first.
   *
   * Written by {@link openOwnerPrivateRegion}, which the apply path runs on
   * every cycle including the ones that pulled nothing.
   */
  hasPulled: boolean;
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
  // A SIGN-IN, WHICH HAS SEEN NO PLAINTEXT AT ALL AND MUST SAY SO. That is
  // what stops a rewrap from turning "I hold a CDK" into "I know what it
  // protects" — see {@link PrivateStoreSession.extras}.
  const session: PrivateStoreSession = {
    accountId,
    passphraseKek,
    cdk: null,
    wraps: null,
    cache: null,
    extras: null,
    region: null,
    pulled: null,
    hasPulled: false,
  };
  // AN ESTABLISH IS KNOWLEDGE, and it is stated by ONE function rather than by
  // each site that mints a compartment (M164/08). The establish branch in
  // `sync-actions.ts` wrote `cdk`, `wraps` and `cache` by hand and simply
  // never made this statement, so the seal declined and a freshly minted
  // compartment was never published.
  if (established !== undefined && established !== null) adoptEstablishedCompartment({ session, established });
  return session;
}

/**
 * Takes a compartment this session JUST MINTED — the CDK, both doors, and the
 * knowledge that comes with having made it.
 *
 * ── Why `extras` is `{}` here, and why that is not a shortcut ────────────
 *
 * `extras` answers "what is in this compartment that this build cannot name?"
 * and the session that created the compartment is the authority on it: the
 * answer is nothing, because nothing is in it yet. That is a TRUE statement,
 * not an assumption — unlike {@link adoptRewrappedSlots}, which acquires a CDK
 * for a compartment somebody else wrote and therefore has to admit ignorance.
 *
 * ── Why this is a function and not three assignments ─────────────────────
 *
 * Because it was three assignments (M164/08). `rotateCompartmentRecoverySlot`
 * mints a compartment for an account whose data predates the partition, set
 * `cdk`/`wraps`/`cache`, and left `extras` at `null` — so
 * {@link sealOwnerPrivateRegion} refused, re-emitted `session.pulled`, and
 * `pulled` on such an account is `null`. The compartment the user was shown a
 * recovery code for never reached the service, and never would: with nothing
 * pushed there is nothing for a later pull to open, so the state does not
 * clear. Every acquisition of a CDK has to answer the same question — does
 * this session know the plaintext? — and there are now exactly two places that
 * can, both of them here.
 */
export function adoptEstablishedCompartment({
  session,
  established,
}: {
  session: PrivateStoreSession;
  established: EstablishedPrivateStore;
}): void {
  session.cdk = established.cdk;
  session.wraps = {
    cdkWrapPassphrase: established.cdkWrapPassphrase,
    cdkWrapRecovery: established.cdkWrapRecovery,
  };
  // A fresh compartment has no sealed bytes yet, and the cache is keyed on a
  // plaintext hash — anything left here would belong to a different one.
  session.cache = null;
  session.extras = {};
  // AND THE PLAINTEXT IS KNOWN TO BE EMPTY, which is a statement rather than a
  // default, exactly as `extras` above is. This session made the compartment,
  // so it can say what is in it: nothing yet. Leaving `region` at `null` would
  // make the first seal after an establish unable to say whether the region it
  // is handed grew or shrank, and the safe answer to that question is to hold.
  session.region = EMPTY_OWNER_PRIVATE_REGION;
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
 * Answers `unknown` when no pull has carried a compartment INTO THIS SESSION,
 * which covers both an account created before the partition whose first
 * device has not yet minted one, and, far more commonly, a session that simply
 * has not pulled yet. That is a DEGRADED but SAFE state: the key material
 * stays on this device instead of being published in the clear. Regenerating
 * the recovery code establishes a compartment and ends it (see
 * `sync-actions.ts`).
 *
 * It narrows to `absent` only once a pull has actually COMPLETED and carried
 * nothing ({@link PrivateStoreSession.hasPulled}). Before that this function
 * holds one session's memory and not the account's history, and saying
 * "absent" from there is precisely the claim that cost a production account
 * its compartment.
 *
 * ── RE-EMITTING IS ALSO A DROP, and that must be visible ─────────────────
 *
 * Carrying the pulled bytes means this session's own owner-private changes
 * are NOT published: a share identity generated here is written to the device
 * and never leaves it. That is strictly better than the destruction it
 * replaced (M164/01) — and it is still silent, so it must not be reported as
 * a clean sync.
 *
 * Since M164/02 this case is NARROWER by one. "Could not open" used to include
 * "opened fine, but belongs to a study console"; that one now throws at the
 * open and is visible on its own. What is left is still THREE states, not one
 * (M164/07): a compartment under a passphrase this session does not hold, a
 * ciphertext whose tag check failed, and a plaintext the region schema
 * rejected. A tag check does not say which, so neither does this — {@link
 * hasUnopenedCompartment} answers the state, and `sync-actions.ts` owns the
 * sentence that has to be true of all three.
 */
export type OwnerPrivateSeal =
  /**
   * This session read the compartment (or minted it), and these are the bytes
   * to push.
   *
   * `wrote` SPLITS THIS ANSWER IN TWO, and the split is the whole of M228.
   *
   * `true` means the bytes STAND FOR THE REGION THIS CALL WAS HANDED: either
   * freshly sealed from it, or the cache's bytes for exactly that plaintext,
   * which is the same statement made without burning a blob version on a fresh
   * IV. A removal that is missing from the region is missing from the account's
   * copy too, so the journal row that proves it has been spent.
   *
   * `false` means the bytes are the ACCOUNT'S OWN, re-emitted verbatim because
   * this session could not write a plaintext at all (no CDK, no wraps, or a
   * CDK it has never read with). The compartment is preserved, and NONE of
   * this device's owner-private removals reached the account, so every journal
   * row that records one must survive the cycle.
   *
   * It is a required field rather than a fourth `kind` on purpose. Nothing
   * that reads this union switches on it exhaustively. `sealedCompartmentOrNull`
   * and `sync-actions.ts` both ask `kind === '...'` in a boolean expression,
   * so a new kind would compile at every reader and make the first of them
   * answer `null` for a re-emission, which is precisely the loss M164/01
   * exists to prevent. A required property on `sealed` reddens the only sites
   * that can answer the question, the three that build this value, and leaves
   * every reader both compiling and correct.
   */
  | { kind: 'sealed'; wrote: boolean; value: SealedPrivateStore }
  /**
   * THERE IS NO COMPARTMENT. A pull carried none, which on an account created
   * before the partition is the truth: nobody has minted one yet. A snapshot
   * may carry `null` for it, and an absence of it in the baseline is a real
   * absence.
   */
  | { kind: 'absent' }
  /**
   * THIS SESSION HAS NOT READ IT YET, which is a different sentence entirely
   * and used to be the same `null` as the one above (M224).
   *
   * Every RESUMED session starts here: `performResume` opens the vault with
   * no CDK and no pulled bytes, and the sync cycle reads the snapshot BEFORE
   * it pulls. Conflating the two made `stampSnapshot` read "I have not looked"
   * as "the account has none", mint a tombstone for it, and destroy the
   * account's share key pair and research pseudonym root on the server. It was
   * silent: a device that already held the keys kept them, and a NEW device
   * simply got none.
   *
   * A snapshot built from this state carries `null` too, because there is
   * nothing else to carry, but the stamping is told so and contributes no
   * candidate for the compartment at all.
   */
  | { kind: 'unknown' }
  /**
   * THE COMPARTMENT SHRANK AND NOBODY WROTE THE REMOVAL DOWN (M226), so these
   * are the bytes the account already holds, re-emitted verbatim.
   *
   * The state it exists for is a LIVE session, holding a CDK, both wraps and
   * the extras, whose store was emptied under it: an eviction, a cleared site,
   * a `t` object store that lost its rows. `partitionSnapshot` then hands the
   * seal an EMPTY region, the seal takes the write branch, the compartment
   * gets a new hash and a higher stamp, and the push replaces the account's
   * share key pair, its pinned peers and its pseudonym root with nothing. No
   * tombstone is involved anywhere in it, so the journal rule that protects
   * every other collection never fires.
   *
   * Byte-identical to `sealed` on the wire, and a different sentence: the
   * device's own changes did NOT publish. `snapshot-sync.ts` is told
   * (`isCompartmentHeld`) so the push cannot claim the shrink was intended
   * and the heal log fires.
   */
  | { kind: 'held'; value: SealedPrivateStore };

/**
 * The store tables the compartment is sealed FROM. All four, including the
 * research identity, which has no delete verb and is therefore the one row
 * here whose absence can only ever be an eviction.
 */
const OWNER_PRIVATE_TABLES = [
  SHARE_IDENTITY_TABLE,
  SHARE_PEERS_TABLE,
  RESEARCH_IDENTITY_TABLE,
  STUDY_ENROLMENTS_TABLE,
] as const;

export async function sealOwnerPrivateRegion({
  session,
  region,
  deletedEntityKeys,
  integrity,
}: {
  session: PrivateStoreSession;
  region: OwnerPrivateRegion;
  /**
   * The delete journal as of the SAME read that produced `region`
   * (`sync-actions.ts`). Required, like `stampSnapshot`'s integrity and for
   * the same reason: a correctness argument with a permissive default is a
   * correctness argument at zero call sites.
   */
  deletedEntityKeys: ReadonlySet<string>;
  /** What that read can prove about the device's storage, the second signal behind the journal. */
  integrity: LocalStoreIntegrity;
}): Promise<OwnerPrivateSeal> {
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
  // THE STATE IS NOT GUARANTEED TO CLEAR, and the sentence that stood here
  // said it was — "transient, by one cycle at most" (M164/08). A pull clears
  // it only when the pull CARRIES a compartment: {@link
  // openOwnerPrivateRegion} returns before touching `extras` when `sealed` is
  // `null`. That is unreachable from a rewrap adopt, which by definition
  // rewrapped something that exists, so this branch does clear on the next
  // pull — but nothing here enforces it, so it is written as what it is: a
  // consequence of where the state can be entered, which is exactly the kind
  // of claim that goes stale when a new entry point is added. It is also why
  // {@link hasUnopenedCompartment} reports the state rather than waiting it
  // out.
  if (cdk === null || wraps === null || extras === null) {
    // THE THREE-VALUED ANSWER (M224). `session.pulled` being `null` here is
    // ignorance, not absence: no pull has carried a compartment INTO THIS
    // SESSION, and this session is the only thing that can say so.
    // `wrote: false`: these are the ACCOUNT'S bytes. This session's own
    // owner-private removals are not in them and did not publish.
    if (session.pulled !== null) return { kind: 'sealed', wrote: false, value: session.pulled };
    return session.hasPulled ? { kind: 'absent' } : { kind: 'unknown' };
  }

  const plaintextHash = sealCacheKey({ region, extras });
  if (session.cache !== null && session.cache.plaintextHash === plaintextHash) {
    // `wrote: true`, even though nothing was encrypted here. The cache is keyed
    // on the hash of THIS region (and extras), so a hit says the bytes already
    // in hand are the bytes this region seals to, so a row that left the region
    // left the account's copy with it. Re-sealing would produce different bytes
    // for the same plaintext and say nothing more.
    return { kind: 'sealed', wrote: true, value: session.cache.sealed };
  }

  // A SESSION MAY WRITE A SMALLER PLAINTEXT THAN THE ONE IT LAST READ ONLY FOR
  // ROWS THIS DEVICE WROTE DOWN (M226). Everything above this line is about a
  // session that cannot read the compartment; this is the one that can, and
  // whose STORE went away underneath it.
  //
  // Only a shrink is weighed. A region that grew, or changed a row in place,
  // is an ordinary write and needs no evidence at all, which is also what
  // keeps a first-ever push working on a device whose database is not primed
  // yet.
  const withdrawn = session.region === null ? [] : ownerPrivateRegionKeys(session.region);
  const stillHere = new Set(ownerPrivateRegionKeys(region));
  const lost = withdrawn.filter((key) => !stillHere.has(key));
  if (lost.length > 0 && !isShrinkProven({ lost, deletedEntityKeys, integrity })) {
    // THE CACHE AND THE REGION ARE LEFT ALONE, deliberately. Both describe the
    // plaintext this session last stood behind, and the bytes returned here
    // are that same plaintext; moving either to the shrunk region would make
    // the NEXT cycle read the loss as the state it last agreed with, and
    // publish it.
    const held = session.cache?.sealed ?? session.pulled;
    return held === null ? { kind: 'unknown' } : { kind: 'held', value: held };
  }

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
  // The plaintext this session now stands behind. The next seal measures its
  // region against THIS one, so a write is what moves the line, never a read
  // of a region that was refused.
  session.region = region;
  return { kind: 'sealed', wrote: true, value: sealed };
}

/**
 * May this device say that these rows were REMOVED, rather than that it cannot
 * see them?
 *
 * The compartment's half of `snapshot-sync.ts`'s tombstone rule, and it weighs
 * the same two signals in the same order. THE JOURNAL IS THE AUTHORITY: a key
 * a delete verb wrote down is a removal somebody performed, in the same
 * transaction and the same database as the row. The disk-versus-memory
 * comparison only REFUSES: a compartment table the device half read is one it
 * cannot speak for, whatever the journal says beside it, and an evicted
 * database answers `false` for every table at once.
 *
 * Every lost key must be proven. A region that lost a pinned peer and a study
 * enrolment, with a journal row for only one of them, is a region this device
 * cannot write: the seal is whole-plaintext, so publishing the proven half
 * publishes the other half with it.
 */
function isShrinkProven({
  lost,
  deletedEntityKeys,
  integrity,
}: {
  lost: readonly string[];
  deletedEntityKeys: ReadonlySet<string>;
  integrity: LocalStoreIntegrity;
}): boolean {
  if (!OWNER_PRIVATE_TABLES.every((table) => isTableTrusted({ table, integrity }))) return false;
  return lost.every((key) => deletedEntityKeys.has(key));
}

/** The sealed bytes a snapshot carries for this answer. `absent` and `unknown` both have none to carry. */
export function sealedCompartmentOrNull(seal: OwnerPrivateSeal): SealedPrivateStore | null {
  // `held` CARRIES BYTES TOO, and they are the ones that must ride in the
  // snapshot: they are what the account already holds, so the push re-emits
  // them, the stamp is carried forward unchanged, and nothing is overwritten.
  // A `null` here would be the very loss the hold exists to prevent.
  return seal.kind === 'sealed' || seal.kind === 'held' ? seal.value : null;
}

/**
 * What the sync cycle has to be told about this seal, both halves at once.
 *
 * TWO FIELDS AND ONE PRODUCER, because they are two different claims with two
 * different consequences and setting one without the other is the defect this
 * exists to prevent (M228). They are derived here, side by side, from the same
 * seal and the same session, so no call site can answer half the question.
 */
export interface CompartmentPublication {
  /**
   * DID THIS CYCLE PUBLISH NONE OF THIS DEVICE'S OWNER-PRIVATE REMOVALS?
   *
   * The condition the delete journal's prune is keyed on: a key may be spent
   * only after a cycle whose seal WROTE this device's region, because only
   * then did the removal it records reach the account.
   *
   * `true` for four answers, and only the last of them used to be counted:
   *
   *  - `unknown`. Nothing was published at all, and this is EVERY BOOT'S FIRST
   *    CYCLE: a resumed session holds no CDK and no pulled bytes, and
   *    `readSyncedSnapshot` seals BEFORE the pull. Forgetting the journal there
   *    lost the un-pin of the tab that closed, and the apply wrote the peer
   *    back from the account's own compartment on the very next cycle.
   *  - a RE-EMITTED `sealed` (`wrote: false`), the account's bytes carried
   *    through by a session with no key, or with a key it has not read with.
   *  - `held`. The seal refused an unproven shrink and re-emitted.
   *  - `absent` while this session stands behind a region that HOLDS ROWS.
   *    Unreachable today, since every path that gives a session a region also
   *    gives it a CDK, and it is stated rather than assumed because that is a
   *    fact about the current entry points and not a property of the type.
   */
  isCompartmentUnpublished: boolean;
  /**
   * DID THE SEAL HOLD AN UNPROVEN SHRINK (M226)?
   *
   * Strictly narrower than the field above, and deliberately so. This one is
   * the device's data going unpublished while the region SAYS it should have
   * gone, a shrink nobody wrote down, and `stampSnapshot` turns it into a
   * withheld `privateStore` entry, which forbids `shrinkAcknowledged` and fires
   * the heal notice. A boot's `unknown` first cycle is neither of those things:
   * nothing shrank, nothing is being restored, and reporting it would put a
   * heal notice on every launch and refuse the first ordinary delete of every
   * session.
   */
  isCompartmentHeld: boolean;
}

/**
 * Reads both claims off one seal.
 *
 * `session` is needed for the `absent` case alone: the seal's answer does not
 * carry the region this session stands behind, and that is the only thing that
 * can say whether an account with no compartment is leaving rows unpublished.
 */
export function describeCompartmentPublication({
  seal,
  session,
}: {
  seal: OwnerPrivateSeal;
  session: PrivateStoreSession;
}): CompartmentPublication {
  const isCompartmentHeld = seal.kind === 'held';
  if (seal.kind === 'sealed') return { isCompartmentUnpublished: !seal.wrote, isCompartmentHeld };
  if (seal.kind === 'absent') {
    const region = session.region;
    return {
      isCompartmentUnpublished: region !== null && ownerPrivateRegionKeys(region).length > 0,
      isCompartmentHeld,
    };
  }
  return { isCompartmentUnpublished: true, isCompartmentHeld };
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
 *
 * ── TWO WAYS TO HOLD A COMPARTMENT UNOPENED, NOT ONE (M164/08) ───────────
 *
 * The question is "did this session read the plaintext?", and a missing CDK is
 * only one of the two answers. {@link adoptRewrappedSlots} leaves a session
 * holding a KEY IT HAS NOT READ WITH — a CDK taken out of a rewrapped slot,
 * with the compartment never decrypted — and the seal re-emits there for the
 * same reason and with the same silent cost. The predicate therefore mirrors
 * the seal's own guard rather than a subset of it; a report that covered only
 * the no-CDK half called the other half a clean sync.
 *
 * `pulled !== null` is the other half of both, and it is what keeps the
 * genuinely compartment-less account out: that one seals to `null` by design
 * (an account whose first device has not minted one), and reporting it would
 * turn a documented degraded state into a permanent warning.
 */
export function hasUnopenedCompartment(session: PrivateStoreSession): boolean {
  return session.pulled !== null && (session.cdk === null || session.extras === null);
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
  // A COMPLETED PULL IS KNOWLEDGE EVEN WHEN IT CARRIED NOTHING (M224), and it
  // is recorded before the early return below for exactly that case: this is
  // the only hop that can narrow the seal's `unknown` to `absent`.
  session.hasPulled = true;
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
    // AND THE PLAINTEXT ITSELF, which is what the next seal measures a shrink
    // against (M226). Written from the same opened compartment as the cache
    // beside it, so the two cannot describe different plaintexts.
    session.region = region;
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
