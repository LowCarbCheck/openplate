/**
 * Unit tests for `#app/lib/client-ip` — the pure X-Forwarded-For / trust-proxy
 * hop resolution behind login-throttle bucketing. No DB, no Request object, no
 * config: `trustProxy` is passed in exactly as `CONFIG.server.trustProxy`
 * would supply it.
 *
 * The load-bearing property (CRITICAL fix): the LEFTMOST X-Forwarded-For entry
 * is attacker-controlled and must never be trusted directly — only counting in
 * `trustProxy` hops from the RIGHT can't be spoofed by whatever the client
 * prepends.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  rateLimitAddressBucket,
  resolveClientIp,
  DIRECT_CONNECTION_IP,
  UNKNOWN_CLIENT_IP,
} from '../../app/lib/client-ip';

describe('resolveClientIp — trust proxy disabled (dev default)', () => {
  it('ignores X-Forwarded-For entirely when trustProxy is false', () => {
    const withHeader = resolveClientIp({ forwardedFor: '1.2.3.4, 5.6.7.8', trustProxy: false });
    const withoutHeader = resolveClientIp({ forwardedFor: null, trustProxy: false });
    assert.equal(withHeader, DIRECT_CONNECTION_IP);
    assert.equal(withoutHeader, DIRECT_CONNECTION_IP);
  });

  it('ignores X-Forwarded-For entirely when trustProxy is 0', () => {
    assert.equal(resolveClientIp({ forwardedFor: '9.9.9.9', trustProxy: 0 }), DIRECT_CONNECTION_IP);
  });

  it('direct connections with wildly different spoofed headers all collapse to the same bucket', () => {
    const a = resolveClientIp({ forwardedFor: 'attacker-controlled-1', trustProxy: false });
    const b = resolveClientIp({ forwardedFor: 'attacker-controlled-2, more, entries', trustProxy: false });
    assert.equal(a, b);
  });
});

describe('resolveClientIp — single trusted hop (trustProxy: 1, prod default)', () => {
  it('uses the rightmost XFF entry (what the trusted proxy actually observed)', () => {
    assert.equal(resolveClientIp({ forwardedFor: '1.2.3.4', trustProxy: 1 }), '1.2.3.4');
  });

  it('CRITICAL: spoofed leftmost entries land in the SAME bucket as long as the real (rightmost) hop matches', () => {
    const realClientIp = '203.0.113.9';
    const spoofA = resolveClientIp({ forwardedFor: `1.2.3.4, ${realClientIp}`, trustProxy: 1 });
    const spoofB = resolveClientIp({ forwardedFor: `evil, totally-different, ${realClientIp}`, trustProxy: 1 });
    const spoofC = resolveClientIp({ forwardedFor: `${realClientIp}`, trustProxy: 1 });
    assert.equal(spoofA, realClientIp);
    assert.equal(spoofB, realClientIp);
    assert.equal(spoofC, realClientIp);
    assert.equal(spoofA, spoofB);
    assert.equal(spoofB, spoofC);
  });

  it('a different real client IP behind the same trusted proxy lands in a DIFFERENT bucket', () => {
    const victim = resolveClientIp({ forwardedFor: 'spoof, 10.0.0.7', trustProxy: 1 });
    const attacker = resolveClientIp({ forwardedFor: 'spoof, 9.9.9.9', trustProxy: 1 });
    assert.notEqual(victim, attacker);
  });

  it('trims whitespace around entries', () => {
    assert.equal(resolveClientIp({ forwardedFor: '  1.2.3.4 ,  5.6.7.8  ', trustProxy: 1 }), '5.6.7.8');
  });

  it('falls back to UNKNOWN_CLIENT_IP when trusted but no header is present', () => {
    assert.equal(resolveClientIp({ forwardedFor: null, trustProxy: 1 }), UNKNOWN_CLIENT_IP);
    assert.equal(resolveClientIp({ forwardedFor: '', trustProxy: 1 }), UNKNOWN_CLIENT_IP);
  });
});

describe('resolveClientIp — multi-hop trust (e.g. Cloudflare -> Traefik, trustProxy: 2)', () => {
  it('uses the entry the FIRST trusted proxy observed, not the edge-to-edge hop', () => {
    // Left to right: [client-claimed, hop1-observed(client), hop2-observed(hop1)]
    const forwardedFor = 'attacker-spoofed, 198.51.100.5, 203.0.113.1';
    assert.equal(resolveClientIp({ forwardedFor, trustProxy: 2 }), '198.51.100.5');
  });

  it('clamps to the leftmost entry when fewer entries exist than trusted hops', () => {
    assert.equal(resolveClientIp({ forwardedFor: '1.2.3.4', trustProxy: 5 }), '1.2.3.4');
    assert.equal(resolveClientIp({ forwardedFor: '1.2.3.4, 5.6.7.8', trustProxy: 5 }), '1.2.3.4');
  });
});

describe('resolveClientIp — non-numeric trustProxy (true / CIDR string)', () => {
  it('falls back to single-hop semantics for `true`', () => {
    assert.equal(resolveClientIp({ forwardedFor: 'spoof, 9.9.9.9', trustProxy: true }), '9.9.9.9');
  });

  it('falls back to single-hop semantics for a CIDR/preset string', () => {
    assert.equal(resolveClientIp({ forwardedFor: 'spoof, 9.9.9.9', trustProxy: 'loopback' }), '9.9.9.9');
  });
});

/**
 * The per-address limiter counts an IPv6 caller by its /64 (2026-09-30
 * security fix). Before, the full address was the key, and one home
 * connection could pick a fresh address, and so a fresh bucket, for every
 * request.
 */
