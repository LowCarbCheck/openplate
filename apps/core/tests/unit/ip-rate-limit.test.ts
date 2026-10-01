/**
 * `lib/ip-rate-limit.ts` counts an IPv6 caller as its /64 and an IPv4-mapped
 * address as the IPv4 address inside it.
 *
 * WHY. A subscriber holds a whole /64, so a limit keyed on the full address
 * gave one person 2^64 buckets; and a dual-stack socket reports an IPv4 peer
 * as `::ffff:a.b.c.d`, which would be a second bucket for the same caller.
 * The route tests prove the window; this file proves the key.
 *
 * The limiter is mounted on a real Express app, as
 * `legal-declarations-rate-limit.test.ts` does, with `trust proxy` on so a
 * test can name the caller's address in `X-Forwarded-For`.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { createIpRateLimit } from '../../src/lib/ip-rate-limit.js';
import { rateLimitKeyForIp } from '../../src/lib/client-address.js';

const servers: Server[] = [];
after(async () => {
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

/** One request a minute, so the second request from the same bucket is the refusal. */
async function startOnePerMinute(): Promise<string> {
  const app = express();
  app.set('trust proxy', true);
  app.get('/probe', createIpRateLimit({ perMinute: 1, refusal: 'probe-rate-limited', now: () => 0 }), (_req, res) => {
    res.status(200).json({ ok: true });
  });
  const server = createServer(app);
  servers.push(server);
  server.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  // SAFETY: `listen(0)` binds a TCP port; Node returns the string form of an
  // address only for a Unix domain socket, which this never opens.
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}/probe`;
}

async function statusFrom(input: { url: string; address: string }): Promise<number> {
  const response = await fetch(input.url, { headers: { 'X-Forwarded-For': input.address } });
  await response.body?.cancel();
  return response.status;
}

test('two addresses in one IPv6 /64 share a bucket', async () => {
  const url = await startOnePerMinute();
  assert.equal(await statusFrom({ url, address: '2001:db8:1:2::a' }), 200);
  assert.equal(await statusFrom({ url, address: '2001:db8:1:2:ffff:ffff:ffff:ffff' }), 429);
  // The neighbouring /64 is somebody else.
  assert.equal(await statusFrom({ url, address: '2001:db8:1:3::a' }), 200);
});

test('an IPv4-mapped address counts against the IPv4 address it carries', async () => {
  const url = await startOnePerMinute();
  assert.equal(await statusFrom({ url, address: '198.51.100.7' }), 200);
  assert.equal(await statusFrom({ url, address: '::ffff:198.51.100.7' }), 429);
  // And two IPv4 addresses are still two callers.
  assert.equal(await statusFrom({ url, address: '198.51.100.8' }), 200);
});

test('the key for every address form a request can carry', () => {
  const cases: readonly { address: string | undefined; key: string }[] = [
    { address: '203.0.113.9', key: '203.0.113.9' },
    { address: '::ffff:203.0.113.9', key: '203.0.113.9' },
    { address: '::FFFF:cb00:7109', key: '203.0.113.9' },
    { address: '2001:db8:1:2::a', key: '2001:db8:1:2::/64' },
    { address: '2001:0DB8:0001:0002:0000:0000:0000:000a', key: '2001:db8:1:2::/64' },
    { address: '2001:db8::1', key: '2001:db8:0:0::/64' },
    { address: 'fe80::1%eth0', key: 'fe80:0:0:0::/64' },
    { address: '::1', key: '0:0:0:0::/64' },
    { address: '64:ff9b::198.51.100.7', key: '64:ff9b:0:0::/64' },
    { address: 'unknown', key: 'unknown' },
    // No address at all is one shared bucket, never an exemption.
    { address: undefined, key: 'unknown' },
  ];
  for (const { address, key } of cases) {
    assert.equal(rateLimitKeyForIp(address), key, String(address));
  }
});
