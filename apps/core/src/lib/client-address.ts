/**
 * The one place a caller's address becomes a throttle key.
 *
 * EVERY THROTTLE KEYED ON A SOURCE ADDRESS GOES THROUGH HERE: the sign-in
 * throttles in `accounts/register-auth-routes.ts` and the sliding window in
 * `lib/ip-rate-limit.ts` (the price list and the declaration form). Two
 * folds would drift, and the cheaper of the two would be the one an attacker
 * picked.
 *
 * AN IPv6 CALLER IS ONE /64, NOT ONE ADDRESS (2026-09-30). A home router or a
 * phone carrier hands one subscriber a whole /64, and every address in it is
 * theirs to use, so a limit keyed on the full address is a limit of 2^64
 * buckets for anybody with IPv6. An IPv4-mapped address (`::ffff:a.b.c.d`,
 * which a dual-stack socket reports for an IPv4 peer) is the IPv4 address it
 * carries, so one caller cannot hold two buckets by switching stacks. An IPv4
 * address is itself, exactly as before.
 *
 * NO ADDRESS IS ONE SHARED BUCKET. `req.ip` is `undefined` only when Express
 * cannot determine it at all; the literal `unknown` keeps every such request
 * in ONE bucket rather than silently exempting them from the limit.
 */
import { isIPv4, isIPv6 } from 'node:net';
import type { Request } from 'express';

/** The bucket every request with no determinable address shares. */
export const UNKNOWN_CLIENT_ADDRESS = 'unknown';

/** An IPv6 address has eight 16-bit groups, and a /64 is the first four. */
const IPV6_GROUPS = 8;
const IPV6_PREFIX_GROUPS = 4;

/**
 * The eight groups of an IPv6 address as numbers, or `null` when it is not one.
 * Accepts `::` compression, a trailing dotted quad (`::ffff:1.2.3.4`) and a
 * zone suffix (`fe80::1%eth0`), which is every form `req.ip` can carry.
 */
function ipv6Groups(address: string): number[] | null {
  const withoutZone = address.split('%', 1)[0] ?? '';
  if (!isIPv6(withoutZone)) return null;

  let text = withoutZone.toLowerCase();
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (isIPv4(tail)) {
    const octets = tail.split('.').map(Number);
    const high = ((octets[0] ?? 0) << 8) | (octets[1] ?? 0);
    const low = ((octets[2] ?? 0) << 8) | (octets[3] ?? 0);
    text = `${text.slice(0, lastColon + 1)}${high.toString(16)}:${low.toString(16)}`;
  }

  const [head = '', rest] = text.split('::');
  const headGroups = head === '' ? [] : head.split(':');
  const tailGroups = rest === undefined || rest === '' ? [] : rest.split(':');
  const zeros = rest === undefined ? 0 : IPV6_GROUPS - headGroups.length - tailGroups.length;
  const groups = [...headGroups, ...Array.from({ length: zeros }, () => '0'), ...tailGroups];
  if (groups.length !== IPV6_GROUPS) return null;
  return groups.map((group) => Number.parseInt(group, 16));
}

/** The IPv4 address an IPv4-mapped IPv6 address (`::ffff:a.b.c.d`) carries, or `null` for any other address. */
function mappedIpv4(groups: readonly number[]): string | null {
  const isMapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  if (!isMapped) return null;
  const high = groups[6] ?? 0;
  const low = groups[7] ?? 0;
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
}

/**
 * The bucket one address counts against: an IPv4 address as itself, an
 * IPv4-mapped IPv6 address as the IPv4 address inside it, any other IPv6
 * address as its /64, written `2001:db8:1:2::/64`, and a missing address as
 * {@link UNKNOWN_CLIENT_ADDRESS}. Anything else is its own bucket, unchanged.
 */
export function rateLimitKeyForIp(address: string | undefined): string {
  if (address === undefined) return UNKNOWN_CLIENT_ADDRESS;
  if (isIPv4(address)) return address;
  const groups = ipv6Groups(address);
  if (groups === null) return address;
  const ipv4 = mappedIpv4(groups);
  if (ipv4 !== null) return ipv4;
  const prefix = groups.slice(0, IPV6_PREFIX_GROUPS).map((group) => group.toString(16));
  return `${prefix.join(':')}::/64`;
}

/**
 * The throttle key of the caller who sent this request. `req.ip` already
 * honours `trust proxy`, so this is the client a configured proxy names, or
 * the socket's peer without one (README, `TRUST_PROXY`).
 */
export function clientAddressKey(req: Pick<Request, 'ip'>): string {
  return rateLimitKeyForIp(req.ip);
}
