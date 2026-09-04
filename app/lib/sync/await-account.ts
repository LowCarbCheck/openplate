/**
 * Waiting a bounded moment for a sync session that is on its way.
 *
 * ── Why anything waits at all ────────────────────────────────────────────
 *
 * On a managed instance one link carries a sync half and a gateway half. The
 * sync half is spent by the account ceremony on `/settings/sync`, and that
 * ceremony hands straight over to `/join` for the second half. The session is
 * opened by `createSyncAccount` in the SAME TAB a moment earlier, but "a
 * moment earlier" is not a guarantee: `/join` mounts, reads
 * `getSyncSessionSnapshot()` once, and a snapshot read that lands on the wrong
 * side of that millisecond used to answer `sign-in-first` — a card asking
 * somebody to sign in to the account they had just created, on a device where
 * the session then opened seconds later and nothing re-read it.
 *
 * So the read becomes a bounded WAIT. It is not a poll: the session store
 * publishes to its subscribers (`sync-session.ts`), so the wait ends on the
 * first notification, and the timeout exists only so a genuinely signed-out
 * device is not held on a spinner forever.
 *
 * Every boundary is injected — the snapshot read, the subscription and the
 * timer — so the whole thing is exercised under `node --test`, which has no
 * session store and no React.
 */

/** Cancels a scheduled callback. */
export type CancelTimer = () => void;

/** A bounded wait's boundaries: what to read, what to listen to, and how to give up. */
export interface AwaitAccountDeps {
  /** Reads the fact being waited for. Called once immediately, then on every notification. */
  hasAccount: () => boolean;
  /** Subscribes to changes; the returned function unsubscribes. */
  subscribe: (listener: () => void) => () => void;
  /** Schedules the give-up, and hands back a way to cancel it. */
  schedule: (callback: () => void, delayMs: number) => CancelTimer;
}

/**
 * Waits for an account to be present, for at most `timeoutMs`.
 *
 * Resolves immediately when one is already there, which is the ordinary case
 * and costs nothing: no subscription and no timer are created at all.
 *
 * @returns `true` when an account is present, `false` when the wait ran out.
 */
export async function waitForAccount({
  deps,
  timeoutMs,
}: {
  deps: AwaitAccountDeps;
  timeoutMs: number;
}): Promise<boolean> {
  if (deps.hasAccount()) return true;
  if (timeoutMs <= 0) return false;

  return new Promise<boolean>((resolve) => {
    // Both the subscription and the timer have to be torn down by whichever of
    // them fires first, and `settle` is the one place that happens — a wait
    // that resolved but kept listening would call `resolve` again on the next
    // session change, which is silent but is exactly the kind of leak that
    // outlives the screen that started it.
    let isSettled = false;
    const settle = (result: boolean): void => {
      if (isSettled) return;
      isSettled = true;
      unsubscribe();
      cancelTimer();
      resolve(result);
    };

    const unsubscribe = deps.subscribe(() => {
      if (deps.hasAccount()) settle(true);
    });
    const cancelTimer = deps.schedule(() => settle(false), timeoutMs);

    // One more read, after subscribing: an account that arrived between the
    // first read and the subscription would otherwise be missed entirely, and
    // that race is the whole reason this function exists.
    if (deps.hasAccount()) settle(true);
  });
}
