/**
 * session-refusal.ts: the two ways the core ends a session, and what each one says.
 *
 * ── Why this is its own file ─────────────────────────────────────────────
 *
 * A session the SERVER ended is one of two different things, and the person
 * has to be told which. A revoked token family, or an expired one, is solved by
 * signing in again. A SUSPENDED ACCOUNT is not: the sign-in cannot work, and a
 * screen that says "sign in again" sends the person round a loop that ends at
 * the same refusal. `describeSyncFailure` (`sync-actions.ts`) and the resume
 * path (`session-cache.ts`) both have to publish that distinction, and
 * `session-cache.ts` cannot import `sync-actions.ts` (the dependency runs the
 * other way), so the sentences live here, below both.
 *
 * The messages are this app's own, the developer-facing half under the
 * translated headline. The server's `account-suspended` is a protocol word, not
 * a sentence.
 */
import type { SessionRefusal } from './engine/client/auth-client';
import type { SyncSessionSnapshot } from './sync-session';

/** The failure a session ends with, as `SyncSessionSnapshot['error']` carries it. */
export type SessionEndedFailure = NonNullable<SyncSessionSnapshot['error']>;

const SUSPENDED_MESSAGE = 'An administrator has suspended this account, so it cannot sync. Ask them to reactivate it.';

const REFUSED_SESSION_MESSAGE = 'The core server refused this device’s session, so it has to be opened again.';

/**
 * The failure to publish for a refusal.
 *
 * @param refusal - what the core said, or `null` when the refusal's kind is not
 *   known. Unknown is read as a revoked session, the milder of the two: it asks
 *   for a sign-in, which a suspended account will find out cannot work, where
 *   the reverse would tell a person with a good account that it is suspended.
 */
export function failureForRefusal(refusal: SessionRefusal | null): SessionEndedFailure {
  if (refusal === 'suspended') return { reason: 'suspended', message: SUSPENDED_MESSAGE };
  return { reason: 'reauth-required', message: REFUSED_SESSION_MESSAGE };
}

/** The failure for a suspension, for the classifier that has the server's own message to set aside. */
export function suspendedFailure(): SessionEndedFailure {
  return failureForRefusal('suspended');
}

/** Whether a failure ends the session, so the caller must close it visibly. */
export function endsTheSession(failure: SessionEndedFailure): boolean {
  return failure.reason === 'reauth-required' || failure.reason === 'suspended';
}

/**
 * Corrects a `reauth-required` that was really a suspension.
 *
 * A data call whose access token has expired gets a `401`, spends the refresh
 * token, and is refused THERE with `403 account-suspended`. The http client
 * then hands back the original `401`, which classifies as `reauth-required`,
 * and the suspension is gone. The auth client remembers what the refresh was
 * told ({@link SyncAuthClient.getLastRefusal}), so the caller that classified
 * the failure asks it and corrects the one case.
 *
 * @param options.failure - what the classifier said.
 * @param options.refusal - why the client's last refresh was refused, or `null`.
 */
export function failureWithRefusal({
  failure,
  refusal,
}: {
  failure: SessionEndedFailure;
  refusal: SessionRefusal | null;
}): SessionEndedFailure {
  if (failure.reason !== 'reauth-required') return failure;
  if (refusal !== 'suspended') return failure;
  return suspendedFailure();
}
