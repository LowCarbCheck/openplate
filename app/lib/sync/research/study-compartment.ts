/**
 * THE STUDY ACCOUNT'S OWN COMPARTMENT — the same construction as
 * `private-store.ts`, over a different plaintext.
 *
 * `openplate-sync` ADR-0003: "the private key lives in the study account's own
 * owner-private compartment". The CRYPTO is shared with the diary's
 * (`engine/crypto/private-store.ts`: one CDK, wrapped under `K_pp` and `K_pr`,
 * AAD-bound to the account id) — a second wrap format is how the packed-IV
 * convention drifts, and there is no reason for one here.
 *
 * What is NOT shared is the plaintext shape. The diary compartment holds
 * {@link import('../snapshot-partition').OwnerPrivateRegion}; this one holds
 * {@link StudyPrivateRegion}. Keeping them apart is what stops a study
 * identity from becoming a key on `LocalStoreSnapshot` — see
 * `study-keyring.ts`'s header.
 *
 * ── A compartment this console cannot open is CARRIED, never dropped ─────
 *
 * The same M164/01 rule the diary's compartment carries, for the same reason:
 * the seal is the hop that writes, and a `null` from it would replace a
 * study's whole keyring with an empty one. So the session records the bytes it
 * PULLED and the seal re-emits them verbatim. `pushStudyBlob`'s throw stays —
 * it is the second line, not a substitute for having something true to emit.
 *
 * ── A key this build does not know is CARRIED too (M164/03) ─────────────
 *
 * `studyPrivateRegionSchema` strips what it does not list, exactly as the
 * diary's does, so the same preservation applies: the session remembers the
 * leftover keys from the last successful open and the seal puts them back
 * through `compartment-kind.ts`. A console one release behind must not delete
 * the field the newer one added.
 *
 * ── No seal cache, because there is no periodic push ─────────────────────
 *
 * `private-store.ts` caches the sealed bytes so an unchanged compartment does
 * not burn a blob version on every boot. The console has no boot-time sync at
 * all: it pushes exactly once, when a researcher mints a generation. A cache
 * here would guard against a write that never happens.
 */
import { base64ToBytes, bytesToBase64 } from '../engine/crypto/base64';
import { openPrivateStore, sealPrivateStore, unwrapCdk } from '../engine/crypto/private-store';
import {
  COMPARTMENT_KIND,
  parseCompartmentPlaintext,
  taggedCompartmentPlaintext,
  WrongCompartmentKindError,
  type CompartmentExtras,
  type ParsedCompartment,
} from '../compartment-kind';
import type { SealedPrivateStore } from '../snapshot-partition';
import { studyPrivateRegionSchema, type StudyPrivateRegion } from './study-keyring';

/**
 * A study console's live compartment state.
 *
 * Mirrors `PrivateStoreSession` and is deliberately a DIFFERENT type: the two
 * are never interchangeable, and a function that accepted either could seal a
 * diary region into a study blob or the reverse.
 */
export interface StudyCompartmentSession {
  /** Binds the compartment's AAD. A compartment spliced in from another account fails the tag check. */
  accountId: number;
  /** `K_pp` for the passphrase that opened this console. */
  passphraseKek: CryptoKey;
  /** The compartment data key, once known. `null` before the first successful open or establish. */
  cdk: Uint8Array | null;
  /** The two wraps exactly as they must be re-emitted — never rebuilt, because slot 2's KEK is not in this session. */
  wraps: { cdkWrapPassphrase: string; cdkWrapRecovery: string } | null;
  /**
   * The compartment keys THIS BUILD DOES NOT RECOGNISE, as the last successful
   * open found them — a field a newer console added, carried verbatim
   * (M164/03). `{}` until an open says otherwise.
   *
   * Opaque: never inspected, never validated, never merged. The only thing this
   * build knows about an extra is that somebody else understands it.
   */
  extras: CompartmentExtras;
  /**
   * The compartment EXACTLY AS LAST PULLED, written on every pull that carried
   * one — whether or not this console could open it. `null` means no pull has
   * carried one, which is the fresh study account and the only state that may
   * seal to `null`.
   *
   * There is no seal cache beside it to confuse this with, for the reason this
   * module's header gives; the diary's twin says which is which.
   */
  pulled: SealedPrivateStore | null;
}

/**
 * Seals the study region for a push.
 *
 * WITHOUT A CDK IT RE-EMITS THE PULLED BYTES, unchanged — this console could
 * not open the compartment, so it holds no key to seal with, and a rebuilt
 * one would carry a recovery slot under a KEK it does not have.
 *
 * Returns `null` ONLY when no pull carried a compartment — the same degraded
 * but safe state `sealOwnerPrivateRegion` describes: the key material stays in
 * memory rather than being published in the clear.
 */
