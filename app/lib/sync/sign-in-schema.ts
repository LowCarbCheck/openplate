/**
 * The Conform/Zod schema for the sync SIGN-IN form — sign-in name and
 * passphrase.
 *
 * ── Why the passphrase is only checked for emptiness ─────────────────────
 *
 * The signup floor ({@link validateSyncPassphrase}, 12 characters) is a rule
 * about CHOOSING a passphrase, not about typing an existing one. Applying it
 * here would tell a person their own passphrase is too short, which is both
 * useless and wrong-headed: the only authority on whether it opens the account
 * is the account. So this form asks for a value and lets the service answer.
 *
 * The handle rules ARE applied, because they are shape rules the service
 * enforces at signup: no account can exist whose name contains `@` or runs
 * past the length bound, so a submission carrying one cannot succeed and is
 * better refused here than after a round trip.
 */
import { z } from 'zod';
import { describeHandleProblem } from './handle';
import type { Translate } from './setup-flow';

/**
 * The sign-in schema.
 *
 * @param t - the caller's translator.
 * @returns a Zod object schema over the two raw form fields.
 */
export function makeSyncSignInSchema(t: Translate) {
  return z
    .object({
      handle: z.string().default(''),
      passphrase: z.string().default(''),
    })
    .superRefine((value, ctx) => {
      // An EMPTY field gets its own sentence here. The signup copy ("choose a
      // sign-in name, or let us suggest one") belongs to a form with a suggest
      // button next to the box; on this one there is nothing to suggest, and
      // the name being asked for already exists.
      const handleProblem =
        value.handle.trim() === '' ? t('sync.signIn.handleRequired') : describeHandleProblem(value.handle, t);
      if (handleProblem !== null) ctx.addIssue({ code: 'custom', path: ['handle'], message: handleProblem });

      if (value.passphrase === '') {
        ctx.addIssue({ code: 'custom', path: ['passphrase'], message: t('sync.signIn.passphraseRequired') });
      }
    });
}

/** The two raw field values a valid sign-in submission carries. */
export type SyncSignInValues = z.infer<ReturnType<typeof makeSyncSignInSchema>>;
