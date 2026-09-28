/**
 * Finished invitations lose their address (2026-09-28, the pre-launch privacy audit).
 *
 * THE PROMISE. The hosted instance's privacy notice says an invitation's address is deleted once
 * the invitation is redeemed, revoked or expired. Nothing did that: a revoke is a stamp, a
 * redemption is a stamp, and an expired row simply stayed. Only an account deletion scrubbed the
 * rows about its mailbox (`deleteKeepingOnlyTheHash` in `account-store.ts`). This sweep keeps the
 * promise for every finished row.
 *
 * WHAT A FINISHED ROW KEEPS. The row itself stays, with its instants, its role, its allowance,
 * its inviter and its trial size: a member's lifetime cap counts rows, and the admin list and the
 * farming signal read them. What goes is what names a person: `email` (written as `''`, the value
 * the deletion scrub already writes, because the column is `NOT NULL`) and `display_name`.
 *
 * `trial_key` IS KEPT ON A REDEEMED ROW, and written first when it is missing. The one mailbox,
 * one trial rule (`trial-mailbox.ts`) asks one question: did a REDEEMED row with this keyed hash
 * carry a trial. The hash is an HMAC under `TRIAL_ADDRESS_PEPPER`, never the address. A row minted
 * before the column existed has `trial_key` NULL, and redemption used to hash its `email` when
 * needed; once the email is gone that is impossible, so the sweep hashes it before it scrubs. An
 * unredeemed row's key answers nothing, so a revoked or expired row loses it too.
 *
 * NO PEPPER, NO SCRUB OF REDEEMED ROWS. On an instance without `TRIAL_ADDRESS_PEPPER` the
 * re-invite rule (`hasRedeemedMemberInvite`) and the deletion path fall back to the redeemed row's
 * `email`, and there is no keyed hash to keep in its place. Scrubbing it there would let a member
 * re-invite an address that already spent an allowance. Revoked and expired rows are scrubbed on
 * every instance: no rule reads their address.
 *
 * A PENDING ROW IS NEVER TOUCHED: its address is where the letter goes and what the account will
 * be. `reissue` refuses a row whose address is gone, so an expired row cannot be revived empty.
 */
import { and, eq, isNotNull, isNull, lt, ne, or } from 'drizzle-orm';
import type { TrialAddressHasher } from '../accounts/trial-address.js';
import type { Database } from './client.js';
import { signupInvites } from './schema.js';

export interface ScrubFinishedInvitesInput {
  now: Date;
  /** The keyed mailbox hash, or `null` on an instance with no `TRIAL_ADDRESS_PEPPER`. */
  hashAddress: TrialAddressHasher | null;
}

/** Scrubs every finished invitation's address. Returns how many rows lost one. */
export async function scrubFinishedInvites(db: Database, input: ScrubFinishedInvitesInput): Promise<number> {
  const { now, hashAddress } = input;
  return db.transaction(async (tx): Promise<number> => {
    const hasAddress = ne(signupInvites.email, '');
    const isEnded = or(isNotNull(signupInvites.revokedAt), lt(signupInvites.expiresAt, now));
    const unredeemedAndEnded = and(hasAddress, isNull(signupInvites.redeemedAt), isEnded);

    const ended = await tx
      .update(signupInvites)
      .set({ email: '', displayName: null, trialKey: null })
      .where(unredeemedAndEnded)
      .returning({ id: signupInvites.id });

    if (hashAddress === null) return ended.length;

    // The keyed hash first, for the redeemed rows minted before `trial_key` existed.
    const unkeyed = await tx
      .select({ id: signupInvites.id, email: signupInvites.email })
      .from(signupInvites)
      .where(and(hasAddress, isNotNull(signupInvites.redeemedAt), isNull(signupInvites.trialKey)));
    for (const row of unkeyed) {
      await tx.update(signupInvites).set({ trialKey: hashAddress(row.email) }).where(eq(signupInvites.id, row.id));
    }

    const redeemed = await tx
      .update(signupInvites)
      .set({ email: '', displayName: null })
      .where(and(hasAddress, isNotNull(signupInvites.redeemedAt)))
      .returning({ id: signupInvites.id });

    return ended.length + redeemed.length;
  });
}
