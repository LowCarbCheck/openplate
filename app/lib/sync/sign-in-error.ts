/**
 * Classifies why a sync sign-in failed, so the form can say something true.
 *
 * ── Why this is not an `error.message` check at the call site ─────────────
 *
 * `PROTOCOL.md` §4 is explicit that clients branch on the STATUS, never on the
 * prose — a service is free to reword an error, and a client that string-matched
 * would break silently when it did. `SyncRequestError.kind` is that status,
 * already normalised.
 *
 * The distinction this exists for: on an instance running with
 * `REQUIRE_EMAIL_VERIFICATION`, an unconfirmed address gets `403` from
 * `POST /v1/auth/login` while a wrong passphrase gets `401`. Both used to
 * surface the same "check the address and passphrase and try again", which is
 * actively misleading in the `403` case — the credentials were correct, and no
 * amount of retyping will ever help. The fix for that user is an email link,
 * and this is what lets the UI say so.
 *
 * `forbidden` can only mean "unverified" HERE. The service's other `403` is
 * signups-closed, which belongs to signup and can never be the outcome of a
 * login; this function is deliberately named for the sign-in path so it is not
 * reused where that stops being true.
 */
import { SyncRequestError } from './engine/client/sync-error';

export type SignInFailure =
  /** `403` — the credentials were right; the address has not been confirmed yet. */
  | 'email-unverified'
  /** `401` — wrong email or passphrase. One message for both, by protocol design. */
  | 'rejected'
  /** Anything else: transport, an incompatible service, a DEK that will not unwrap. Show what it said. */
  | 'other';

/** @param cause - anything the sign-in call threw. */
export function classifySignInFailure(cause: unknown): SignInFailure {
  if (!(cause instanceof SyncRequestError)) return 'other';
  if (cause.kind === 'forbidden') return 'email-unverified';
  if (cause.kind === 'unauthorized') return 'rejected';
  return 'other';
}