export async function sealStudyRegion({
  session,
  region,
}: {
  session: StudyCompartmentSession;
  region: StudyPrivateRegion;
}): Promise<SealedPrivateStore | null> {
  const { cdk, wraps, extras } = session;
  if (cdk === null || wraps === null) return session.pulled;

  const ciphertext = await sealPrivateStore({
    cdk,
    // TAGGED as a study compartment, so a diary client that pulls it refuses
    // instead of reading it as an empty owner-private region — and carrying
    // the EXTRAS, so a console one release behind does not delete the field a
    // newer one added.
    plaintext: taggedCompartmentPlaintext({ region, kind: COMPARTMENT_KIND.study, extras }),
    accountId: session.accountId,
  });
  return { ciphertext: bytesToBase64(ciphertext), ...wraps };
}

/**
 * Opens a pulled study compartment, adopting its CDK into the session.
 *
 * `null` for every failure, and the caller keeps what it already had — the
 * states this covers ("a compartment written under a passphrase this session
 * does not hold", "no compartment yet") are all "we learned nothing", and a
 * GCM tag check does not say which. What must NOT follow a `null` is a push
 * that RESEALS: that would overwrite a study's whole keyring with an empty
 * one. The bytes are recorded on the session either way, so the seal has the
 * pulled compartment to re-emit instead.
 *
 * A DIARY compartment is the exception, and it THROWS (M164/02). `/study` is
 * an open route and a researcher's own diary address signs in perfectly well
 * there, so this is the one failure a console must not absorb. It surfaces at
 * `loadStudyIdentity`, which runs at sign-in and pushes nothing — the refusal
 * lands before any write, not after one.
 */
export async function openStudyRegion({
  session,
  sealed,
}: {
  session: StudyCompartmentSession;
  sealed: SealedPrivateStore | null;
}): Promise<StudyPrivateRegion | null> {
  // A pull carrying no compartment leaves the record alone — an absence on the
  // server is not evidence that this console's memory of the bytes is wrong.
  if (sealed === null) return null;
  // Recorded BEFORE the attempt, and for the failure as much as the success.
  session.pulled = sealed;

  for (const cdk of await candidateCdks({ session, sealed })) {
    const opened = await tryOpen({ cdk, sealed, accountId: session.accountId });
    if (opened === null) continue;
    session.cdk = cdk;
    session.wraps = { cdkWrapPassphrase: sealed.cdkWrapPassphrase, cdkWrapRecovery: sealed.cdkWrapRecovery };
    // The keys a newer console added, remembered so the next seal puts them
    // back. Only the region is returned, so they go no further than here.
    session.extras = opened.extras;
    return opened.region;
  }
  return null;
}

/** The session's own CDK first (a compartment it just established), then slot 1 — the second-device and fresh-sign-in case. */
async function candidateCdks({
  session,
  sealed,
}: {
  session: StudyCompartmentSession;
  sealed: SealedPrivateStore;
}): Promise<Uint8Array[]> {
  const candidates = session.cdk === null ? [] : [session.cdk];
  try {
    candidates.push(
      await unwrapCdk({ wrappedCdk: base64ToBytes(sealed.cdkWrapPassphrase), kek: session.passphraseKek }),
    );
  } catch {
    // Slot 1 belongs to a passphrase this session does not hold. Not an error
    // here — the session's own CDK may still open the ciphertext.
  }
  return candidates;
}

/**
 * One decrypt attempt. `null` for every failure, for the reason
 * `private-store.ts`'s twin gives — and a THROW on a diary compartment, for
 * the reason that twin gives too.
 *
 * This is the reachable direction of the hazard: a researcher who typed her
 * own DIARY address into `/study` signs in successfully, because the address
 * and the passphrase are hers. Before M164/02 this line handed her an empty
 * keyring, and the next mint wrote it over her share private key, her
 * pseudonym root and every study she had joined.
 */
async function tryOpen({
  cdk,
  sealed,
  accountId,
}: {
  cdk: Uint8Array;
  sealed: SealedPrivateStore;
  accountId: number;
}): Promise<ParsedCompartment<StudyPrivateRegion> | null> {
  try {
    const plaintext = await openPrivateStore({ cdk, ciphertext: base64ToBytes(sealed.ciphertext), accountId });
    return parseCompartmentPlaintext({
      value: JSON.parse(new TextDecoder().decode(plaintext)),
      expected: COMPARTMENT_KIND.study,
      schema: studyPrivateRegionSchema,
    });
  } catch (cause) {
    if (cause instanceof WrongCompartmentKindError) throw cause;
    return null;
  }
}
