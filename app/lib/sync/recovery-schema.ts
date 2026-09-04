/**
 * The Conform/Zod schema for the mailed PASSWORD RESET form — the new password
 * and its confirmation, and nothing else.
 *
 * ── What M192 removed, and why the file kept its name ────────────────────
 *
 * It used to ask for a sign-in name AND a recovery code. Both are gone. The
 * reset token in the mailed link identifies the account, and the service hands
 * the client the escrowed recovery code when that token is spent — so there is
 * nothing left for a person to remember or to retype, which was the entire
 * point of the change.
 *
 * The file is still `recovery-schema.ts` because the CEREMONY underneath is
 * still the recovery one (`recoverSyncAccount`): the code proves the account
 * and unwraps the DEK. Renaming it to `reset-schema.ts` would suggest the
 * mailed reset of M128 came back, and that one restored a login to data it
 * could not open.
 *
 * The new passphrase IS held to the signup floor
 * ({@link validateSyncPassphrase}): this field is a person CHOOSING a
 * password, and the one it replaces protected data.
 */
import { z } from 'zod';
import { validateSyncPassphrase, type Translate } from './setup-flow';

/**
 * The reset schema.
 *
 * @param t - the caller's translator.
 * @returns a Zod object schema over the two raw form fields.
 */
export function makeSyncRecoverySchema(t: Translate) {
  return z
    .object({
      passphrase: z.string().default(''),
      confirmPassphrase: z.string().default(''),
    })
    .superRefine((value, ctx) => {
      const passphraseProblem = validateSyncPassphrase(value.passphrase, t);
      if (passphraseProblem !== null) {
        ctx.addIssue({ code: 'custom', path: ['passphrase'], message: passphraseProblem });
      }

      // Under CONFIRM, not under the passphrase: the field the person is asked
      // to change is the second one, and an error over the first reads as
      // "your password is wrong".
      if (value.passphrase !== value.confirmPassphrase) {
        ctx.addIssue({ code: 'custom', path: ['confirmPassphrase'], message: t('sync.setup.passphraseMismatch') });
      }
    });
}

/** The two raw field values a valid reset submission carries. */
export type SyncRecoveryValues = z.infer<ReturnType<typeof makeSyncRecoverySchema>>;
