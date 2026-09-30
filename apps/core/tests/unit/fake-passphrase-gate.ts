/**
 * A `PassphraseGate` for the route tests, keyed by account id.
 *
 * It answers `matched` only for the one auth hash a test registered for an
 * account, and records every check, so a test can assert that a refused
 * request never reached the gate and that an accepted one did. The real
 * compare and throttle are `accounts/passphrase-gate.ts`, exercised end to end
 * by the integration suites.
 */
import type { PassphraseCheck, PassphraseGate } from '../../src/accounts/passphrase-gate.js';

export interface FakePassphraseGate extends PassphraseGate {
  /** The auth hash that matches, per account. An account absent here matches nothing. */
  readonly passphrases: Map<number, string>;
  /** Every check, in order. */
  readonly checks: Array<{ accountId: number; authHash: string }>;
}

/** The verifier the fake reports for a match. The routes pass it on, and never read it. */
export const FAKE_MATCHED_VERIFIER = 'f'.repeat(64);

export function createFakePassphraseGate(): FakePassphraseGate {
  const passphrases = new Map<number, string>();
  const checks: Array<{ accountId: number; authHash: string }> = [];
  return {
    passphrases,
    checks,
    async check(input): Promise<PassphraseCheck> {
      checks.push(input);
      return passphrases.get(input.accountId) === input.authHash
        ? { status: 'matched', verifier: FAKE_MATCHED_VERIFIER }
        : { status: 'rejected' };
    },
  };
}