describe('rateLimitAddressBucket', () => {
  it('puts two addresses inside one /64 into one bucket', () => {
    assert.equal(
      rateLimitAddressBucket('2001:db8:1:2:aaaa::1'),
      rateLimitAddressBucket('2001:db8:1:2:ffff:ffff:ffff:ffff'),
    );
  });

  it('control: keeps two different /64 networks apart', () => {
    assert.notEqual(rateLimitAddressBucket('2001:db8:1:2::1'), rateLimitAddressBucket('2001:db8:1:3::1'));
  });

  it('writes the /64 the same however the address was spelled', () => {
    const expected = '2001:db8:0:2::/64';
    assert.equal(rateLimitAddressBucket('2001:0DB8:0000:0002:0000:0000:0000:0001'), expected);
    assert.equal(rateLimitAddressBucket('2001:db8::2:0:0:0:1'), expected);
    assert.equal(rateLimitAddressBucket('[2001:db8:0:2::1]:443'), expected);
    assert.equal(rateLimitAddressBucket('2001:db8:0:2::1%eth0'), expected);
  });

  it('reads an IPv4-mapped address as the IPv4 address it carries, in both spellings', () => {
    assert.equal(rateLimitAddressBucket('::ffff:203.0.113.7'), '203.0.113.7');
    assert.equal(rateLimitAddressBucket('::FFFF:cb00:7107'), '203.0.113.7');
  });

  it('control: two different IPv4-mapped addresses stay two buckets, not one ::ffff:0:0/64', () => {
    assert.notEqual(rateLimitAddressBucket('::ffff:203.0.113.7'), rateLimitAddressBucket('::ffff:198.51.100.9'));
  });

  it('leaves an IPv4 address, a placeholder and a malformed value as they are', () => {
    assert.equal(rateLimitAddressBucket('203.0.113.7'), '203.0.113.7');
    assert.equal(rateLimitAddressBucket(DIRECT_CONNECTION_IP), DIRECT_CONNECTION_IP);
    assert.equal(rateLimitAddressBucket(UNKNOWN_CLIENT_IP), UNKNOWN_CLIENT_IP);
    assert.equal(rateLimitAddressBucket('1:2:3'), '1:2:3');
    assert.equal(rateLimitAddressBucket('1::2::3'), '1::2::3');
    assert.equal(rateLimitAddressBucket('zzzz::1'), 'zzzz::1');
  });
});
