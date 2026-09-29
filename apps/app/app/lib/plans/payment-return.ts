/**
 * THE RETURN FROM A PAYMENT, as a pure decision (2026-09-28).
 *
 * Stripe sends the browser back to `/settings/plan?checkout=success` before
 * the biller has necessarily heard about the payment: the webhook that records
 * the subscription is a separate delivery. So the page asks `GET /plans/me`
 * every {@link PAYMENT_POLL_INTERVAL_MS} until the plan is live, and after
 * {@link PAYMENT_POLL_DEADLINE_MS} says the payment went through and may take
 * a minute, with a way to ask again.
 *
 * The clock is an argument, so the last poll before the deadline and the
 * first one after it are ordinary test cases.
 */
import type { OnboardingGateOutcome } from '#app/lib/onboarding-gate';

/** How often the page asks for the plan while a payment is being confirmed. */
export const PAYMENT_POLL_INTERVAL_MS = 2_000;

/** How long it asks before it says the payment may take a minute. */
export const PAYMENT_POLL_DEADLINE_MS = 60_000;

/**
 * Where a payment return is.
 *
 * - `checking`: the plan is not live yet, and the page is still asking.
 * - `confirmed`: the biller holds a live subscription.
 * - `slow`: the deadline passed without one. The payment went through; the
 *   record of it has not arrived.
 */
export type PaymentConfirmation = 'checking' | 'confirmed' | 'slow';

/**
 * What one answered read means.
 *
 * @param input.isSubscribed - whether the standing read off this answer is
 *   `subscribed`. A failed read is `false`: it is one more poll, not an end.
 * @param input.elapsedMs - how long the page has been asking, this round.
 */
export function confirmationAfterRead({
  isSubscribed,
  elapsedMs,
}: {
  isSubscribed: boolean;
  elapsedMs: number;
}): PaymentConfirmation {
  if (isSubscribed) return 'confirmed';
  if (elapsedMs >= PAYMENT_POLL_DEADLINE_MS) return 'slow';
  return 'checking';
}

/**
 * Where the way on from a confirmed payment leads (M265/03).
 *
 * - `onboarding`: the questionnaire. A buyer who chose a plan on the pricing
 *   page pays before they answer it, so for them it comes now, before the
 *   diary whose targets it sets.
 * - `diary`: everybody else, among them an account that answered it long
 *   before it bought a plan. The onboarding gate still stands at the diary's
 *   door, so a device it would send elsewhere (a possible data loss) is sent
 *   there all the same.
 */
export type PaymentReturnDoor = 'onboarding' | 'diary';

/** The address behind each door. The diary's door is the dashboard, as it was before M265/03. */
export const PAYMENT_RETURN_HREF = {
  onboarding: '/onboarding',
  diary: '/dashboard',
} as const satisfies Record<PaymentReturnDoor, string>;

/**
 * The door for what the onboarding gate would answer on the way to the diary.
 *
 * Only `onboard` is the questionnaire's, and linking straight to it is exactly
 * what the gate would do (`resolveSignInDestination`). Every other answer
 * keeps the diary's door and lets the gate decide there: `recover` is a
 * question about lost data that this page must not answer with a wizard, and
 * `wait` is a session still reopening, which the page is never drawn during.
 *
 * @param gate - `readOnboardingGateKind()`.
 */
export function paymentReturnDoorFor(gate: OnboardingGateOutcome['kind']): PaymentReturnDoor {
  return gate === 'onboard' ? 'onboarding' : 'diary';
}
