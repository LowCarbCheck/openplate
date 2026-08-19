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
import { getClientIp } from '#app/lib/client-ip.server';

/**
 * Buckets by client IP, and only by that (M128 spec 03): there are no accounts,
 * so there is no per-caller identifier left to key on. One named place for the
 * rule, rather than an inline template literal the tests would have to
 * re-derive by hand and then drift from.
 */
export function foodMatchesRateLimitKey(request: Request): string {
  return `food-matches:ip:${getClientIp(request)}`;
}
