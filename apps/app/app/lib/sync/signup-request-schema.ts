/**
 * The sign-up form's one rule, and what its refusals mean (M253/02).
 *
 * THE ADDRESS RULES ARE THE SIGN-IN FORM'S, through `describeEmailProblem`,
 * for the reason `invite-schema.ts` gives: an address this form accepts and
 * the sign-in form later refuses is a letter nobody can use. Only EMPTINESS
 * has its own sentence, because the shared one speaks of an address somebody
 * "was invited at", and nobody invited this person.
 */
import { z } from 'zod';

import { describeEmailProblem } from './email';
import {
  SIGNUP_CAPTCHA_FAILED,
  SIGNUP_CAPTCHA_UNAVAILABLE,
  SIGNUP_EMAIL_DOMAIN_REFUSED,
  SIGNUP_EMAIL_INVALID,
} from './engine/client/auth-wire';
import { isSyncRequestError } from './engine/client/sync-error';
import type { Translate } from './setup-flow';

/** The schema for `/sign-up`'s form. */
export function makeSignupRequestSchema(t: Translate) {
  return z.object({ email: z.string().default('') }).superRefine((value, ctx) => {
    if (value.email.trim() === '') {
      ctx.addIssue({ code: 'custom', path: ['email'], message: t('signUp.emailRequired') });
      return;
    }
    const problem = describeEmailProblem(value.email, t);
    if (problem !== null) ctx.addIssue({ code: 'custom', path: ['email'], message: problem });
  });
}

/**
 * What a failed sign-up request asks the person to do.
 *
 * - `wait`: the service throttled this source; `minutes` is its own advice,
 *   rounded up, or `null` when it gave none.
 * - `captcha`: the challenge was refused; a new one may pass.
 * - `captcha-unavailable`: the service could not ask the challenge provider; later may pass.
 * - `email`: the service refused the address itself.
 * - `domain`: the service takes no sign-ups from that domain.
 * - `failed`: anything else, including an unreachable service.
 */
export type SignupProblem =
  | { kind: 'wait'; minutes: number | null }
  | { kind: 'captcha' }
  | { kind: 'captcha-unavailable' }
  | { kind: 'email' }
  | { kind: 'domain' }
  | { kind: 'failed' };

const SECONDS_PER_MINUTE = 60;

/**
 * Reads a thrown sign-up failure. PURE, so each branch has a test with a
 * control. The codes are the documented `error` tokens, never the prose
 * (`PROTOCOL.md` §4).
 */
export function describeSignupFailure(cause: unknown): SignupProblem {
  if (!isSyncRequestError(cause)) return { kind: 'failed' };
  if (cause.kind === 'throttled') {
    const seconds = cause.retryAfterSeconds;
    const hasAdvice = seconds !== null && Number.isFinite(seconds) && seconds > 0;
    return { kind: 'wait', minutes: hasAdvice ? Math.ceil(seconds / SECONDS_PER_MINUTE) : null };
  }
  if (cause.code === SIGNUP_CAPTCHA_FAILED) return { kind: 'captcha' };
  if (cause.code === SIGNUP_CAPTCHA_UNAVAILABLE) return { kind: 'captcha-unavailable' };
  if (cause.code === SIGNUP_EMAIL_INVALID) return { kind: 'email' };
  if (cause.code === SIGNUP_EMAIL_DOMAIN_REFUSED) return { kind: 'domain' };
  return { kind: 'failed' };
}
