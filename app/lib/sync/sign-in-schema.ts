/**
 * The Conform/Zod schema for the sync SIGN-IN form — email address and
 * password.
 *
 * ── Why the passphrase is only checked for emptiness ─────────────────────
 *
 * The signup floor ({@link validateSyncPassphrase}, 12 characters) is a rule
 * about CHOOSING a passphrase, not about typing an existing one. Applying it
 * here would tell a person their own passphrase is too short, which is both
 * useless and wrong-headed: the only authority on whether it opens the account
 * is the account. So this form asks for a value and lets the service answer.
 *
 * The ADDRESS rules ARE applied, because they are shape rules the service
 * enforces: no account can exist at a value with no `@`, so a submission
 * carrying one cannot succeed and is better refused here than after a round
 * trip.
 */
import { z } from 'zod';
import { describeEmailProblem } from './email';
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
      email: z.string().default(''),
      passphrase: z.string().default(''),
    })
    .superRefine((value, ctx) => {
      const emailProblem = describeEmailProblem(value.email, t);
      if (emailProblem !== null) ctx.addIssue({ code: 'custom', path: ['email'], message: emailProblem });

      if (value.passphrase === '') {
        ctx.addIssue({ code: 'custom', path: ['passphrase'], message: t('sync.signIn.passphraseRequired') });
      }
    });
}

/** The two raw field values a valid sign-in submission carries. */
export type SyncSignInValues = z.infer<ReturnType<typeof makeSyncSignInSchema>>;
