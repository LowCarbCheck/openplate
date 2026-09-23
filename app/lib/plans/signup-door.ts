/**
 * WHETHER A PERSON MAY ASK THIS INSTANCE FOR AN ACCOUNT (M253/02).
 *
 * The sibling of `plans-door.ts`, and it follows the same rule: one fact, read
 * from the handshake, never from a probe. `POST /v1/auth/signup-request`
 * answers the ordinary unknown-path `404` on an invite-only instance, so asking
 * the path would learn nothing a missing route does not already say.
 *
 * `null` MEANS INVITE-ONLY. An unreachable service, a malformed body, a core
 * older than the field and a read still in flight all answer `false` here.
 * Unknown must not offer a form that dead-ends, and the invite-only wording is
 * true of every one of those instances today.
 */
import type { InstanceDescriptor, SignupCaptcha } from '#app/lib/sync/engine/protocol';

/** Whether this instance takes sign-up requests. The one reader of `instance.openSignup`. */
export function hasOpenSignup(instance: InstanceDescriptor | null): boolean {
  return instance?.openSignup === true;
}

/**
 * How many free AI scans a new account starts with, or `null` when the
 * instance promises none. The number on screen comes from here and nowhere
 * else, so no string ever types it.
 */
export function offeredTrialScans(instance: InstanceDescriptor | null): number | null {
  return instance?.trial?.scans ?? null;
}

/**
 * The challenge the sign-up form must carry, or `null` for none. Read only
 * where the door is open: a key on an invite-only instance has no form to sit in.
 */
export function signupCaptchaOf(instance: InstanceDescriptor | null): SignupCaptcha | null {
  if (!hasOpenSignup(instance)) return null;
  return instance?.signupCaptcha ?? null;
}
