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
import type { SnapshotIntegrity } from '../app/lib/sync/snapshot-sync';

/**
 * A HEALTHY DEVICE: the database is there, every table loaded, the compartment
 * has been read. Tombstones from this device are trusted, which is what makes
 * it the right fixture for every test about ordinary deletes.
 */
export const HEALTHY_STORAGE: SnapshotIntegrity = {
  hasPersistedDatabase: true,
  isTableLoaded: {},
  isCompartmentKnown: true,
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
