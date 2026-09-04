import { useEffect } from 'react';
import { useSyncServerUrl } from '#app/hooks/use-public-config';
import { getPrimaryStore } from '#app/lib/local-store/persist';
import { getSyncSessionSnapshot, getSyncVault, updateSyncSession } from '#app/lib/sync/sync-session';
import { markSyncPending, syncNow } from '#app/lib/sync/sync-actions';
import { resumeSyncSession } from '#app/lib/sync/session-cache';
import { createComponentLogger } from '#app/lib/logger';

const log = createComponentLogger('sync-controller');

/** How long the device waits after the last local write before pushing. Long enough to batch a burst of edits, short enough to feel live. */
const PUSH_DEBOUNCE_MS = 3_000;

/**
 * Drives sync in the background: RESUME the cached session, then a cycle on
 * boot, one when the device comes back online, and a debounced one after local
 * writes. Renders nothing.
 *
 * ── The resume comes FIRST, and it does not block rendering ──────────────
 *
 * `resumeSyncSession` rebuilds the vault from `openplate-session` (M192), so a
 * reload of a signed-in tab ends signed in rather than at `/sign-in`. It runs
 * inside this effect, which React runs AFTER paint — the diary is on screen
 * before a single request goes out, exactly as it is on a device that has
 * never synced.
 *
 * It runs BEFORE the first cycle because the order is the whole point: a
 * `syncNow()` with no vault is a silent no-op, and firing it first would waste
 * the boot cycle and leave the device idle until the next local write.
 *
 * It NEVER THROWS. Offline, a 500, a service mid-deploy — all of them leave
 * the app signed out and the local diary working, which is what it does on a
 * device that has never signed in.
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
    // Sync is off on this instance. Attach nothing, request nothing. The
    // resume flag is still settled: no session will ever be reopened here, and
    // a screen left waiting for one would wait forever.
    if (serverUrl === null) {
      updateSyncSession({ isResuming: false });
      return;
    }

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

    // Resume first, then the boot cycle. `syncNow()` before the vault exists
    // is a no-op, so the two cannot be reordered without losing the cycle.
    const bootstrap = async (): Promise<void> => {
      // Already open — a client-side navigation back to a diary route, rather
      // than a reload. Nothing to resume, and asking again would spend a
      // refresh token for a session that is already live.
      if (getSyncVault() === null) await resumeSyncSession({ serverUrl });
      // SETTLED HERE, on every path, whatever the resume decided. This is the
      // only place that knows the attempt is over: `resumeSyncSession` returns
      // the same signed-out snapshot for "there was no cache", "the tokens
      // were refused" and "the service could not be reached", and the last of
      // those keeps the cache — so a screen watching the cache instead of this
      // flag would wait for a resume that already happened and failed.
      updateSyncSession({ isResuming: false });
      if (cancelled) return;
      await runSyncCycle();
    };
    void bootstrap();
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
