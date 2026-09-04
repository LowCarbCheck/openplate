/**
 * Classifies why redeeming an invite into an account failed, so the form can
 * say something true rather than "check your details".
 *
 * ── Why this is separate from `sign-in-error.ts` ──────────────────────────
 *
 * They map the SAME statuses onto different meanings. `POST /v1/auth/login`
 * answers `401` for a wrong address or a wrong password and nothing else. On
 * `POST /v1/auth/signup` a `403` means the invite is not valid, and a `409`
 * means the invited address already has an account. One function covering both
 * would have to guess which endpoint it was called for.
 *
 * ── The 403 needs no mode any more (M192) ────────────────────────────────
 *
 * It used to take `signupMode` as a second argument, because the same `403`
 * covered "this instance is closed" and "this instance wants an invite", and
 * the status alone could not say which. Protocol 2 has one way in, so the
 * ambiguity is gone: a `403` on signup is an invite that is missing, unknown,
 * expired, revoked or already spent — deliberately indistinguishable from each
 * other, because telling them apart would let a caller probe which tokens
 * exist — and every one of them is answered by the same sentence, "ask for a
 * new invitation".
 */
import { SyncRequestError } from './engine/client/sync-error';

export type SignupFailure =
  /** `403` — the invite is missing, or is not (or no longer) valid. One outcome, by design. */
  | 'invite-required'
  /**
   * `409` — the invited address already has an account here.
   *
   * The ONE accepted enumeration oracle on this service, and it is narrower
   * than it looks: only somebody holding a live invite can reach it, and the
   * address it discloses is the one written on the invite they are holding.
   */
  | 'account-exists'
  /** `403 account-suspended` — the invited address has a suspended account. Not a signup problem to solve on this form. */
  | 'suspended'
  /** Anything else: transport, an incompatible service, a malformed request. Show what it said. */
  | 'other';

/** @param cause - anything the signup call threw. */
export function classifySignupFailure(cause: unknown): SignupFailure {
  if (!(cause instanceof SyncRequestError)) return 'other';
  if (cause.kind === 'conflict') return 'account-exists';
  if (cause.kind === 'suspended') return 'suspended';
  if (cause.kind === 'forbidden') return 'invite-required';
  return 'other';
}
