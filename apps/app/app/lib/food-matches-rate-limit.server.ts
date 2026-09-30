/**
 * The rate-limit bucket key for `/api/food-matches`.
 *
 * WHY IT ISN'T JUST AN EXPORT ON THE ROUTE: React Router v8's split route
 * modules only strip server-only code from the `loader`, `action`, `middleware`
 * and `headers` exports. Any OTHER export from a route file that (transitively)
 * imports a `.server` module fails the production client build — `pnpm build`
 * catches it, `pnpm dev` and `pnpm typecheck` do not. This function needs
 * `client-ip.server`, and the unit tests need to compute the same key in order
 * to reset the shared bucket, so it lives here rather than next to the action.
 *
 * @see app/routes/api.food-matches.ts — the sole production caller.
 */
import { getClientRateLimitBucket } from '#app/lib/client-ip.server';

/**
 * Buckets by client address, and an IPv6 address by its /64 network (see
 * `rateLimitAddressBucket`). One named place for the rule, rather than an
 * inline template literal the tests would have to re-derive by hand and then
 * drift from.
 *
 * STILL BY ADDRESS ON A MANAGED INSTANCE, where every caller carries an
 * account token: the account check in front of this limiter decides WHO may
 * search, this bucket decides how fast one network may, and the daily cap
 * (`food-db-daily-budget.server.ts`) is what bounds the instance as a whole.
 */
export function foodMatchesRateLimitKey(request: Request): string {
  return `food-matches:ip:${getClientRateLimitBucket(request)}`;
}
