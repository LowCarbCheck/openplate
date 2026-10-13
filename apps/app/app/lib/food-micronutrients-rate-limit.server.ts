/**
 * The rate-limit bucket key for `/api/food-micronutrients` (the micronutrient
 * backfill, 2026-10-13).
 *
 * Its own module for the reason `food-matches-rate-limit.server.ts` gives: a
 * route file may export only `loader`, `action`, `middleware` and `headers`
 * past a `.server` import, and the unit test needs the same key to reset the
 * shared bucket.
 *
 * @see app/routes/api.food-micronutrients.ts, the sole production caller.
 */
import { getClientRateLimitBucket } from '#app/lib/client-ip.server';

/** Buckets by client address, an IPv6 address by its /64 network, as `/api/food-matches` does. */
export function foodMicronutrientsRateLimitKey(request: Request): string {
  return `food-micronutrients:ip:${getClientRateLimitBucket(request)}`;
}
