/**
 * The host of the one sign-out dialog, mounted once in `root.tsx`. It is tiny
 * on purpose. The dialog itself is `sign-out-dialog-body.tsx`.
 *
 * ── Why the split ────────────────────────────────────────────────────────
 *
 * `root.tsx` is on every page, the public landing page included, and the dialog
 * brings the sign-out steps, the device read, the feedback outbox, the photo
 * cache and the alert dialog with it: about 30 KB gzip that a visitor who is not
 * signed in will never use. So the host here imports only the progress store and
 * the session store, which are small and already on every page, and loads the
 * body with `React.lazy` the first time the dialog opens. Once loaded the body
 * stays mounted, so its state (the tick, the read, a failed erase) survives a
 * close and a reopen as it did before the split.
 *
 * `tests/unit/sign-out-dialog-lazy.test.ts` reads this file and `root.tsx` and
 * fails on a static import of the body. A single one would put the whole thing
 * back in the root chunk and nothing else would notice.
 *
 * ── Why the chunk is fetched ahead of the tap ────────────────────────────
 *
 * A sign-out has to work on a flaky or an offline connection, and after a
 * deploy replaced the chunk files a tab still has open. A person who taps "Sign
 * out" with no signal must not meet a dialog that never opens. So once a sync
 * session is open (the only state a sign-out exists in) the host fetches the
 * body when the browser is idle, and the chunk is in memory long before any tap.
 * The fetch is best effort: a failure is logged, and opening the dialog tries
 * again.
 *
 * ── The fallback is nothing ──────────────────────────────────────────────
 *
 * A modal dialog is an overlay and reserves no space in the page, so while the
 * chunk loads there is nothing to hold a place for and `null` is the whole
 * fallback. Nothing on the page moves when the dialog arrives.
 *
 * ── Server rendering ─────────────────────────────────────────────────────
 *
 * The server snapshot of the progress store is closed, so the server and the
 * first client render both draw nothing. The preload runs in an effect, which
 * the server never runs.
 */
import { Suspense, lazy, useEffect, useState } from 'react';

import { createComponentLogger } from '#app/lib/logger';
import { useSignOutProgress } from '#app/lib/sync/sign-out-progress';
import { useSyncSession } from './sync-status';

const log = createComponentLogger('sign-out');

/** One dynamic import, shared by the lazy component and the preload, so the chunk is fetched once. */
function loadSignOutDialogBody() {
  return import('./sign-out-dialog-body');
}

const SignOutDialogBody = lazy(loadSignOutDialogBody);

/** Where a browser without `requestIdleCallback` (Safari) waits before it fetches the body. */
const PRELOAD_FALLBACK_DELAY_MS = 2_000;

async function preloadSignOutDialogBody(): Promise<void> {
  try {
    await loadSignOutDialogBody();
  } catch (caught) {
    log.warn('the sign-out dialog could not be preloaded', {
      error: caught instanceof Error ? caught.message : String(caught),
    });
  }
}

/** Fetches the body when the browser has nothing better to do. Returns the way to cancel. */
function schedulePreload(): () => void {
  // Safari has no `requestIdleCallback`.
  if (window.requestIdleCallback !== undefined) {
    const handle = window.requestIdleCallback(() => void preloadSignOutDialogBody());
    return () => window.cancelIdleCallback(handle);
  }
  const handle = setTimeout(() => void preloadSignOutDialogBody(), PRELOAD_FALLBACK_DELAY_MS);
  return () => clearTimeout(handle);
}

/**
 * The one sign-out dialog. Mount it once, above every route; the doors open it
 * through `openSignOutDialog()`.
 */
export function SignOutDialogHost() {
  const { isOpen } = useSignOutProgress();
  const hasSession = useSyncSession().account !== null;
  // Mounted from the first opening on and never unmounted: the body keeps its
  // own state across a close, and unmounting would drop it.
  const [hasBeenOpened, setHasBeenOpened] = useState(false);
  if (isOpen && !hasBeenOpened) setHasBeenOpened(true);

  useEffect(() => {
    if (!hasSession) return;
    return schedulePreload();
  }, [hasSession]);

  if (!hasBeenOpened) return null;
  return (
    <Suspense fallback={null}>
      <SignOutDialogBody />
    </Suspense>
  );
}
