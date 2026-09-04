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

  constructor({
    kind,
    message,
    status = null,
    retryAfterSeconds = null,
  }: {
    kind: SyncErrorKind;
    message: string;
    status?: number | null;
    retryAfterSeconds?: number | null;
  }) {
    super(message);
    this.name = 'SyncRequestError';
    this.kind = kind;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
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
 * Maps a status code, and for one documented token the body, onto a
 * {@link SyncErrorKind}. The only place that mapping is written down.
 */
export function errorKindForStatus(status: number, errorText?: string): SyncErrorKind {
  if (status === 400) return 'invalid';
  if (status === 401) return 'unauthorized';
  if (status === 403) return errorText === ACCOUNT_SUSPENDED_ERROR ? 'suspended' : 'forbidden';
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
