/**
 * `Request`-reading shell around `#app/lib/client-ip`'s pure
 * `resolveClientIp`. Split out as `.server.ts` because it reads
 * `CONFIG.server.trustProxy` — the repo convention keeps `CONFIG` imports out
 * of non-`.server.ts` modules under `app/lib/` (see `AGENTS.md`); the pure hop
 * math stays in `client-ip.ts` so it's unit-testable without env coupling.
 */
import { CONFIG } from '#app/config';
import { resolveClientIp } from '#app/lib/client-ip';

/** Extracts the client IP from a request for rate-limiting / lockout scoping. */
export function getClientIp(request: Request): string {
  return resolveClientIp({
    forwardedFor: request.headers.get('x-forwarded-for'),
    trustProxy: CONFIG.server.trustProxy,
  });
}
