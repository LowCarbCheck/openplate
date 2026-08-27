/**
 * THE SNAPSHOT PARTITION (`openplate-sync` ADR-0002, "The snapshot is
 * partitioned — amendment, 2026-08-27").
 *
 * The device's snapshot is formally two regions, and this module is the one
 * place that says which key belongs to which:
 *
 *  - **the shareable region** — diary and preferences. This is what a
 *    clinician grant means.
 *  - **the owner-private compartment** — key material and trust pins. This is
 *    what a grant must never mean.
 *
 * A share is full-DEK and the blob is the WHOLE snapshot, so anything left in
 * the shareable region is disclosed to every grantee. Leaving the owner's
 * share PRIVATE key there was a CASCADE rather than a leak: a grantee holding
 * it can open every wrap addressed to that grantor, reaching people who made
 * no trust decision about the recipient.
 *
 * ── The map fails CLOSED, and that is the whole design ────────────────────
 *
 * {@link SNAPSHOT_KEY_REGIONS} classifies EVERY `LocalStoreSnapshot` key, and
 * an unclassified key is an ERROR, never a default to `shared`. Two gates
 * enforce it: `satisfies Record<keyof LocalStoreSnapshot, SnapshotRegion>`
 * fails the typecheck when a key is added and not classified, and
 * {@link classifySnapshotKey} throws at runtime — which is what
 * `tests/unit/snapshot-partition.test.ts` drives from a fully populated
 * fixture built by the REAL snapshot builder.
 *
 * That test replaces a one-time audit, because a point-in-time audit of a
 * moving structure is stale the day the structure moves — and this one proved
 * it inside a single milestone, on the same day: spec 01's gate passed while
 * the snapshot held only diary data, and spec 04 put a private key into it
 * hours later.
 *
 * ── What is LOCAL and what is WIRE ───────────────────────────────────────
 *
 * `LocalStoreSnapshot` is unchanged and still carries both regions in the
 * clear. That is correct: it is the device's own store and its own backup
 * file, and stripping the share key from a backup would leave a restored
 * device unable to open a single patient's wrap. Only the SYNCED shape
 * ({@link SyncedSnapshot}) partitions, because only a blob is ever handed to
 * a second person.
 */
import { z } from 'zod';
import { ownerPrivateRegionSchema } from '#app/lib/local-store/backup';
import type { LocalStoreSnapshot } from '#app/lib/local-store';

/** Which side of the partition a snapshot key sits on. There is no third value and no "unknown" — absent means fail. */
export type SnapshotRegion = 'shared' | 'owner-private';

/**
 * THE CLASSIFICATION MAP — frozen, total, and fail-closed.
 *
 * Adding a key to `LocalStoreSnapshot` without adding it here is a TYPE ERROR
 * (`satisfies`) and a RED TEST (`classifySnapshotKey` throws). Both are
 * deliberate: the decision "may a clinician read this?" is a human one, and
 * the cost of getting it wrong by omission is disclosure.
 *
 * `owner-private` today is ADR-0002's two — the account's own share key pair,
 * and the peer keys pinned by a passed fingerprint ceremony — plus ADR-0003's
 * two. The pinned peer list is the second half of the cascade: it hands every
 * grantee a subset of the care graph that §9.2 only admits the SERVER learns.
 *
 * ADR-0003's two are here for the same shape of reason, one recipient class
 * over. `researchIdentity` holds the PSEUDONYM ROOT, and a grantee who learned
 * it could recompute this person's pseudonym in every study they will ever
 * join — the unlinkability the research design turns on (prohibition 3).
 * `studyEnrolments` is which studies they joined, which is health data even
 * though the keys in it are public.
 */
export const SNAPSHOT_KEY_REGIONS = {
  foods: 'shared',
  foodLogs: 'shared',
  weightEntries: 'shared',
  profile: 'shared',
  fasts: 'shared',
  savedMeals: 'shared',
  shareIdentity: 'owner-private',
  sharePeers: 'owner-private',
  researchIdentity: 'owner-private',
  studyEnrolments: 'owner-private',
} as const satisfies Record<keyof LocalStoreSnapshot, SnapshotRegion>;

