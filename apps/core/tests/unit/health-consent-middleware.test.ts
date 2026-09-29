/**
 * `requireHealthConsent` and `exceptOwnCopyReads` (`server/bearer-auth.ts`),
 * in front of a terminal route that says what reached it.
 *
 * WHAT THIS FILE OWNS. `tests/integration/health-consent-required.test.ts`
 * proves the rule on the real app and the real routes. This file proves the
 * two pieces of it no route can: that the own-copy exemption is EXACT (a
 * method, a trailing slash or a letter case it did not name is refused, never
 * let through), and that the middleware fails closed when somebody mounts it
 * without the bearer middleware in front.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import type { Request, Response } from 'express';
import {
  createBearerAuthMiddleware,
  createHealthConsentMiddleware,
  exceptOwnCopyReads,
} from '../../src/server/bearer-auth.js';
import { hashToken } from '../../src/lib/tokens.js';
import { createAuthFixture } from './auth-context-fixture.js';

const TOKEN = 'an-access-token';
const REFUSED = { error: 'health-consent-required' };

const servers: Server[] = [];
after(async () => {
  for (const server of servers) await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** What reached the terminal route, or the refusal that stopped it. */
interface Answer {
  status: number;
  body: unknown;
}

/**
 * One app: the bearer middleware and the consent on `/v1/sync`, the way
 * `create-app.ts` mounts them, and a terminal route that echoes what reached it.
 */
async function start(input: {
  instanceVersion: string | null;
  accountVersion: string | null;
  mountBearer?: boolean;
}): Promise<{ send: (method: string, path: string) => Promise<Answer> }> {
  const fixture = createAuthFixture();
  const account = await fixture.store.seedAccount({
    email: 'anna@example.org',
    dailyAiLimit: 5,
    healthConsent: input.accountVersion === null ? null : { version: input.accountVersion, at: fixture.now() },
  });
  await fixture.store.insertTokens([
    {
      accountId: account.id,
      kind: 'access',
      tokenHash: hashToken(TOKEN),
      familyId: 'family-1',
      expiresAt: new Date(fixture.now().getTime() + 60_000),
    },
  ]);
  const requireConsent = createHealthConsentMiddleware(
    input.instanceVersion === null ? null : { version: input.instanceVersion },
  );
  const app = express();
  if (input.mountBearer === false) {
    app.use('/v1/sync', exceptOwnCopyReads(requireConsent));
  } else {
    app.use('/v1/sync', createBearerAuthMiddleware(fixture.ctx), exceptOwnCopyReads(requireConsent));
  }
  app.all('/v1/sync/*', (req: Request, res: Response) => {
    res.status(200).json({ reached: `${req.method} ${req.path}` });
  });

  const server = app.listen(0);
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  // SAFETY: `listen(0)` binds a TCP port; Node returns the string form only
  // for a Unix domain socket, which this never opens.
  const { port } = server.address() as AddressInfo;
  return {
    async send(method: string, path: string): Promise<Answer> {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      const text = await response.text();
      return { status: response.status, body: text === '' ? null : JSON.parse(text) };
    },
  };
}

test('an account without the version is refused a write, and the twin that holds it is let through', async () => {
  const without = await start({ instanceVersion: 'v2', accountVersion: null });
  assert.deepEqual(await without.send('POST', '/v1/sync/blob'), { status: 403, body: REFUSED });

  const older = await start({ instanceVersion: 'v2', accountVersion: 'v1' });
  assert.deepEqual(await older.send('POST', '/v1/sync/blob'), { status: 403, body: REFUSED });

  const holding = await start({ instanceVersion: 'v2', accountVersion: 'v2' });
  assert.deepEqual(await holding.send('POST', '/v1/sync/blob'), {
    status: 200,
    body: { reached: 'POST /v1/sync/blob' },
  });
});

test('an instance that asks for no consent is a pass-through', async () => {
  const app = await start({ instanceVersion: null, accountVersion: null });
  assert.deepEqual(await app.send('POST', '/v1/sync/blob'), { status: 200, body: { reached: 'POST /v1/sync/blob' } });
});

test('the account reads its own blob and its own key records without the consent', async () => {
  const app = await start({ instanceVersion: 'v2', accountVersion: null });
  assert.equal((await app.send('GET', '/v1/sync/blob')).status, 200);
  assert.equal((await app.send('GET', '/v1/sync/key-records')).status, 200);
  // A query string is not part of the path the exemption names.
  assert.equal((await app.send('GET', '/v1/sync/blob?since=3')).status, 200);
});

test('the exemption is exact: another method, path, slash or case is refused', async () => {
  const app = await start({ instanceVersion: 'v2', accountVersion: null });
  for (const [method, path] of [
    ['POST', '/v1/sync/blob'],
    ['PUT', '/v1/sync/key-records'],
    ['DELETE', '/v1/sync/key-records'],
    ['GET', '/v1/sync/blob/'],
    ['GET', '/v1/sync/BLOB'],
    ['GET', '/v1/sync/key-records/passphrase'],
    ['GET', '/v1/sync/shares'],
    ['GET', '/v1/sync/study/contributions'],
  ] as const) {
    assert.deepEqual(await app.send(method, path), { status: 403, body: REFUSED }, `${method} ${path}`);
  }
  // HEAD carries no body, so only the status can say it was refused.
  assert.equal((await app.send('HEAD', '/v1/sync/blob')).status, 403, 'HEAD /v1/sync/blob');
});

test('mounted without the bearer middleware, it fails closed with a 401 and never lets a request through', async () => {
  const app = await start({ instanceVersion: null, accountVersion: null, mountBearer: false });
  assert.deepEqual(await app.send('POST', '/v1/sync/blob'), {
    status: 401,
    body: { error: 'authentication required' },
  });
});
