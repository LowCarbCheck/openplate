/**
 * The single error type every sync HTTP call throws.
 *
 * `PROTOCOL.md` §4 is explicit that clients branch on the STATUS CODE and
 * never on the message text, so this carries a `kind` derived from the status
 * and keeps the server's prose only for diagnostics. A caller that switches on
 * `error.kind` is following the protocol; one that string-matches `message` is
 * not, and will break the first time a server rewords something.
 *
 * Errors, not booleans: every one of these means an operation did not happen.
 * A `false` return would have to be checked, and the checks are exactly what
 * gets forgotten on the path where a missed failure strands someone's data.
 */

import { HEALTH_CONSENT_REQUIRED } from './auth-wire';

/** Protocol-meaningful failure classes. `conflict` is deliberately NOT here — a 409 is a normal outcome, not an error. */
export type SyncErrorKind =
  /** `400` — the request was malformed. A bug on this side, not a user problem. */
  | 'invalid'
  /** `401` — no valid session. After one failed refresh this means "send the user to sign in again". */
  | 'unauthorized'
  /** `403` — authenticated but not permitted (an invite refused, an AI allowance of zero). */
  | 'forbidden'
  /**
   * `403 {"error":"account-suspended"}` — an admin has suspended this account.
   *
   * A SEPARATE KIND rather than a `forbidden` a caller string-matches, because
   * it is the one 403 that can land on ANY authenticated call: a login, a
   * refresh, a sync cycle, a scan. Every one of those surfaces has to say the
   * same true thing ("an administrator has suspended this account"), and a
   * kind is what lets them without each one re-reading the server's prose —
   * which `PROTOCOL.md` §4 forbids branching on.
   */
  | 'suspended'
  /**
   * `403 {"error":"health-consent-required"}`: the instance asks every
   * account for a consent to health data, and this one does not hold its
   * current version (openplate-core `PROTOCOL.md` §5.15.1, 2026-09-29).
   *
   * A SEPARATE KIND for the reason `suspended` is one: it can land on any data
   * call, a sync cycle, a scan, a push subscription, and every one of them has
   * the same answer, the consent screen. Read as `forbidden` it became "Sync
   * failed" with the protocol token for a sentence. The `400` of the same code,
   * on signup and on the consent route itself, stays `invalid`: there the
   * answer is the checkbox on the screen already showing.
   */
  | 'consent-required'
  /** `404` — no such resource. Only an error where the protocol doesn't already give 404 a meaning. */
  | 'not-found'
  /** `409` — a duplicate account on signup. (Blob/key-record 409s are CAS outcomes and never reach here.) */
  | 'conflict'
  /** `413` — the blob exceeds `MAX_BLOB_BYTES`. The capacity cliff, reached. */
  | 'too-large'
  /** `429` — throttled. `retryAfterSeconds` carries the server's own advice. */
  | 'throttled'
  /** Network failure, DNS, CORS, or a non-JSON body. The service could not be reached or understood. */
  | 'transport'
  /** Any other non-2xx. Treated as retryable-but-unexplained. */
  | 'server';

export class SyncRequestError extends Error {
  readonly kind: SyncErrorKind;
  /** The HTTP status, when there was one. `null` for a transport failure that never got a response. */
  readonly status: number | null;
  /** From `Retry-After`, in seconds — only ever set on `throttled`. */
  readonly retryAfterSeconds: number | null;
  /**
   * The body's `error` token, or `null` when the body carried none.
   *
   * FOR A CALLER WHOSE SERVICE DOCUMENTS MACHINE CODES, and only that. The
   * sync protocol branches on the status (§4); the biller behind
   * `/v1/plans/*` is not the protocol and answers one 400 for several reasons
   * a page reacts to differently (`plans-wire.ts`, the order codes).
   */
  readonly code: string | null;

  constructor({
    kind,
    message,
    status = null,
    retryAfterSeconds = null,
    code = null,
  }: {
    kind: SyncErrorKind;
    message: string;
    status?: number | null;
    retryAfterSeconds?: number | null;
    code?: string | null;
  }) {
    super(message);
    this.name = 'SyncRequestError';
    this.kind = kind;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
    this.code = code;
  }
}

/**
 * The body text the service uses for a suspended account, transcribed from
 * M192's contract table.
 *
 * The ONE place a message is compared rather than a status. `403` alone cannot
 * carry the distinction — the same status also means "this invite is not
 * valid" and "this account has no AI allowance" — and the service documents
 * this exact token for exactly this purpose. It is read once, here, and turned
 * into a {@link SyncErrorKind} that everything downstream branches on.
 */
export const ACCOUNT_SUSPENDED_ERROR = 'account-suspended';

/**
 * The body text the service uses for a data route refused for want of the
 * consent to health data (openplate-core `PROTOCOL.md` §4.1), the second
 * documented token on a `403`.
 */
export const HEALTH_CONSENT_REQUIRED_ERROR = HEALTH_CONSENT_REQUIRED;

/** The kind of a `403`, read off the one field that can tell its three meanings apart. */
function forbiddenKind(errorText: string | undefined): SyncErrorKind {
  if (errorText === ACCOUNT_SUSPENDED_ERROR) return 'suspended';
  if (errorText === HEALTH_CONSENT_REQUIRED_ERROR) return 'consent-required';
  return 'forbidden';
}

/**
 * Maps a status code, and for the two documented tokens on a `403` the body,
 * onto a {@link SyncErrorKind}. The only place that mapping is written down.
 */
export function errorKindForStatus(status: number, errorText?: string): SyncErrorKind {
  if (status === 400) return 'invalid';
  if (status === 401) return 'unauthorized';
  if (status === 403) return forbiddenKind(errorText);
  if (status === 404) return 'not-found';
  if (status === 409) return 'conflict';
  if (status === 413) return 'too-large';
  if (status === 429) return 'throttled';
  return 'server';
}

/** Narrowing helper so call sites can branch without an `instanceof` dance in every `catch`. */
export function isSyncRequestError(cause: unknown): cause is SyncRequestError {
  return cause instanceof SyncRequestError;
}
