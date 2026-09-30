/**
 * The rate-limit bucket key for `/api/food-proposals` (M251/04).
 *
 * Its own module for the reason `food-matches-rate-limit.server.ts` gives: a
 * route file may export only `loader`, `action`, `middleware` and `headers`
 * past a `.server` import, and the unit test needs the same key to reset the
 * shared bucket.
 *
 * @see app/routes/api.food-proposals.ts, the sole production caller.
 */
import { getClientRateLimitBucket } from '#app/lib/client-ip.server';

/** Buckets by client address, an IPv6 address by its /64 network, as `/api/food-matches` does. */
export function foodProposalsRateLimitKey(request: Request): string {
  return `food-proposals:ip:${getClientRateLimitBucket(request)}`;
}
