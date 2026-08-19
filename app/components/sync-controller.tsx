import { useEffect } from 'react';
import { useSyncServerUrl } from '#app/hooks/use-public-config';
import { getPrimaryStore } from '#app/lib/local-store/persist';
import { getSyncSessionSnapshot } from '#app/lib/sync/sync-session';
import { markSyncPending, syncNow } from '#app/lib/sync/sync-actions';
import { createComponentLogger } from '#app/lib/logger';

const log = createComponentLogger('sync-controller');

/** How long the device waits after the last local write before pushing. Long enough to batch a burst of edits, short enough to feel live. */
const PUSH_DEBOUNCE_MS = 3_000;

/**
 * Drives sync in the background: a cycle on boot, one when the device comes
 * back online, and a debounced one after local writes. Renders nothing.
 *
 * ── The gate ─────────────────────────────────────────────────────────────
 *
 * With `SYNC_SERVER_URL` unset this effect returns immediately: no listeners
 * are attached, no store subscription is opened, and no request is made. That
 * is the requirement stated literally — an instance without sync configured
 * must be indistinguishable, on the wire, from one built without the feature.
 *
 * With sync configured but no session open, `syncNow()` is a no-op. Neither of
 * those callers should have to know whether the user has signed in.
 *
 * ── Why a store listener rather than calls in the write paths ─────────────
 *
 * Every local write already goes through TinyBase, which notifies on real
 * changes only. Subscribing here means routes, forms and the outbox stay
 * completely unaware of sync — nothing to remember when adding a feature, and
 * no way to add a write path that silently doesn't sync.
 *
 * ── The feedback loop this avoids ────────────────────────────────────────
 *
 * Applying a merged snapshot writes to the same store, which fires the same
 * listener. Skipping while a cycle is in flight breaks that: every write made
 * by the apply step lands while `phase === 'syncing'` and is ignored. A write
 * that genuinely arrives from the user in that window is picked up by the next
 * one — the local store is the source of truth, so nothing is lost by
 * deferring.
 */
export function SyncController() {
  const serverUrl = useSyncServerUrl();

  useEffect(() => {
    // Sync is off on this instance. Attach nothing, request nothing.
    if (serverUrl === null) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    const runSyncCycle = async (): Promise<void> => {
      try {
        await syncNow();
      } catch (error) {
        // The session snapshot already carries the user-visible error
        // (`describeSyncFailure`); this is the developer-facing half.
        log.warn('sync cycle failed', { error: error instanceof Error ? error.message : String(error) });
      }
    };

    const runCycle = (): void => {
      void runSyncCycle();
    };

    const scheduleCycle = (): void => {
      if (cancelled) return;
      if (getSyncSessionSnapshot().phase === 'syncing') return;
      markSyncPending();
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(runCycle, PUSH_DEBOUNCE_MS);
    };

    runCycle();
    window.addEventListener('online', runCycle);

    const attachStoreListener = async (): Promise<void> => {
      try {
        const store = await getPrimaryStore();
        if (cancelled) return;
        // Tables only: store-level VALUES include this device's own
        // bookkeeping (last-export stamp, schema version), and reacting to
        // those would sync on writes that carry no user data.
        const listenerId = store.addTablesListener(scheduleCycle);
        unlisten = () => store.delListener(listenerId);
      } catch {
        // No IndexedDB (private mode, an unusual browser): local-first still
        // works, sync just stays manual. Not worth an error to the user.
      }
    };

    void attachStoreListener();

    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      window.removeEventListener('online', runCycle);
      unlisten?.();
    };
  }, [serverUrl]);

  return null;
}
