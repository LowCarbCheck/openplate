/**
 * The escrow half of the move, proven in memory before anything is written.
 *
 * AFTER THE SWITCH THE TARGET RUNS WITH THE SOURCE'S `SERVER_SECRET`, so:
 *
 *  - a MOVED account's escrow must open under the source key, which becomes
 *    the target's. It is copied unchanged; this only proves it will work.
 *  - a RESIDENT account (one that already lives on the target) was sealed
 *    under the target's OLD key. It is opened with that key, sealed again under
 *    the new one, opened again to prove the new seal, and its
 *    `recovery_verifier` is recomputed under the new pepper from the same code
 *    (`lib/recovery-auth.ts`). Its password `verifier` cannot be recomputed,
 *    because the server never holds the auth hash, so the person behind it
 *    needs one mailed reset after the switch, and the report says so.
 *
 * ONLY CORE'S OWN ESCROW FUNCTIONS TOUCH A SEALED VALUE (`lib/escrow.ts`).
 * The code exists in memory between an open and a seal and is never returned,
 * logged or put in a reason string.
 *
 * The resident proof also checks the recovery verifier the row ALREADY holds
 * against the code under the OLD pepper. On a real account that is the port's
 * proof on real data: if the server-side derivation disagreed with the app's,
 * that comparison fails before the new value is written.
 */
import { openRecoveryCode, sealRecoveryCode } from '../lib/escrow.js';
import { computeRecoveryVerifier } from '../lib/recovery-auth.js';
import type { ServerSecrets } from '../lib/server-secrets.js';
import { verifierMatches } from '../lib/verifier.js';

/** The escrow columns of one account row. */
export interface EscrowColumns {
  readonly sealed: Buffer | null;
  readonly recoveryVerifier: string | null;
}

export type SourceEscrowProof =
  | { readonly kind: 'opens'; readonly recoveryVerifierMatches: boolean }
  | { readonly kind: 'fails'; readonly reason: string };

export type ResidentEscrowProof =
  /** Opens under the old key: re-seal, with the new values and the old ones the write compares against. */
  | {
      readonly kind: 'reseal';
      readonly next: { sealed: Buffer; recoveryVerifier: string };
      readonly previous: EscrowColumns;
    }
  /** Already opens under the new key with a matching verifier: a previous run re-sealed it. */
  | { readonly kind: 'already-resealed' }
  | { readonly kind: 'fails'; readonly reason: string };

/** The code, or `null` when this key does not open the value. `openRecoveryCode` throws on a wrong key by design. */
function tryOpen(input: { sealed: Buffer; escrowKey: Buffer }): string | null {
  try {
    return openRecoveryCode({ sealed: input.sealed, escrowKey: input.escrowKey });
  } catch {
    return null;
  }
}

function recoveryVerifierHolds(input: { code: string; stored: string | null; pepper: string }): boolean {
  if (input.stored === null) return false;
  return verifierMatches({
    candidate: computeRecoveryVerifier({ code: input.code, pepper: input.pepper }),
    stored: input.stored,
  });
}

/** A moved account: its escrow must open under the source key, which the target adopts. */
export function proveSourceEscrow(input: { escrow: EscrowColumns; source: ServerSecrets }): SourceEscrowProof {
  if (input.escrow.sealed === null) return { kind: 'fails', reason: 'the account has no escrowed recovery code' };
  const code = tryOpen({ sealed: input.escrow.sealed, escrowKey: input.source.escrowKey });
  if (code === null) return { kind: 'fails', reason: 'the escrow does not open under SOURCE_SERVER_SECRET' };
  return {
    kind: 'opens',
    recoveryVerifierMatches: recoveryVerifierHolds({
      code,
      stored: input.escrow.recoveryVerifier,
      pepper: input.source.verifierPepper,
    }),
  };
}

function resealUnderNewKey(input: { code: string; previous: EscrowColumns; next: ServerSecrets }): ResidentEscrowProof {
  const sealed = sealRecoveryCode({ code: input.code, escrowKey: input.next.escrowKey });
  if (tryOpen({ sealed, escrowKey: input.next.escrowKey }) !== input.code) {
    return { kind: 'fails', reason: 'the new seal does not open again under SOURCE_SERVER_SECRET' };
  }
  const recoveryVerifier = computeRecoveryVerifier({ code: input.code, pepper: input.next.verifierPepper });
  return { kind: 'reseal', next: { sealed, recoveryVerifier }, previous: input.previous };
}

/**
 * A resident account: opens under the old key and re-seals under the new
 * one, or proves a previous run already did.
 */
export function proveResidentEscrow(input: {
  escrow: EscrowColumns;
  previous: ServerSecrets;
  next: ServerSecrets;
}): ResidentEscrowProof {
  const { sealed, recoveryVerifier } = input.escrow;
  if (sealed === null) return { kind: 'fails', reason: 'the account has no escrowed recovery code to re-seal' };

  const isSameKey = input.previous.escrowKey.equals(input.next.escrowKey);
  const oldCode = isSameKey ? null : tryOpen({ sealed, escrowKey: input.previous.escrowKey });
  if (oldCode !== null) {
    if (!recoveryVerifierHolds({ code: oldCode, stored: recoveryVerifier, pepper: input.previous.verifierPepper })) {
      return {
        kind: 'fails',
        reason: 'the stored recovery verifier does not match the escrowed code under TARGET_OLD_SERVER_SECRET',
      };
    }
    return resealUnderNewKey({ code: oldCode, previous: input.escrow, next: input.next });
  }

  const newCode = tryOpen({ sealed, escrowKey: input.next.escrowKey });
  if (newCode === null) {
    return {
      kind: 'fails',
      reason: 'the escrow opens under neither TARGET_OLD_SERVER_SECRET nor SOURCE_SERVER_SECRET',
    };
  }
  if (!recoveryVerifierHolds({ code: newCode, stored: recoveryVerifier, pepper: input.next.verifierPepper })) {
    return { kind: 'fails', reason: 'the escrow is under SOURCE_SERVER_SECRET but its recovery verifier is not' };
  }
  return { kind: 'already-resealed' };
}

/**
 * Whether a row's escrow opens under these secrets AND its recovery verifier
 * matches the code under their pepper: the state a re-sealed row must read
 * back in, checked inside the transaction that wrote it.
 */
export function escrowHoldsUnder(input: { escrow: EscrowColumns; secrets: ServerSecrets }): boolean {
  if (input.escrow.sealed === null) return false;
  const code = tryOpen({ sealed: input.escrow.sealed, escrowKey: input.secrets.escrowKey });
  if (code === null) return false;
  return recoveryVerifierHolds({ code, stored: input.escrow.recoveryVerifier, pepper: input.secrets.verifierPepper });
}