/** The snapshot keys the map assigns to `region`. Derived from the map, so the map is what moves a key. */
type KeysInRegion<TRegion extends SnapshotRegion> = {
  [TKey in keyof LocalStoreSnapshot]: (typeof SNAPSHOT_KEY_REGIONS)[TKey] extends TRegion ? TKey : never;
}[keyof LocalStoreSnapshot];

/** The diary-and-preferences half — everything a grant is allowed to mean. */
export type ShareableSnapshot = Pick<LocalStoreSnapshot, KeysInRegion<'shared'>>;

/** The compartment's plaintext — key material and trust pins, never disclosed by a share. */
export type OwnerPrivateRegion = Pick<LocalStoreSnapshot, KeysInRegion<'owner-private'>>;

/** The compartment on a device that has generated no share key and pinned no peer. */
export const EMPTY_OWNER_PRIVATE_REGION: OwnerPrivateRegion = {
  shareIdentity: null,
  sharePeers: [],
  researchIdentity: null,
  studyEnrolments: [],
};

/**
 * The sealed compartment, as it rides inside the snapshot on the wire.
 *
 * Base64 rather than `Uint8Array` for the same reason `LocalShareIdentity`'s
 * halves are: the payload is JSON, and a typed array round-trips through JSON
 * as an object of numeric keys.
 *
 * **This needs no protocol change.** `PROTOCOL.md` §3.2 already declares
 * everything inside `snapshot` opaque to the protocol, so a nested ciphertext
 * field violates nothing.
 */
export interface SealedPrivateStore {
  /** `iv || AES-256-GCM(CDK, plaintext, aad)` — the compartment itself. Opaque to every grantee. */
  ciphertext: string;
  /** Slot 1: the CDK wrapped under `K_pp` (HKDF of the Argon2id hash, `PRIVATE_STORE_KEK`). Rewrapped by a passphrase change. */
  cdkWrapPassphrase: string;
  /** Slot 2: the CDK wrapped under `K_pr` (HKDF of the recovery code, `PRIVATE_STORE_RECOVERY_KEK`). The second, independent door. */
  cdkWrapRecovery: string;
}

/**
 * The snapshot AS SYNCED: the shareable region, plus one opaque compartment.
 *
 * The owner-private keys are structurally absent — not empty, absent — so
 * there is no code path that can populate them on the wire by accident.
 */
export interface SyncedSnapshot extends ShareableSnapshot {
  /** `null` on a device whose compartment has never been established (no share key, or an account created before the partition). */
  privateStore: SealedPrivateStore | null;
}

/** The compartment's own wire shape. Exported so the wire parser and the tests read one definition. */
export const sealedPrivateStoreSchema = z.object({
  ciphertext: z.string(),
  cdkWrapPassphrase: z.string(),
  cdkWrapRecovery: z.string(),
});

/**
 * A pulled payload, seen only as "something that may carry a compartment".
 *
 * `looseObject` because the rest of the snapshot is validated by the BACKUP
 * migration chain (`local-store-bridge.ts`) — this reads the one key that
 * chain knows nothing about, without a second copy of every entity schema.
 */
const privateStoreCarrierSchema = z.looseObject({
  privateStore: sealedPrivateStoreSchema.nullable().default(null),
});

/**
 * Reads the sealed compartment off a raw pulled snapshot.
 *
 * @throws when a compartment is present but malformed. Deliberately not a
 * silent `null`: a `null` would make the next push OVERWRITE the damaged
 * compartment with an empty one, destroying the account's share keys to hide
 * a parse error.
 */
export function readSealedPrivateStore({ snapshot }: { snapshot: unknown }): SealedPrivateStore | null {
  return privateStoreCarrierSchema.parse(snapshot).privateStore;
}

/**
 * Re-emits a pulled snapshot carrying a DIFFERENT sealed compartment, leaving
 * every other key exactly as it arrived.
 *
 * The rewrap path is not a sync cycle and must not decide anything about the
 * diary, so the payload is passed through by spread rather than rebuilt from a
 * shape this build understands — a peer on a newer schema must get its own
 * fields back untouched.
 */
