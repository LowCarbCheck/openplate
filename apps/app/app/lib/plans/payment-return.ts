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
