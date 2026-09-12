/**
 * What this device does when a sync cycle REFUSED to publish a delete.
 *
 * `snapshot-sync.ts` withholds a tombstone whenever the device cannot prove
 * the delete happened: the IndexedDB database is gone while the baseline in
 * `localStorage` survives, or a table's disk copy is ahead of its memory copy.
 * The push then carries only the live entities, the pull hands the server's
 * copy back, and `applyMergedSnapshot` repopulates the device through the
 * ordinary path. That mechanism is SILENT by design.
 *
 * The REPORTING must not be. Three things happen here and each one closes a
 * gap the production incident left open:
 *
 *  1. **It is logged, with the storage facts.** `navigator.storage.persisted()`
 *     and `estimate()` are not observed anywhere else in this app, which is
 *     why an eviction left no trace at all and the diagnosis had to be
 *     reconstructed from a token-family timestamp and a push 373 ms later.
 *  2. **Persistence is requested again.** A device that was evicted is a
 *     device whose storage was not persistent. That is the one moment the
 *     answer might have changed, and `persist.ts`'s ordinary request is
 *     single-shot and long spent by then.
 *  3. **The person is told.** Their device lost its local copy and their
 *     account put it back. Saying nothing means a device that looked fine
 *     while it emptied itself, which is how this defect survived.
 *
 * Pure decision, impure effect, kept apart: {@link resolveStorageHealNotice}
 * decides and is testable without a browser, {@link healAfterWithheldDeletes}
 * performs.
 */
import type { Tombstone } from './engine/merge/types';
import { readOriginStorageReport, requestPersistentStorageAgain } from '#app/lib/local-store/persist';
import { createComponentLogger } from '#app/lib/logger';
import { updateSyncSession } from './sync-session';

const log = createComponentLogger('SyncStorageHeal');

/** What the person is told about this device's local copy. */
export type StorageHealNotice =
  /** Nothing happened; the ordinary state of every cycle. */
  | { kind: 'none' }
  /** This device could not see rows the account still holds, and they were restored from it. */
  | { kind: 'restored'; entryCount: number };

/**
 * @param withheld - the tombstones `stampSnapshot` declined to publish.
 */
export function resolveStorageHealNotice(withheld: readonly Tombstone[]): StorageHealNotice {
  if (withheld.length === 0) return { kind: 'none' };
  return { kind: 'restored', entryCount: withheld.length };
}

/**
 * Logs the loss, asks for persistent storage again, and publishes the notice.
 *
 * NEVER THROWS. It runs at the end of a cycle that already succeeded, and a
 * failure to report must not be reported as a failure to sync.
 */
export async function healAfterWithheldDeletes(withheld: readonly Tombstone[]): Promise<void> {
  const notice = resolveStorageHealNotice(withheld);
  if (notice.kind === 'none') return;

  // STICKY FOR THE SESSION, never cleared by a later clean cycle. Sync runs on
  // boot, on `online` and behind a debounce, so a notice that the next cycle
  // erased would be gone before anybody read it, and this is the one sentence
  // in the app that must not be missable.
  updateSyncSession({ storageHealNotice: notice });
  try {
    const storage = await readOriginStorageReport();
    const granted = await requestPersistentStorageAgain();
    log.warn('a sync cycle withheld deletes: this device could not prove they happened', {
      withheldCount: withheld.length,
      // The entity TYPES, never an id: an id is diary content and this line
      // goes to a log.
      entityTypes: [...new Set(withheld.map((tombstone) => tombstone.entityType))].toSorted(),
      wasStoragePersisted: storage.isPersisted,
      storageUsageBytes: storage.usageBytes,
      storageQuotaBytes: storage.quotaBytes,
      isStorageNowPersisted: granted,
    });
  } catch (cause) {
    log.warn('could not read this origin’s storage facts while healing', {
      error: cause instanceof Error ? cause.message : String(cause),
    });
  }
}
