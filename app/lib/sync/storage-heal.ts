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
 * AND A REFUSED PASS-THROUGH TABLE IS THE SAME EVENT. When this device cannot
 * account for the `fasts` or `savedMeals` ids its own baseline recorded, the
 * merge keeps the ACCOUNT'S list, and rows the device could not see come back
 * with no tombstone anywhere to mark it. That is a restore, so it is counted
 * and reported here exactly like a withheld delete.
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
  | {
      kind: 'restored';
      entryCount: number;
      /**
       * WHOSE DATA CAME BACK. The notice lives in the session snapshot, and
       * `openSyncSession` carries it across an open on purpose, because a
       * sign-in is the likeliest moment after an eviction. `openSyncVault`
       * opens over a LIVE vault without closing it, so signing in as somebody
       * else on a shared device carried the previous person's restore count
       * onto the new session's screen. It is kept only when it names the
       * account that is opening (`sync-session.ts`).
       */
      accountId: number;
    };

/**
 * @param restoredCount - how many diary rows this cycle got back that the
 *   device could not vouch for (`countRestoredEntities`).
 * @param accountId - the account this cycle ran for, so a later sign-in as
 *   somebody else does not inherit the sentence.
 *
 * THE COUNT IS WHAT CAME BACK, NEVER WHAT WAS WITHHELD (M225). The two differ
 * in the one case where the sentence would be a lie: when the pull found no
 * blob at all, `mergeSnapshots` never runs, the withheld entities do not
 * return, and they drop out of the baseline on the next commit. Reporting
 * "your entries were restored from your account" there tells somebody their
 * diary is safe at the moment it is being forgotten. Nothing is SHOWN in that
 * case, because there is no restore to describe; the log line below still
 * fires, and it is the one that carries the diagnosis.
 *
 * THE COUNT IS THE WHOLE TEST, and there is deliberately no second early
 * return on an empty `withheld` list. A REFUSED pass-through table restores
 * rows without withholding a single tombstone (`countRestoredEntities`), and
 * the old guard said nothing at all to the person whose fasts had just been
 * handed back by their account.
 */
export function resolveStorageHealNotice({
  restoredCount,
  accountId,
}: {
  restoredCount: number;
  accountId: number;
}): StorageHealNotice {
  if (restoredCount === 0) return { kind: 'none' };
  return { kind: 'restored', entryCount: restoredCount, accountId };
}

/**
 * Logs the loss, asks for persistent storage again, and publishes the notice.
 *
 * IT FIRES ON A REFUSED PASS-THROUGH TABLE TOO, not only on a withheld
 * tombstone. `mergeSnapshots` keeps the ACCOUNT'S `fasts` or `savedMeals` when
 * this device cannot account for the ids its own baseline recorded, and that
 * is the same loss wearing different clothes: rows this device could not see,
 * put back by the account, with no tombstone anywhere to mark it.
 *
 * NEVER THROWS. It runs at the end of a cycle that already succeeded, and a
 * failure to report must not be reported as a failure to sync.
 */
export async function healAfterWithheldDeletes({
  withheld,
  refusedTables,
  restoredCount,
  accountId,
}: {
  withheld: readonly Tombstone[];
  /** The store tables whose remote list stood (`PassThroughOutcome.refused`). */
  refusedTables: readonly string[];
  restoredCount: number;
  accountId: number;
}): Promise<void> {
  if (withheld.length === 0 && refusedTables.length === 0) return;
  const notice = resolveStorageHealNotice({ restoredCount, accountId });

  // STICKY FOR THE SESSION, never cleared by a later clean cycle. Sync runs on
  // boot, on `online` and behind a debounce, so a notice that the next cycle
  // erased would be gone before anybody read it, and this is the one sentence
  // in the app that must not be missable.
  //
  // The LOGGING below runs whether or not there is a notice: a cycle that
  // withheld deletes and got nothing back is the state that most needs a trace,
  // and it is the one with nothing on screen.
  if (notice.kind !== 'none') updateSyncSession({ storageHealNotice: notice });
  try {
    const storage = await readOriginStorageReport();
    const granted = await requestPersistentStorageAgain();
    log.warn('a sync cycle withheld deletes: this device could not prove they happened', {
      withheldCount: withheld.length,
      // How many diary rows the account actually handed back. It counts a
      // REFUSED pass-through list as well as a withheld tombstone, and it
      // never counts the compartment, which is held bytes rather than a row
      // the apply wrote (`countRestoredEntities`).
      restoredCount,
      // The entity TYPES, never an id: an id is diary content and this line
      // goes to a log. `privateStore` appears here and nowhere else: the held
      // compartment is reported and never counted.
      entityTypes: [...new Set(withheld.map((tombstone) => tombstone.entityType))].toSorted(),
      // The two collections the merge does not merge, when the account's list
      // stood instead of this device's. A table name, never a row.
      refusedTables: [...refusedTables].toSorted(),
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
