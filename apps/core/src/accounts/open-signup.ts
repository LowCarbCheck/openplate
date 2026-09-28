/**
 * The open sign-up door as data: what `POST /v1/auth/signup-request` needs to
 * exist, and the bounds it runs under (M253).
 *
 * THE DOOR IS AN INVITE A PERSON MAILS TO THEMSELVES. The handler
 * (`handleSignupRequest` in `auth-handlers.ts`) mints an ordinary addressed
 * invite with the operator's own mint code and mails it. Nothing about signup,
 * invite lookup or redemption changes: the mailed link is the address check,
 * exactly as it is for an invitation an operator sends.
 *
 * FOUR BOUNDS, and each one answers a different attack:
 *  - per source address, five requests an hour, counted on every attempt: one
 *    script on one machine;
 *  - the captcha, when the operator configured one: one script on many
 *    machines;
 *  - the refused throwaway domains: a trial per ten-minute mailbox;
 *  - one letter per mailbox per day, keyed on the trial key so dots and tags
 *    do not multiply it: somebody filling a stranger's inbox.
 *
 * WHAT THE PERSON PICKED REACHES THE LETTER AND NOWHERE ELSE. A paid instance
 * shows its price before sign-up, so the request may name a plan and the
 * language the person asked in ({@link SignupIntent}). Both ride in the mailed
 * link, and the language also picks the words the letter is written in.
 * Neither is stored, and neither changes the answer: an unknown value is
 * dropped without a word, so the field can never be a `400` or tell a caller
 * anything.
 */
import type { InviteStore } from '../admin/invite-store.js';
import type { JsonObject, JsonValue } from '../lib/json.js';
import type { ThrottleConfig, ThrottleStore } from '../lib/throttle.js';
import { isInstanceLanguage, type InstanceLanguage } from '../protocol.js';
import type { CaptchaVerifier } from './captcha.js';

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * Five requests per source address per hour; the sixth is a `429`.
 *
 * `freeAttempts: 4` IS FIVE REQUESTS, and the off-by-one is the throttle's,
 * not a typo. The route checks the bucket, then records the attempt: the
 * fifth recorded attempt locks it, so the fifth request is answered and the
 * sixth finds the lock. The lock lasts an hour and the bucket forgets after an
 * hour of quiet.
 */
export const SIGNUP_REQUEST_IP_THROTTLE: ThrottleConfig = {
  freeAttempts: 4,
  baseLockoutMs: MS_PER_HOUR,
  maxLockoutMs: MS_PER_HOUR,
  attemptResetMs: MS_PER_HOUR,
};

/**
 * One letter per mailbox per day.
 *
 * `freeAttempts: 0`, so the first recorded request locks the bucket for a
 * day. A second request inside that day still answers `202` and sends
 * nothing: the answer must not depend on whether a letter went, or it would
 * say which addresses somebody else has asked about.
 */
export const SIGNUP_LETTER_THROTTLE: ThrottleConfig = {
  freeAttempts: 0,
  baseLockoutMs: MS_PER_DAY,
  maxLockoutMs: MS_PER_DAY,
  attemptResetMs: MS_PER_DAY,
};

/** The refusals this door names, as machine-shaped codes a client branches on. */
export const SIGNUP_REQUEST_REFUSALS = {
  /** The body's `email` is not an address. */
  emailInvalid: 'email-invalid',
  /** The address is at a throwaway mail service (`accounts/disposable-domains.ts`). */
  domainRefused: 'email-domain-refused',
  /** The captcha token is missing or Turnstile said no. The person solves it again. */
  captchaFailed: 'captcha-failed',
  /** Turnstile could not be asked. A `503`: the person retries later. */
  captchaUnavailable: 'captcha-unavailable',
} as const;

/**
 * The plans a person may pick before they ask, which are the keys of the
 * biller's catalogue. A key this list does not name is dropped, never refused.
 */
export const SIGNUP_PLAN_KEYS = ['monthly', 'yearly'] as const;

export type SignupPlanKey = (typeof SIGNUP_PLAN_KEYS)[number];

/**
 * What the person picked on the sign-up screen before they asked. It rides in
 * the mailed join link, as `plan` and `lang`, so the app they open from the
 * letter can carry on where they left off. `locale` also picks the language
 * the letter is written in; with none, it is written in the instance's
 * language.
 */
export interface SignupIntent {
  plan: SignupPlanKey | null;
  /** The language the person asked in, one of `INSTANCE_LANGUAGES`, or `null`. */
  locale: InstanceLanguage | null;
}

function isSignupPlanKey(value: JsonValue | undefined): value is SignupPlanKey {
  return SIGNUP_PLAN_KEYS.some((key) => key === value);
}

/**
 * Reads `plan` and `locale` off a request body. A missing value, `null`, a
 * wrong type and an unknown key all read as `null`, silently: the door answers
 * the same `202` whatever these fields say.
 */
export function readSignupIntent(fields: JsonObject): SignupIntent {
  return {
    plan: isSignupPlanKey(fields.plan) ? fields.plan : null,
    locale: isInstanceLanguage(fields.locale) ? fields.locale : null,
  };
}

/** What the redeemed account is granted. The instance's, never the caller's. */
export interface OpenSignupGrant {
  /** Written on the invite row and copied to the account at redemption. `TRIAL_DAILY_AI_LIMIT`, or `0`. */
  dailyAiLimit: number;
  /** `TRIAL_SCANS`, or `null` on an open instance that runs no scan trial (M253). */
  trialScans: number | null;
}

/**
 * What `POST /v1/auth/signup-request` needs to exist. Absent on the auth
 * context is the ordinary unknown-path 404, like every optional tree.
 */
export interface OpenSignupSurface {
  /** The operator's invite store, the same one the admin and member mints write through. */
  invites: InviteStore;
  grant: OpenSignupGrant;
  /** The captcha, or `null` on an instance that configured none. */
  captcha: CaptchaVerifier | null;
  /** One letter per mailbox per day, see {@link SIGNUP_LETTER_THROTTLE}. In memory, like every throttle here. */
  letters: ThrottleStore;
}
