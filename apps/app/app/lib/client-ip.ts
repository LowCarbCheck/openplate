/**
 * Pure client-IP resolution for rate-limiting / lockout scoping. Mirrors
 * Express's own `trust proxy` hop semantics (`proxy-addr`'s algorithm, as
 * driven by `express/lib/utils.js:compileTrust`) so the address this module
 * returns matches what `server.ts`'s `app.set('trust proxy', CONFIG.server.trustProxy)`
 * would trust — see that file and `#app/config`'s `parseTrustProxy`.
 *
 * Why this exists as a rewrite: `X-Forwarded-For` is built by PREPENDING —
 * each hop APPENDS the peer address it observed, so the header grows
 * left-to-right in the order client → hop1 → hop2 → ... → us. The LEFTMOST
 * entry is whatever the original client sent (or fabricated) and is only
 * trustworthy if EVERY hop between the client and us is trusted. Blindly
 * taking the leftmost entry (the previous implementation) lets any caller
 * mint an arbitrary throttle bucket per request by varying that value —
 * the lockout becomes fully bypassable. The fix: count `trustProxy` hops in
 * from the RIGHT (the end closest to us), which is the address the
 * outermost TRUSTED proxy actually observed on its own socket.
 *
 * `trustProxy` hop semantics (numeric case), verified against
 * `node_modules/proxy-addr` + `express/lib/utils.js`:
 * - `false` / `0` (no proxy trusted — this app's dev default): the direct
 *   TCP peer is the client, and X-Forwarded-For MUST be ignored entirely
 *   (RR8's Fetch `Request` — see `@react-router/express`'s
 *   `createRemixRequest` — carries only headers/method/url/body, no socket
 *   info, so we can't return the real peer address; every untrusted-proxy
 *   request instead collapses onto one shared `DIRECT_CONNECTION_IP` bucket).
 * - `N` (positive hop count — this app's prod default is `1`, a single
 *   Traefik hop; `2` for e.g. Cloudflare → Traefik): take the entry that is
 *   `N` positions in from the right of the X-Forwarded-For list, clamped to
 *   the leftmost entry if there aren't `N` entries. For `N=1` that's simply
 *   the rightmost entry — the address the one trusted proxy appended,
 *   regardless of what an attacker prepended further left.
 * - `true` / a CIDR-or-preset string: real IP-range trust evaluation needs
 *   each hop's observed peer address, which (as above) RR8's Fetch `Request`
 *   doesn't expose. Both fall back to the single-hop (`N=1`) assumption —
 *   conservative versus trusting the whole chain, and matches every
 *   documented deployment shape this app actually ships (one Traefik hop,
 *   optionally one more in front of it).
 */

import { z } from 'zod';

/** Bucket for every request when no proxy hop is trusted (dev default). */
export const DIRECT_CONNECTION_IP = 'direct';
/** Bucket when a proxy hop is trusted but no X-Forwarded-For value was present. */
export const UNKNOWN_CLIENT_IP = 'unknown';

export interface ResolveClientIpInput {
  /** Raw `X-Forwarded-For` header value, or `null`/empty when absent. */
  forwardedFor: string | null;
  /** Same value as `CONFIG.server.trustProxy` (Express's `trust proxy` setting). */
  trustProxy: boolean | number | string;
}

/** Splits and trims a raw X-Forwarded-For header into its comma-separated entries, left to right. */
function splitForwardedFor(header: string | null): string[] {
  if (!header) return [];
  return header
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Maps a `trustProxy` config value to an effective hop count for the
 * N-from-the-right lookup. See the module doc for why `true`/string values
 * fall back to a single trusted hop.
 */
function resolveHopCount(trustProxy: boolean | number | string): number {
  const hops = z.number().safeParse(trustProxy);
  return hops.success ? Math.max(1, Math.trunc(hops.data)) : 1;
}

/**
 * Resolves the client IP for throttle/rate-limit bucketing, honoring
 * `trustProxy` hop semantics. Never throws; always returns a bucketable
 * string (falling back to `DIRECT_CONNECTION_IP` / `UNKNOWN_CLIENT_IP`).
 */
export function resolveClientIp({ forwardedFor, trustProxy }: ResolveClientIpInput): string {
  if (trustProxy === false || trustProxy === 0) {
    return DIRECT_CONNECTION_IP;
  }

  const entries = splitForwardedFor(forwardedFor);
  if (entries.length === 0) return UNKNOWN_CLIENT_IP;

  const hopCount = resolveHopCount(trustProxy);
  const index = Math.max(0, entries.length - hopCount);
  return entries[index]!;
}
