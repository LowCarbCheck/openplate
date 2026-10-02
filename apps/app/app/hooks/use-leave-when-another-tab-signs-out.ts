import { useEffect } from 'react';

import { useSyncSession } from '#app/components/sync-status';
import { stopAllPersisters } from '#app/lib/local-store/persist';
import { createComponentLogger } from '#app/lib/logger';
import { DEVICE_LOCK_KEY, isDeviceLocked, syncBaselineStorageKey } from '#app/lib/sync/sync-state';

const log = createComponentLogger('leave-when-another-tab-signs-out');

/** What one `storage` event says, reduced to the three facts the decision needs. */
export interface StorageChange {
  /** `StorageEvent.key`: which key changed, or `null` when the whole storage was cleared. */
  key: string | null;
  /** `StorageEvent.newValue`: what it holds now, `null` when the key was removed. */
  newValue: string | null;
  /** This tab's own `openplate.sync.state.v1:<accountId>` key, `null` while no account is open here. */
  ownBaselineKey: string | null;
}

/**
 * Does this change, made by ANOTHER tab, mean this tab must leave the app?
 *
 * Two writes qualify, and both are writes a sign-out already makes, so there is
 * no new signal and no change to the order of its steps:
 *
 * - THE DEVICE LOCK WAS SET (`DEVICE_LOCK_KEY`, imported: the key is spelled in
 *   `sync-state.ts` and nowhere else). Any value, never parsed: the lock's value format
 *   is not this module's business (it has changed before), and a tab that has
 *   to decide "was a lock written" must not break when it does again. Removing
 *   the lock (`newValue === null`) is a sign-IN and leaves nothing to leave.
 * - THIS ACCOUNT'S BASELINE WAS REMOVED. That is what an erase does first
 *   (`device-erase.ts`) and what deleting the account does too. Another
 *   account's baseline is somebody else's business, and a baseline that was
 *   merely rewritten (`newValue !== null`) is an ordinary sync cycle.
 *
 * Pure, so every row of the decision is a line in the unit test.
 */
export function shouldLeave({ key, newValue, ownBaselineKey }: StorageChange): boolean {
  if (key === null) return false;
  if (key === DEVICE_LOCK_KEY) return newValue !== null;
  if (ownBaselineKey === null) return false;
  return key === ownBaselineKey && newValue === null;
}

/**
 * Stops this page's stores, then leaves. Exported so the order is a unit test.
 *
 * THE STOP COMES FIRST. A sign-out with an erase sets the lock and then
 * deletes the databases, and this tab hears the lock before the deletes run.
 * A store left running here polls its database about once a second, and a
 * poll that lands after the delete and before the document load creates an
 * empty database again (`persist.ts`, mechanism 7). Nothing is flushed: the
 * other tab may be about to erase, and a flush would be the write-back.
 *
 * A stop that throws still leaves: the document load ends the stores as well,
 * only later.
 */
export async function stopStoresThenLeave({
  stopStores,
  leave,
}: {
  stopStores: () => Promise<void>;
  leave: () => void;
}): Promise<void> {
  try {
    await stopStores();
  } catch (cause) {
    log.error('could not stop the stores before leaving', {
      error: cause instanceof Error ? cause.message : String(cause),
    });
  }
  leave();
}

/**
 * Sends this tab away when another tab of the same device signs out.
 *
 * ── The defect (2026-10-02) ──────────────────────────────────────────────
 *
 * Two tabs, one device. Tab 1 signs out; tab 2 kept showing the diary until
 * its access token failed to refresh, about 15 minutes later, and then said
 * "Your session ended", which reads as if the server had ended it. After an
 * ERASE it was worse: tab 2's persisters were still alive in memory and wrote
 * the sync baseline and the outbox and photo databases back onto a device that
 * had just been cleaned (`sign-out-other-tab.spec.ts` shows it).
 *
 * ── Why `storage` ────────────────────────────────────────────────────────
 *
 * The browser fires `storage` in every tab of the origin EXCEPT the one that
 * wrote, which is exactly the audience: the tab that signed out already leaves
 * by itself (`sign-out-flow.ts`).
 *
 * ── Why a HARD navigation ────────────────────────────────────────────────
 *
 * Same reason as `sign-out-flow.ts`: this tab holds the diary in TinyBase
 * stores whose persisters are still autosaving, and a router navigation would
 * leave them alive. The persisters are stopped first (`stopStoresThenLeave`),
 * because the document load comes too late for a poll already due, and the
 * load then ends the rest. Stopping also closes the tab's IndexedDB
 * connections, which is what lets the erase in the other tab delete the
 * databases instead of waiting on this one.
 *
 * ── Where it lands ───────────────────────────────────────────────────────
 *
 * `/welcome` when the device is locked (a managed instance), `/dashboard`
 * otherwise, which is where an open instance's erase ends up and where the
 * onboarding gate sends an emptied device on to `/welcome` by itself. Either
 * way it is one document load.
 *
 * Mounted by the personal layout only, because only the pages that show the
 * diary have anything to leave. A public page in another tab is left alone.
 *
 * SSR-safe: `window` is read in an effect, never at import or render.
 */
export function useLeaveWhenAnotherTabSignsOut(): void {
  const accountId = useSyncSession().account?.id ?? null;

  useEffect(() => {
    const ownBaselineKey = accountId === null ? null : syncBaselineStorageKey(accountId);
    const onStorage = (event: StorageEvent): void => {
      if (event.storageArea !== window.localStorage) return;
      if (!shouldLeave({ key: event.key, newValue: event.newValue, ownBaselineKey })) return;
      void stopStoresThenLeave({
        stopStores: stopAllPersisters,
        leave: () => window.location.assign(isDeviceLocked() ? '/welcome' : '/dashboard'),
      });
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [accountId]);
}
