/**
 * The passphrase check for the SYNC routes that must not trust a bearer token
 * alone: `POST /v1/sync/rotate-dek` and a key-record overwrite
 * (`PUT /v1/sync/key-records/:kind` with a non-null `expectedUpdatedAt`).
 *
 * WHY A TOKEN IS NOT ENOUGH THERE. Both write material that decides who can
 * open or recover the account. Until this existed, rotate-dek wrote a new
 * recovery verifier and escrow on a bearer token alone, and
 * `POST /v1/auth/recover` then handed whoever held that token a session for as
 * long as they liked, after the owner had changed their passphrase. A token
 * left on a shared device or lifted from a log became a permanent takeover.
 * So these routes ask for the current passphrase's auth branch
 * (`currentAuthHash`), exactly as `POST /v1/auth/change-passphrase` does.
 *
 * THE SAME COMPARE `handleChangePassphrase` USES: one `computeVerifier` under
 * the instance pepper, one constant-time `verifierMatches` against
 * `accounts.verifier`. The matched verifier is returned, so a writer that
 * cares (rotate-dek) can compare-and-swap on it inside its own transaction.
 *
 * THROTTLED PER ACCOUNT, in one bucket the auth routes share
 * (`register-auth-routes.ts`: change-passphrase and delete). All four accept a
 * guess at the same secret from a caller who already holds a token, so a
 * separate allowance per route would multiply the guesses a stolen token buys.
 * A match clears the bucket; a miss records a failure; an absent account is a
 * refusal that records nothing, because there is nothing left to guess at.
 */
import type { Response } from 'express';
import type { AccountStore } from './account-store.js';
import { computeVerifier, verifierMatches } from '../lib/verifier.js';
import { accountThrottleKey, type ThrottleStore } from '../lib/throttle.js';

/** The one bucket every passphrase-checking bearer route spends from. */
export const PASSPHRASE_THROTTLE_NAMESPACE = 'passphrase';

/**
 * The body text of a wrong `currentAuthHash`, on every route that checks one.
 * The same bytes `POST /v1/auth/change-passphrase` has always sent, so a client
 * recognises one refusal wherever it meets it.
 */
export const PASSPHRASE_REJECTED = 'current passphrase is incorrect';

export type PassphraseCheck =
  { status: 'matched'; verifier: string } | { status: 'rejected' } | { status: 'throttled'; retryAfterMs: number };

export interface PassphraseGate {
  check(input: { accountId: number; authHash: string }): Promise<PassphraseCheck>;
}

export interface PassphraseGateOptions {
  store: Pick<AccountStore, 'findAccountById'>;
  pepper: string;
  throttle: ThrottleStore;
}

/** The bucket for one account's passphrase guesses. */
export function passphraseThrottleKey(accountId: number): string {
  return accountThrottleKey({ namespace: PASSPHRASE_THROTTLE_NAMESPACE, accountId });
}

export function createPassphraseGate(options: PassphraseGateOptions): PassphraseGate {
  return {
    async check(input) {
      const key = passphraseThrottleKey(input.accountId);
      const decision = options.throttle.check(key);
      if (decision.locked) return { status: 'throttled', retryAfterMs: decision.retryAfterMs };

      const account = await options.store.findAccountById(input.accountId);
      if (account === null) return { status: 'rejected' };

      const candidate = computeVerifier({ authHash: input.authHash, pepper: options.pepper });
      if (!verifierMatches({ candidate, stored: account.verifier })) {
        options.throttle.recordFailure(key);
        return { status: 'rejected' };
      }
      options.throttle.clear(key);
      return { status: 'matched', verifier: account.verifier };
    },
  };
}

/**
 * `429` with a `Retry-After` in whole seconds, rounded up so a client never
 * retries a millisecond too early. The same wire shape every throttled auth
 * route sends.
 */
export function sendThrottled(res: Response, retryAfterMs: number): void {
  const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  res.setHeader('Retry-After', String(retryAfterSeconds));
  res.status(429).json({ error: `too many attempts; try again in ${retryAfterSeconds}s` });
}

/** Answers a check that did not match: `429` when throttled, `401` with {@link PASSPHRASE_REJECTED} otherwise. */
export function sendPassphraseRefusal(res: Response, check: Exclude<PassphraseCheck, { status: 'matched' }>): void {
  if (check.status === 'throttled') {
    sendThrottled(res, check.retryAfterMs);
    return;
  }
  res.status(401).json({ error: PASSPHRASE_REJECTED });
}
