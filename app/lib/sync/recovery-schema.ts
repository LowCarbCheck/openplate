/**
 * The Conform/Zod schema for the sync RECOVERY form — sign-in name, recovery
 * code, and the new passphrase it sets.
 *
 * The new passphrase IS held to the signup floor
 * ({@link validateSyncPassphrase}): unlike the sign-in form, this field is a
 * person choosing a passphrase, and the one this replaces protected data that
 * nobody can recover for them.
 *
 * The recovery code is only checked for emptiness. Its grouping and
 * capitalisation are forgiving by design (`sync.recover.codeHint`), and
 * whether a given code belongs to a given account is a question only the
 * service can answer — deliberately with one indistinguishable `401`, so this
 * form cannot be used to find out which half was wrong.
 */
import { z } from 'zod';
import { describeHandleProblem } from './handle';
import { validateSyncPassphrase, type Translate } from './setup-flow';

/**
 * The recovery schema.
 *
 * @param t - the caller's translator.
 * @returns a Zod object schema over the three raw form fields.
 */
export function makeSyncRecoverySchema(t: Translate) {
  return z
    .object({
      handle: z.string().default(''),
      recoveryCode: z.string().default(''),
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

      if (value.recoveryCode.trim() === '') {
        ctx.addIssue({ code: 'custom', path: ['recoveryCode'], message: t('sync.recover.codeRequired') });
      }

      const passphraseProblem = validateSyncPassphrase(value.passphrase, t);
      if (passphraseProblem !== null) {
        ctx.addIssue({ code: 'custom', path: ['passphrase'], message: passphraseProblem });
      }
    });
}

/** The three raw field values a valid recovery submission carries. */
export type SyncRecoveryValues = z.infer<ReturnType<typeof makeSyncRecoverySchema>>;
