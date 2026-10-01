/**
 * The sign-in throttles count a caller the way `lib/client-address.ts` folds
 * it, and login has a second bucket per account that no address can escape.
 *
 * WHY. Every unauthenticated throttle under `/v1/auth` keyed on the raw
 * `req.ip`. One home connection holds a whole IPv6 /64, which is 2^64
 * addresses, so a caller with IPv6 had 2^64 buckets on every one of them:
 * a fresh allowance of KDF probes, invite guesses and password guesses per
 * address. And the login bucket was keyed on address AND email, so even an
 * IPv4 caller with a few hundred addresses got a few hundred times the
 * allowance against one account. The 2026-09-30 audit, finding 4.
 *
 * WHAT EACH TEST PROVES, AND HOW IT WOULD FAIL. Every refusal asserted here is
 * a `429` that the raw-address code answered `200` or `401` instead, because
 * each request came from an address that code had never seen. Each test also
 * carries the case that must NOT be refused (the neighbouring /64, a
 * different IPv4 address, a different account), so a throttle that refused
 * everything would fail too.
 *
 * The REAL route module on a bare Express app, with `trust proxy` on so a test
 * can name the caller in `X-Forwarded-For`, the only way two sources exist on
 * one loopback socket. The throttle stores are the production configs.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import type { NextFunction, Request, Response as ExpressResponse } from 'express';
import { registerAuthRoutes } from '../../src/accounts/register-auth-routes.js';
import { createThrottleStore, DEFAULT_THROTTLE_CONFIG, LOGIN_ACCOUNT_THROTTLE } from '../../src/lib/throttle.js';
import { computeVerifier } from '../../src/lib/verifier.js';
import { createAuthFixture, sampleAuthHash, type AuthFixture } from './auth-context-fixture.js';

const servers: Server[] = [];
after(async () => {
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

/** Requests a bucket answers before the one it refuses: `freeAttempts` free failures, then the one that sets the lock. */
const PER_ADDRESS_ALLOWANCE = DEFAULT_THROTTLE_CONFIG.freeAttempts + 1;
const PER_ACCOUNT_ALLOWANCE = LOGIN_ACCOUNT_THROTTLE.freeAttempts + 1;

const OWNER_EMAIL = 'owner@example.org';
const OWNER_AUTH_HASH = sampleAuthHash(11);
const WRONG_AUTH_HASH = sampleAuthHash(99);

/** Only the status and the wait are read; the body is the same sentence on every refusal. */
interface Answer {
  status: number;
  retryAfter: string | null;
}

interface Harness {
  fixture: AuthFixture;
  post(input: { path: string; from: string; body: unknown }): Promise<Answer>;
}

/** Nothing here needs a session; a route that did would be a mistake in this file. */
function refuseBearer(_req: Request, res: ExpressResponse, _next: NextFunction): void {
  res.status(401).json({ error: 'authentication required' });
}

function passThrough(_req: Request, _res: ExpressResponse, next: NextFunction): void {
  next();
}

