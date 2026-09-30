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

/** Hextets kept from an IPv6 address: the /64 network prefix a single subscriber is handed. */
const IPV6_NETWORK_HEXTETS = 4;

/** The number of 16-bit groups in a full IPv6 address. */
const IPV6_HEXTET_COUNT = 8;

/** One dotted-quad IPv4 address, each octet 0 to 255. */
const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** One IPv6 group: one to four hex digits. */
const HEXTET_PATTERN = /^[0-9a-f]{1,4}$/;

/** The four octets of a dotted-quad IPv4 address, or `null` when `text` is not one. */
function parseIpv4Octets(text: string): number[] | null {
  const match = IPV4_PATTERN.exec(text);
  if (match === null) return null;
  const octets = match.slice(1).map(Number);
  return octets.every((octet) => octet <= 255) ? octets : null;
}

/** Parses the colon groups on one side of a `::`, expanding an IPv4 tail into two groups. */
function parseHextetGroups(text: string): number[] | null {
  if (text === '') return [];
  const groups = text.split(':');
  const hextets: number[] = [];
  for (const [index, group] of groups.entries()) {
    const isLast = index === groups.length - 1;
    const octets = isLast ? parseIpv4Octets(group) : null;
    if (octets !== null) {
      hextets.push(octets[0]! * 256 + octets[1]!, octets[2]! * 256 + octets[3]!);
      continue;
    }
    if (!HEXTET_PATTERN.test(group)) return null;
    hextets.push(Number.parseInt(group, 16));
  }
  return hextets;
}

/**
 * The eight 16-bit groups of an IPv6 address, or `null` when `text` is not
 * one. Accepts the `::` shorthand once, an IPv4 tail (`::ffff:1.2.3.4`) and a
 * zone suffix (`fe80::1%eth0`), which is dropped.
 */
function parseIpv6Hextets(text: string): number[] | null {
  const address = text.split('%')[0]!.toLowerCase();
  const halves = address.split('::');
  if (halves.length > 2) return null;
  const head = parseHextetGroups(halves[0]!);
  if (head === null) return null;
  if (halves.length === 1) return head.length === IPV6_HEXTET_COUNT ? head : null;
  const tail = parseHextetGroups(halves[1]!);
  if (tail === null) return null;
  const missing = IPV6_HEXTET_COUNT - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...Array<number>(missing).fill(0), ...tail];
}

/** Whether the groups spell an IPv4-mapped address, `::ffff:a.b.c.d`. */
function isIpv4Mapped(hextets: readonly number[]): boolean {
  return hextets.slice(0, 5).every((hextet) => hextet === 0) && hextets[5] === 0xffff;
}

/** `[2001:db8::1]:443` and `[2001:db8::1]` become `2001:db8::1`; anything else is only trimmed. */
function stripBrackets(address: string): string {
  const trimmed = address.trim();
  if (!trimmed.startsWith('[')) return trimmed;
  const end = trimmed.indexOf(']');
  return end === -1 ? trimmed : trimmed.slice(1, end);
}

/**
 * The rate-limit bucket an address belongs to: an IPv4 address as it is, and
 * an IPv6 address by its /64 network.
 *
 * WHY /64: an IPv6 subscriber is routinely handed a whole /64 (and often a
 * /56 or a /48), and picks any address inside it at will. Keyed by the full
 * address, one person could mint eighteen quintillion fresh buckets from a
 * single home connection, and a per-address limit would limit nothing. A /64
 * is the smallest block one subscriber is ever given, so it is the finest key
 * that still means "one caller", and it is what one IPv4 address means.
 *
 * An IPv4-MAPPED address (`::ffff:1.2.3.4`, which a dual-stack socket reports
 * for an IPv4 peer) is the IPv4 address it carries. Bucketed by its /64 it
 * would put the whole IPv4 internet into one bucket, `::ffff:0:0/64`.
 *
 * Anything that is not an address (the `direct` and `unknown` placeholders
 * above, or a proxy header nobody should have sent) is returned unchanged, so
 * this can only ever narrow what `resolveClientIp` produced, never invent a
 * bucket.
 *
 * @param address - an address as `resolveClientIp` returns it.
 * @returns the key to count that address under.
 */
export function rateLimitAddressBucket(address: string): string {
  const bare = stripBrackets(address);
  if (!bare.includes(':')) return bare;
  const hextets = parseIpv6Hextets(bare);
  if (hextets === null) return bare;
  if (isIpv4Mapped(hextets)) {
    const high = hextets[6]!;
    const low = hextets[7]!;
    return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
  }
  const network = hextets.slice(0, IPV6_NETWORK_HEXTETS).map((hextet) => hextet.toString(16));
  return `${network.join(':')}::/64`;
}
