/**
 * The Conform/Zod schema for the sync SIGNUP form — invite, sign-in name,
 * passphrase, confirm.
 *
 * ── Why a schema and not four `if`s in the component ─────────────────────
 *
 * The four checks used to run one after another in `handleDetailsSubmit`, and
 * the first one to fail became a single red sentence above the submit button.
 * That is one error at a time, attached to nothing: a person who left the name
 * empty AND mistyped the confirmation was told about the name, fixed it,
 * submitted again, and only then learned about the second. A schema reports
 * every problem at once, and Conform puts each one under the field it belongs
 * to (owner request, 2026-09-02).
 *
 * ── It owns no rules ─────────────────────────────────────────────────────
 *
 * Every bound here is borrowed: the handle rules from `handle.ts`
 * ({@link describeHandleProblem}, which is also what the service enforces),
 * the passphrase floor from `setup-flow.ts`
 * ({@link validateSyncPassphrase}), and the invite's shape from
 * `invite-link.ts` ({@link isSyncInviteToken}). All this file adds is the
 * mapping from a broken rule to the FIELD that broke it.
 *
 * Built per call rather than held as a module constant, like
 * `#app/lib/body-metrics-schema`: the messages are copy, so they have to
 * resolve against the ACTIVE language, which isn't known at module-eval time.
 */
import { z } from 'zod';
import { describeHandleProblem } from './handle';
import { SYNC_INVITE_PREFIX, isSyncInviteToken } from './invite-link';
import { validateSyncPassphrase, type Translate } from './setup-flow';

/**
 * How much the instance cares about an invite.
 *
 * - `none` — no invite field is rendered, and nothing is checked.
 * - `optional` — a field is offered (a link supplied a code, or the instance's
 *   signup mode could not be read) and only a NON-EMPTY value is shape-checked.
 * - `required` — the service answers `403` without one, so an empty field is
 *   worth saying so before the round trip.
 */
export type SyncInviteRule = 'none' | 'optional' | 'required';

/**
 * The signup schema.
 *
 * @param t - the caller's translator.
 * @param options - whether an invite is offered, and whether it is demanded.
 * @returns a Zod object schema over the four raw form fields.
 */
export function makeSyncSignupSchema(t: Translate, { invite }: { invite: SyncInviteRule }) {
  return z
    .object({
      // Absent from the FormData whenever the field isn't rendered, so every
      // field defaults rather than failing with zod's own untranslated
      // "required" copy.
      invite: z.string().default(''),
      handle: z.string().default(''),
      passphrase: z.string().default(''),
      confirmPassphrase: z.string().default(''),
    })
    .superRefine((value, ctx) => {
      const handleProblem = describeHandleProblem(value.handle, t);
      if (handleProblem !== null) ctx.addIssue({ code: 'custom', path: ['handle'], message: handleProblem });

      const passphraseProblem = validateSyncPassphrase(value.passphrase, t);
      if (passphraseProblem !== null) {
        ctx.addIssue({ code: 'custom', path: ['passphrase'], message: passphraseProblem });
      }

      // Under CONFIRM, not under the passphrase: the field the person is asked
      // to change is the second one, and an error over the first reads as
      // "your passphrase is wrong".
      if (value.passphrase !== value.confirmPassphrase) {
        ctx.addIssue({ code: 'custom', path: ['confirmPassphrase'], message: t('sync.setup.passphraseMismatch') });
      }

      const inviteProblem = describeInviteProblem(value.invite, { rule: invite, t });
      if (inviteProblem !== null) ctx.addIssue({ code: 'custom', path: ['invite'], message: inviteProblem });
    });
}

/** The four raw field values a valid signup submission carries. */
export type SyncSignupValues = z.infer<ReturnType<typeof makeSyncSignupSchema>>;

/**
 * Why an invite value was refused, or `null` when there is nothing to say.
 *
 * The PREFIX check is a courtesy in the same sense the handle's `@` rule is:
 * only the service can tell whether a code is live, but "that is not an invite
 * code at all" is knowable here, and it is the answer for the commonest paste
 * mistake — the surrounding link text, or a code from a different product.
 */
function describeInviteProblem(raw: string, { rule, t }: { rule: SyncInviteRule; t: Translate }): string | null {
  if (rule === 'none') return null;
  const value = raw.trim();
  if (value === '') return rule === 'required' ? t('sync.create.inviteMissing') : null;
  if (!isSyncInviteToken(value)) return t('sync.create.inviteMalformed', { prefix: SYNC_INVITE_PREFIX });
  return null;
}
