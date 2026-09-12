/**
 * The integrity evidence a fixture hands `stampSnapshot`.
 *
 * `SnapshotIntegrity` is a REQUIRED argument on purpose (`snapshot-sync.ts`):
 * an optional one would sit at zero call sites and guard nothing. That makes
 * every fixture in the suite state what its device knows, and these two named
 * constants are how it says so in one word instead of three fields.
 *
 * NOT exported from production. A permissive default that lived beside the
 * function would eventually be reached for by a real caller, and the whole
 * point of the argument is that no caller can avoid the question.
 */
import type { LocalStoreIntegrity, SnapshotIntegrity, SyncBaseline } from '../app/lib/sync/snapshot-sync';

/**
 * A HEALTHY DEVICE: the database is there, every table loaded, the compartment
 * has been read. Tombstones from this device are trusted, which is what makes
 * it the right fixture for every test about ordinary deletes.
 */
export const HEALTHY_STORAGE: SnapshotIntegrity = {
  hasPersistedDatabase: true,
  isTableLoaded: {},
  isCompartmentKnown: true,
  // A HEALTHY DEVICE'S SEAL DOES NOT HOLD (M226/M227). The hold is the seal
  // re-emitting the account's bytes over a region that shrank with nothing
  // written down, which is the evicted device's state, not this one's.
  isCompartmentHeld: false,
  // HEALTHY IS NOT THE SAME AS "HAS DELETED SOMETHING" (M225). A healthy device
  // with an empty delete journal has recorded no deletes, so it mints no
  // tombstones however its snapshot shrank, which is the correct reading of a
  // fixture that simply stopped listing an entity. A test about a DELETE says
  // so with {@link withRecordedDeletes}, exactly as the app says so by writing
  // the journal row in the delete verb's own transaction.
  deletedEntityKeys: new Set(),
};

/** A device whose IndexedDB is GONE while its baseline survived: the eviction this rule exists for. */
export const EVICTED_STORAGE: SnapshotIntegrity = {
  hasPersistedDatabase: false,
  isTableLoaded: {},
  isCompartmentKnown: false,
  // FALSE EVEN HERE, and it is not the same claim as `isCompartmentKnown`.
  // This device has not READ the compartment, so no seal of its has held one;
  // a test about the hold says so by overriding this field.
  isCompartmentHeld: false,
  // An eviction takes the journal with the diary: they are rows in the same
  // database. A fixture that kept deletes here would be describing a device
  // that cannot exist.
  deletedEntityKeys: new Set(),
};

/**
 * The same device, having RECORDED these deletes.
 *
 * `keys` are namespaced entity keys (`entityKey`), the strings the delete
 * journal holds. This is the fixture half of `deleteLocalFoodLog` and its two
 * siblings: dropping an entity from a snapshot is what the person sees, and
 * writing the key down is what licenses telling the account about it.
 */
export function withRecordedDeletes(base: SnapshotIntegrity, keys: readonly string[]): SnapshotIntegrity {
  return { ...base, deletedEntityKeys: new Set(keys) };
}

// ---------------------------------------------------------------------------
// The seal's question: may this compartment be written smaller than the last
// one this session read?
// ---------------------------------------------------------------------------

/**
 * The two arguments `sealOwnerPrivateRegion` weighs before it writes a region
 * that lost a row: what this device WROTE DOWN as removed, and whether it can
 * speak for its own store at all.
 */
export interface SealEvidence {
  deletedEntityKeys: ReadonlySet<string>;
  integrity: LocalStoreIntegrity;
}

/**
 * A healthy device that has removed NOTHING.
 *
 * The ordinary fixture for a seal whose subject is not the shrink rule: a
 * region that grew, or changed a row in place, needs no evidence, so this
 * constant is how a test says "and nothing here was un-pinned" in one word.
 */
export const NOTHING_WAS_UNPINNED: SealEvidence = {
  deletedEntityKeys: new Set(),
  integrity: HEALTHY_STORAGE,
};

/**
 * The same device, having RECORDED these owner-private removals.
 *
 * `keys` are the strings `ownerPrivateRegionKeys` spells and the delete verbs
 * write (`sharePeer:12`, `shareIdentity:me`). This is the fixture half of
 * `deleteLocalSharePeer`: dropping the row is what the person sees, and
 * writing the key down is what licenses telling the account about it.
 */
export function withUnpinned(keys: readonly string[]): SealEvidence {
  return { deletedEntityKeys: new Set(keys), integrity: HEALTHY_STORAGE };
}

// ---------------------------------------------------------------------------
// The merge's second question: can this device's fasts and saved meals stand?
// ---------------------------------------------------------------------------

/**
 * The two arguments `mergeSnapshots` weighs before it lets this device's
 * `fasts` and `savedMeals` stand: what the baseline recorded, and what the
 * delete journal says happened to the ids that are no longer there.
 */
export interface PassThroughEvidence {
  baseline: SyncBaseline;
  deletedEntityKeys: ReadonlySet<string>;
}

/**
 * A baseline that RECORDS the two pass-through lists and holds neither id,
 * beside an empty journal.
 *
 * The ordinary fixture for a merge whose subject is not the pass-through rule:
 * an empty record accounts for every id it named, which is none, so the local
 * list stands exactly as it did before the rule existed.
 *
 * It is spelled out rather than defaulted because an ABSENT record means
 * something different and load-bearing: a baseline written before the ids were
 * kept can account for nothing, and hands that cycle to the remote list.
 */
export const NOTHING_TO_ACCOUNT_FOR: PassThroughEvidence = {
  baseline: { perEntity: {}, tombstones: [], passThrough: { fasts: [], savedMeals: [] } },
  deletedEntityKeys: new Set(),
};

/**
 * A baseline that recorded these ids, beside a journal holding these keys.
 *
 * `journal` takes the namespaced keys the delete verbs write (`fast:abc`,
 * `savedMeal:def`), which is how a fixture says "the person removed this"
 * rather than "this row is missing".
 */
export function passThroughEvidence({
  fasts = [],
  savedMeals = [],
  journal = [],
}: {
  fasts?: string[];
  savedMeals?: string[];
  journal?: readonly string[];
}): PassThroughEvidence {
  return {
    baseline: { perEntity: {}, tombstones: [], passThrough: { fasts, savedMeals } },
    deletedEntityKeys: new Set(journal),
  };
}

/** A baseline from before the pass-through ids were kept: it can account for nothing. */
export const NO_PASS_THROUGH_RECORD: PassThroughEvidence = {
  baseline: { perEntity: {}, tombstones: [] },
  deletedEntityKeys: new Set(),
};
