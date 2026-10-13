import { useEffect } from 'react';
import { useRevalidator } from 'react-router';
import { useSyncSession } from '#app/components/sync-status';
import { runMicronutrientBackfillOnce } from '#app/lib/micronutrient-backfill-job';

/** Where a browser without `requestIdleCallback` (Safari) waits before it starts, the sign-out dialog's figure. */
const IDLE_FALLBACK_DELAY_MS = 2_000;

/** Runs `task` when the browser has nothing better to do. Returns the way to cancel. */
function scheduleWhenIdle(task: () => void): () => void {
  // Safari has no `requestIdleCallback`.
  if (window.requestIdleCallback !== undefined) {
    const handle = window.requestIdleCallback(task);
    return () => window.cancelIdleCallback(handle);
  }
  const handle = setTimeout(task, IDLE_FALLBACK_DELAY_MS);
  return () => clearTimeout(handle);
}

/**
 * Starts this tab's micronutrient backfill run (`#app/lib/micronutrient-backfill-job`)
 * in the background. Renders nothing.
 *
 * AFTER THE SESSION HAS SETTLED. On a managed instance the route wants the
 * account's bearer, and the session reopens after the first paint; asking
 * before that would meet a `401` and end the run for nothing. On an instance
 * without sync, `SyncController` settles the flag at once.
 *
 * WHEN IDLE, AND ONLINE. Nothing a loader reads waits for it: the run starts
 * once the browser is idle, and an offline device waits for the `online`
 * event instead of spending its one run on a request that cannot leave. The
 * run itself is shared per tab, so a remount (a sign-in, a layout swap) never
 * starts a second one.
 *
 * THEN THE SCREEN READS AGAIN. A run that wrote the ledger revalidates the
 * route on screen, so Insights, which does not poll the log as the diary
 * does, shows a filled window without a navigation.
 */
export function MicronutrientBackfillController(): null {
  const { isResuming } = useSyncSession();
  const { revalidate } = useRevalidator();

  useEffect(() => {
    if (isResuming) return;
    let cancelIdle: (() => void) | null = null;
    const runThenRevalidate = async (): Promise<void> => {
      const report = await runMicronutrientBackfillOnce();
      if (report.writtenSlugs > 0) await revalidate();
    };
    const start = (): void => {
      cancelIdle = scheduleWhenIdle(() => void runThenRevalidate());
    };
    const startOnceOnline = (): void => {
      window.removeEventListener('online', startOnceOnline);
      start();
    };
    if (navigator.onLine) start();
    else window.addEventListener('online', startOnceOnline);
    return () => {
      window.removeEventListener('online', startOnceOnline);
      cancelIdle?.();
    };
  }, [isResuming, revalidate]);

  return null;
}
