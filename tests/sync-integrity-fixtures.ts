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
};

/** A device whose IndexedDB is GONE while its baseline survived: the eviction this rule exists for. */
export const EVICTED_STORAGE: SnapshotIntegrity = {
  hasPersistedDatabase: false,
  isTableLoaded: {},
  isCompartmentKnown: false,
};