export function replaceSealedPrivateStore({ snapshot, sealed }: { snapshot: unknown; sealed: SealedPrivateStore }) {
  return { ...privateStoreCarrierSchema.parse(snapshot), privateStore: sealed };
}

/**
 * Which region a snapshot key belongs to.
 *
 * @throws when the key is not in {@link SNAPSHOT_KEY_REGIONS}. ABSENT MEANS
 * FAIL, never means shared — a field nobody has classified must stop the sync,
 * not quietly become part of what a clinician can read.
 */
export function classifySnapshotKey(key: string): SnapshotRegion {
  // Entry iteration rather than an index: indexing this frozen map would need
  // it widened to a string dictionary, which throws away the very literal
  // types `KeysInRegion` reads to build the two region types.
  for (const [classified, region] of Object.entries(SNAPSHOT_KEY_REGIONS)) {
    if (classified === key) return region;
  }
  throw new Error(
    `snapshot key "${key}" is not classified in SNAPSHOT_KEY_REGIONS — classify it as 'shared' or 'owner-private' (openplate-sync ADR-0002)`,
  );
}

/** The two halves a snapshot splits into. */
export interface SnapshotPartition {
  shareable: ShareableSnapshot;
  ownerPrivate: OwnerPrivateRegion;
}

/**
 * Splits a device snapshot into its two regions, DRIVEN BY THE MAP.
 *
 * Written as a loop over the snapshot's actual keys rather than a destructure
 * of the ones this build happens to know: a rest-destructure would let a newly
 * added key ride into the shareable half silently, which is the exact failure
 * the map exists to prevent. Here an unknown key throws instead.
 */
export function partitionSnapshot(snapshot: LocalStoreSnapshot): SnapshotPartition {
  // THE FAIL-CLOSED GUARD, and it runs over the snapshot's ACTUAL keys rather
  // than the ones this build knows about. A key nobody has classified stops
  // the sync here, before either region is built — it never becomes part of
  // what a clinician can read by default.
  for (const key of Object.keys(snapshot)) classifySnapshotKey(key);

  const { foods, foodLogs, weightEntries, profile, fasts, savedMeals } = snapshot;
  const { shareIdentity, sharePeers, researchIdentity, studyEnrolments } = snapshot;
  // Written out name by name, and the two literals are the type-level half of
  // the same guard: move a key between regions in the map above, or add one,
  // and these stop compiling until a human has put it on a side.
  return {
    shareable: { foods, foodLogs, weightEntries, profile, fasts, savedMeals },
    ownerPrivate: { shareIdentity, sharePeers, researchIdentity, studyEnrolments },
  };
}

/**
 * Puts the two regions back together into the shape the local store writes.
 *
 * The inverse of {@link partitionSnapshot}, and the only way owner-private
 * material re-enters a full snapshot — so a merged blob cannot reach the
 * device's importer without a compartment having been opened for it.
 *
 * The shared half is destructured NAME BY NAME rather than spread, and that is
 * load-bearing twice over. At the live call site `shareable` is a
 * `SyncedSnapshot`, which also carries the sealed compartment — a spread would
 * copy that ciphertext into the object handed to the local store's importer.
 * And a literal fails the typecheck the moment the map moves a key or gains
 * one, which is the same fail-closed pressure {@link classifySnapshotKey}
 * applies at runtime.
 */
export function recomposeSnapshot({ shareable, ownerPrivate }: SnapshotPartition): LocalStoreSnapshot {
  const { foods, foodLogs, weightEntries, profile, fasts, savedMeals } = shareable;
  return { foods, foodLogs, weightEntries, profile, fasts, savedMeals, ...ownerPrivate };
}

/** Validates a compartment plaintext that has just been decrypted. Throws on anything malformed — a half-understood key pair must not be written. */
export function parseOwnerPrivateRegion({ value }: { value: unknown }): OwnerPrivateRegion {
  return ownerPrivateRegionSchema.parse(value);
}
