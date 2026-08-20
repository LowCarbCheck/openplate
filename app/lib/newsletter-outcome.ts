/**
 * What came back from the subscribe endpoint, as something the UI can render
 * (M146 spec 02).
 *
 * Pure and separate from the route so it is testable without an environment,
 * and so the FORM can import the type without importing anything server-side.
 * The endpoint's own vocabulary (`status: 'pending'`, `error: 'noConsent'`) is
 * translated here exactly once — a component branching on those raw strings
 * would couple the client bundle to another service's wire format.
 *
 * Nothing from the endpoint's body is ever rendered directly: every branch
 * resolves to a catalog key. An upstream error message is operator jargon at
 * best and untranslated at worst (DESIGN.md §10.3).
 */
import { z } from 'zod';

/** A finished attempt. `ok` decides whether the form is replaced or kept for a retry. */
export type NewsletterOutcome =
  | { ok: true; status: 'subscribed' | 'checkInbox' | 'alreadySubscribed' }
  | { ok: false; reason: 'invalidEmail' | 'noConsent' | 'invalidToken' | 'unavailable' };

/** The shapes the endpoint is known to answer with. Anything else falls through to `unavailable`. */
const responseBodySchema = z.object({
  status: z.string().optional(),
  error: z.string().optional(),
});

/**
 * Reads an endpoint response and maps it onto a {@link NewsletterOutcome}.
 *
 * Takes the `Response` itself rather than an already-decoded body, so the
 * parse happens at the I/O boundary, in one place: a body that isn't JSON, or
 * isn't the shape this endpoint documents, is simply "unavailable" — which is
 * the truth from the visitor's side — and no unvalidated value ever escapes
 * this function.
 */
export async function readNewsletterResponse(response: Response): Promise<NewsletterOutcome> {
  const parsed = responseBodySchema.safeParse(await response.json().catch(() => null));
  const status = parsed.success ? parsed.data.status : undefined;
  const error = parsed.success ? parsed.data.error : undefined;
  const httpStatus = response.status;

  if (status === 'pending' || status === 'subscribed') return { ok: true, status: 'subscribed' };
  if (status === 'check_inbox') return { ok: true, status: 'checkInbox' };
  if (status === 'already_subscribed') return { ok: true, status: 'alreadySubscribed' };

  if (error === 'noConsent') return { ok: false, reason: 'noConsent' };
  if (error === 'invalidToken') return { ok: false, reason: 'invalidToken' };
  if (error === 'invalidEmail') return { ok: false, reason: 'invalidEmail' };

  // A 4xx with no recognised code is far more likely to be the address than
  // the service; a 5xx, a network failure or an unparseable body is not
  // something the visitor can fix by editing anything.
  if (httpStatus >= 400 && httpStatus < 500) return { ok: false, reason: 'invalidEmail' };
  return { ok: false, reason: 'unavailable' };
}
