/**
 * bounded-wait.ts: stop waiting for a best-effort request that went quiet.
 *
 * ── Why this exists (sign-out, 2026-10-02) ───────────────────────────────
 *
 * A sign-out that is running cannot be closed: Escape and Cancel are ignored
 * while it works, because a dialog that vanished mid-erase would leave the
 * person guessing what state the device was in. That is only acceptable if the
 * run always ENDS. Its one network step, the logout request, is best effort and
 * nothing on the device depends on the answer, but `fetch` has no timeout of
 * its own: a captive portal or a half-open connection leaves it pending for
 * minutes, and the person watches a spinner they cannot dismiss.
 *
 * So the wait is bounded. The request itself is NOT cancelled: it is abandoned,
 * and what a late answer does is the caller's business. Both callers pass work
 * whose result nothing reads, on a client that holds no token store, so a
 * request that finishes after the bound writes nothing anywhere.
 */

/** How long a sign-out waits for the server before it carries on without it. */
export const SIGN_OUT_REQUEST_BOUND_MS = 4000;

/** Whether the work finished on its own, or the bound ran out first. */
export type BoundedOutcome = 'finished' | 'timed-out';

/**
 * Runs `work` and resolves when it settles or when `timeoutMs` has passed,
 * whichever comes first.
 *
 * A REJECTION BEFORE THE BOUND PROPAGATES, so a caller's own `catch` still
 * sees a request that failed fast. A rejection AFTER the bound is swallowed
 * here: nobody is listening any more, and an unhandled rejection from a request
 * the sign-out already walked away from would surface as a console error on the
 * next page.
 *
 * The timer is always cleared, so a finished request leaves nothing scheduled.
 *
 * @param options.work - the request to bound. Called once, immediately.
 * @param options.timeoutMs - the longest to wait, in milliseconds.
 */
export async function waitAtMost<TResult>({
  work,
  timeoutMs,
}: {
  work: () => Promise<TResult>;
  timeoutMs: number;
}): Promise<BoundedOutcome> {
  const started = work().then((): BoundedOutcome => 'finished');
  // Handled from the moment it exists, so a failure after the race is decided is not "unhandled".
  started.catch(() => undefined);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<BoundedOutcome>((resolve) => {
    timer = setTimeout(() => resolve('timed-out'), timeoutMs);
  });
  try {
    return await Promise.race([started, expired]);
  } finally {
    clearTimeout(timer);
  }
}
