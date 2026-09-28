/**
 * The rate-limit rule for the landing page's newsletter subscribe proxy.
 *
 * ── Why the proxy needs one at all ───────────────────────────────────────
 *
 * `POST /?index` is public, unauthenticated, and forwards to an operator's
 * internal subscribe endpoint. Turnstile guards the BROWSER path, but a token
 * is only checked by the endpoint at the far end — this server forwards first
 * and asks questions never, so a script that skips the page entirely can drive
 * one HTTP hop into the internal service per request, indefinitely. A limit
 * here bounds that at the edge that is actually exposed.
 *
 * ── Why this file exists rather than a template literal in the route ─────
 *
 * The same reason `food-matches-rate-limit.server.ts` does: React Router v8
 * only strips server-only code from the `loader`/`action`/`middleware`/
 * `headers` exports, so anything reaching for `client-ip.server` from a route
 * module is a hazard the production build catches and `typecheck` does not —
 * and the unit tests need to compute the identical key in order to reset the
 * shared bucket between cases.
 *
 * @see app/routes/index.tsx — the sole production caller.
 */
import { getClientIp } from '#app/lib/client-ip.server';
import type { RateLimitOptions } from '#app/lib/rate-limit.server';

/**
 * Five submissions per minute per IP.
 *
 * Sized for a HUMAN who mistypes an address, gets it rejected, fixes it, and
 * has the challenge expire on them once in the middle — that is three or four
 * attempts in a bad minute. It is not sized to stop a botnet; it is sized so
 * that one client cannot become a load generator pointed at the internal
 * endpoint. Shared behind a NAT, five per minute is still far above what a
 * newsletter form sees.
 */
export const NEWSLETTER_RATE_LIMIT: RateLimitOptions = { windowMs: 60_000, max: 5 };

/**
 * Buckets by client IP, and only by that (M128 spec 03): there are no accounts,
 * so there is no per-caller identifier left to key on. Deliberately NOT keyed
 * by email address — that would let an attacker vary one field to get an
 * unlimited number of buckets, and it would make the limiter's own state a
 * list of the addresses people submitted.
 */
export function newsletterRateLimitKey(request: Request): string {
  return `newsletter:ip:${getClientIp(request)}`;
}
