/**
 * `Request`-reading shell around `#app/lib/client-ip`'s pure
 * `resolveClientIp`. Split out as `.server.ts` because it reads
 * `CONFIG.server.trustProxy` — the repo convention keeps `CONFIG` imports out
 * of non-`.server.ts` modules under `app/lib/` (see `AGENTS.md`); the pure hop
 * math stays in `client-ip.ts` so it's unit-testable without env coupling.
 */
import { CONFIG } from '#app/config';
import { rateLimitAddressBucket, resolveClientIp } from '#app/lib/client-ip';

/** Extracts the client IP from a request for rate-limiting / lockout scoping. */
export function getClientIp(request: Request): string {
  return resolveClientIp({
    forwardedFor: request.headers.get('x-forwarded-for'),
    trustProxy: CONFIG.server.trustProxy,
  });
}

/**
 * The client's rate-limit bucket: its address, with an IPv6 address widened to
 * its /64 network. See `rateLimitAddressBucket` for why a full IPv6 address
 * is no key at all.
 */
export function getClientRateLimitBucket(request: Request): string {
  return rateLimitAddressBucket(getClientIp(request));
}
