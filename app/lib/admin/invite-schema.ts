/**
 * The invitation form's rules, in one place both the form and its test read.
 *
 * ── The address is the ONLY required field ───────────────────────────────
 *
 * Everything else has a default the service would apply anyway. Making a name
 * or an allowance mandatory would turn "invite Anna" into a small
 * configuration exercise, and the commonest invitation on any instance is the
 * ordinary one.
 *
 * ── The address rules are the sign-in form's ─────────────────────────────
 *
 * `describeEmailProblem` is shared deliberately: an administrator who types an
 * address that this form accepts and the sign-in form later refuses has minted
 * an invitation nobody can redeem, and nothing would say so until the person
 * wrote back.
 */
import { z } from 'zod';

import { describeEmailProblem } from '../sync/email';
import type { Translate } from '../sync/setup-flow';

/** What a new account starts with unless the administrator says otherwise. */
export const DEFAULT_INVITE_ALLOWANCE = 200;

/** How long a fresh link lasts by default, and the ceiling the service enforces. */
export const DEFAULT_INVITE_EXPIRY_DAYS = 7;
export const MAX_INVITE_EXPIRY_DAYS = 30;

/** A name is stored, not just shown, so it carries the service's own column bound. */
export const MAX_DISPLAY_NAME_LENGTH = 64;

export function makeInviteSchema(t: Translate) {
  return z
    .object({
      email: z.string().default(''),
      displayName: z.string().default(''),
      role: z.union([z.literal('admin'), z.literal('member')]).default('member'),
      dailyAiLimit: z.coerce.number().int().min(0).default(DEFAULT_INVITE_ALLOWANCE),
      expiresInDays: z.coerce.number().int().min(1).max(MAX_INVITE_EXPIRY_DAYS).default(DEFAULT_INVITE_EXPIRY_DAYS),
    })
    .superRefine((value, ctx) => {
      // EMPTINESS gets its own message, and only emptiness. The shared
      // `sync.email.required` says "the address you were invited at", which is
      // true on a sign-in form and wrong here: this administrator is typing
      // somebody else's address. Every OTHER rule is the shared one, so a
      // form that accepts an address the sign-in form later refuses cannot
      // exist.
      if (value.email.trim() === '') {
        ctx.addIssue({ code: 'custom', path: ['email'], message: t('admin.invite.emailRequired') });
        return;
      }
      const problem = describeEmailProblem(value.email, t);
      if (problem !== null) ctx.addIssue({ code: 'custom', path: ['email'], message: problem });
    });
}

/** The five values a valid invitation submission carries. */
export type InviteFormValues = z.infer<ReturnType<typeof makeInviteSchema>>;