async function startHarness(): Promise<Harness> {
  const fixture = createAuthFixture();
  await fixture.store.seedAccount({
    email: OWNER_EMAIL,
    verifier: computeVerifier({ authHash: OWNER_AUTH_HASH, pepper: fixture.ctx.pepper }),
  });

  const app = express();
  app.set('trust proxy', true);
  registerAuthRoutes(app, {
    ctx: fixture.ctx,
    throttle: createThrottleStore(DEFAULT_THROTTLE_CONFIG),
    loginAccountThrottle: createThrottleStore(LOGIN_ACCOUNT_THROTTLE),
    requireAuth: refuseBearer,
    requireConsent: passThrough,
  });
  const server = createServer(app);
  servers.push(server);
  server.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  // SAFETY: `listen(0)` binds a TCP port; Node returns the string form of an
  // address only for a Unix domain socket, which this never opens.
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;

  return {
    fixture,
    async post({ path, from, body }) {
      const response = await fetch(`${origin}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': from },
        body: JSON.stringify(body),
      });
      await response.body?.cancel();
      return { status: response.status, retryAfter: response.headers.get('retry-after') };
    },
  };
}

/** The `n`th address inside `2001:db8:1:2::/64`, each one distinct. */
function addressInOneSlash64(n: number): string {
  return `2001:db8:1:2:${(n + 1).toString(16)}:0:0:${(n + 7).toString(16)}`;
}

/** The `n`th IPv4 address, each in a different /24, so no fold of any width could join them. */
function distinctIpv4(n: number): string {
  return `198.${18 + (n % 2)}.${n}.${n + 1}`;
}

// ── One /64 is one caller ──────────────────────────────────────────────────

test('the KDF throttle counts every address in one IPv6 /64 against one bucket', async () => {
  const harness = await startHarness();
  for (let attempt = 0; attempt < PER_ADDRESS_ALLOWANCE; attempt += 1) {
    const response = await harness.post({
      path: '/v1/auth/kdf',
      from: addressInOneSlash64(attempt),
      body: { email: `probe-${attempt}@example.org` },
    });
    assert.equal(response.status, 200, `probe ${attempt + 1}`);
  }

  const refused = await harness.post({
    path: '/v1/auth/kdf',
    from: '2001:db8:1:2:ffff:ffff:ffff:ffff',
    body: { email: 'probe-last@example.org' },
  });
  assert.equal(refused.status, 429);
  assert.ok(Number(refused.retryAfter) >= 1);

  // The neighbouring /64 is somebody else.
  const neighbour = await harness.post({
    path: '/v1/auth/kdf',
    from: '2001:db8:1:3::1',
    body: { email: 'probe-last@example.org' },
  });
  assert.equal(neighbour.status, 200);
});

test('the login throttle counts every address in one IPv6 /64 against one bucket', async () => {
  const harness = await startHarness();
  for (let attempt = 0; attempt < PER_ADDRESS_ALLOWANCE; attempt += 1) {
    const response = await harness.post({
      path: '/v1/auth/login',
      from: addressInOneSlash64(attempt),
      body: { email: OWNER_EMAIL, authHash: WRONG_AUTH_HASH },
    });
    assert.equal(response.status, 401, `guess ${attempt + 1}`);
  }

  const refused = await harness.post({
    path: '/v1/auth/login',
    from: '2001:db8:1:2::abcd',
    body: { email: OWNER_EMAIL, authHash: WRONG_AUTH_HASH },
  });
  assert.equal(refused.status, 429);

  // The neighbouring /64 still reaches the credential check: the per-account
  // bucket is far from its ceiling, and the per-address one is a different
  // caller's.
  const neighbour = await harness.post({
    path: '/v1/auth/login',
    from: '2001:db8:1:3::1',
    body: { email: OWNER_EMAIL, authHash: WRONG_AUTH_HASH },
  });
  assert.equal(neighbour.status, 401);
});

test('the signup, invite lookup, recovery and reset throttles count one /64 as one caller', async () => {
  const cases: readonly { path: string; body: unknown }[] = [
    { path: '/v1/auth/signup', body: {} },
    { path: '/v1/auth/invite-lookup', body: { inviteToken: 'si_not-a-real-one' } },
    { path: '/v1/auth/recover', body: { email: OWNER_EMAIL, recoveryAuthHash: WRONG_AUTH_HASH } },
    { path: '/v1/auth/recover-rotate', body: { email: OWNER_EMAIL } },
    { path: '/v1/auth/reset/request', body: { email: OWNER_EMAIL } },
    { path: '/v1/auth/reset/open', body: { token: 'sr_not-a-real-one' } },
  ];
  for (const { path, body } of cases) {
    const harness = await startHarness();
    for (let attempt = 0; attempt < PER_ADDRESS_ALLOWANCE; attempt += 1) {
      const response = await harness.post({ path, from: addressInOneSlash64(attempt), body });
      assert.notEqual(response.status, 429, `${path}, request ${attempt + 1}`);
    }
    const refused = await harness.post({ path, from: '2001:db8:1:2::abcd', body });
    assert.equal(refused.status, 429, path);
    const neighbour = await harness.post({ path, from: '2001:db8:1:3::1', body });
    assert.notEqual(neighbour.status, 429, `${path}, the neighbouring /64`);
  }
});

// ── An IPv4-mapped address is its IPv4 address ─────────────────────────────

test('an IPv4-mapped address counts against the IPv4 address it carries', async () => {
  const harness = await startHarness();
  for (let attempt = 0; attempt < PER_ADDRESS_ALLOWANCE; attempt += 1) {
    const response = await harness.post({
      path: '/v1/auth/kdf',
      from: '198.51.100.7',
      body: { email: `probe-${attempt}@example.org` },
    });
    assert.equal(response.status, 200, `probe ${attempt + 1}`);
  }

  const mapped = await harness.post({
    path: '/v1/auth/kdf',
    from: '::ffff:198.51.100.7',
    body: { email: 'probe-last@example.org' },
  });
  assert.equal(mapped.status, 429);

  // Two IPv4 addresses are still two callers, exactly as before.
  const otherIpv4 = await harness.post({
    path: '/v1/auth/kdf',
    from: '198.51.100.8',
    body: { email: 'probe-last@example.org' },
  });
  assert.equal(otherIpv4.status, 200);
});

// ── One account is one bucket, from any address ────────────────────────────

test('login refuses an account after its ceiling of failures, from any address', async () => {
  const harness = await startHarness();
  for (let attempt = 0; attempt < PER_ACCOUNT_ALLOWANCE; attempt += 1) {
    const response = await harness.post({
      path: '/v1/auth/login',
      from: distinctIpv4(attempt),
      body: { email: OWNER_EMAIL, authHash: WRONG_AUTH_HASH },
    });
    assert.equal(response.status, 401, `guess ${attempt + 1}`);
  }

  // A fresh address, an address the per-address bucket has never seen, and
  // the RIGHT passphrase: still refused, because the bucket is the account's.
  const refused = await harness.post({
    path: '/v1/auth/login',
    from: '203.0.113.200',
    body: { email: OWNER_EMAIL, authHash: OWNER_AUTH_HASH },
  });
  assert.equal(refused.status, 429);
  assert.ok(Number(refused.retryAfter) >= 1);

  // Another spelling of the same address is the same account, so the same bucket.
  const otherSpelling = await harness.post({
    path: '/v1/auth/login',
    from: '203.0.113.201',
    body: { email: 'ＯＷＮＥＲ@example.org', authHash: WRONG_AUTH_HASH },
  });
  assert.equal(otherSpelling.status, 429);

  // A different account is untouched: the bucket is per account, not global.
  const otherAccount = await harness.post({
    path: '/v1/auth/login',
    from: '203.0.113.202',
    body: { email: 'someone-else@example.org', authHash: WRONG_AUTH_HASH },
  });
  assert.equal(otherAccount.status, 401);
});

test('a successful login clears the per-account bucket', async () => {
  const harness = await startHarness();
  // One short of the ceiling, then the owner gets it right.
  for (let attempt = 0; attempt < PER_ACCOUNT_ALLOWANCE - 1; attempt += 1) {
    const response = await harness.post({
      path: '/v1/auth/login',
      from: distinctIpv4(attempt),
      body: { email: OWNER_EMAIL, authHash: WRONG_AUTH_HASH },
    });
    assert.equal(response.status, 401, `guess ${attempt + 1}`);
  }
  const success = await harness.post({
    path: '/v1/auth/login',
    from: '203.0.113.200',
    body: { email: OWNER_EMAIL, authHash: OWNER_AUTH_HASH },
  });
  assert.equal(success.status, 200);

  // A full allowance again, not the one failure that was left.
  for (let attempt = 0; attempt < PER_ACCOUNT_ALLOWANCE; attempt += 1) {
    const response = await harness.post({
      path: '/v1/auth/login',
      from: distinctIpv4(100 + attempt),
      body: { email: OWNER_EMAIL, authHash: WRONG_AUTH_HASH },
    });
    assert.equal(response.status, 401, `guess ${attempt + 1} after the success`);
  }
  const refused = await harness.post({
    path: '/v1/auth/login',
    from: '203.0.113.201',
    body: { email: OWNER_EMAIL, authHash: WRONG_AUTH_HASH },
  });
  assert.equal(refused.status, 429);
});

test('an unknown address is counted and refused exactly as a known one is', async () => {
  // THE REFUSAL MUST NOT BE AN ORACLE. If only known accounts locked, the
  // twenty-first guess would say which addresses hold one.
  const harness = await startHarness();
  for (let attempt = 0; attempt < PER_ACCOUNT_ALLOWANCE; attempt += 1) {
    const response = await harness.post({
      path: '/v1/auth/login',
      from: distinctIpv4(attempt),
      body: { email: 'nobody@example.org', authHash: WRONG_AUTH_HASH },
    });
    assert.equal(response.status, 401, `guess ${attempt + 1}`);
  }
  const refused = await harness.post({
    path: '/v1/auth/login',
    from: '203.0.113.200',
    body: { email: 'nobody@example.org', authHash: WRONG_AUTH_HASH },
  });
  assert.equal(refused.status, 429);
  assert.ok(Number(refused.retryAfter) >= 1);
});
