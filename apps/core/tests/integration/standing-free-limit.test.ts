/**
 * The instance's standing free daily limit (`DEFAULT_FREE_DAILY_AI_LIMIT`,
 * 2026-10-05), against real Postgres and the real proxy.
 *
 * THE CLAIMS, EACH WITH ITS CONTROL:
 *  1. An account with no AI of its own is held to the default, counted in
 *     `ai_usage_days`, and refused at it with the 429 that names the reset, not
 *     the 403 of "no allowance". Control: the same account on an instance with
 *     no default is `403 ai-not-allowed`.
 *  2. An account that still carries a scan trial falls under the standing limit
 *     and spends no scan: the cap replaces the trial. Control: the same account
 *     on an instance with no default claims a scan and is told how many are left.
 *  3. The account view reports the number the proxy enforces. Control: no default
 *     leaves the column, 0.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import { NO_INSTANCE_STANDING } from '../../src/accounts/instance-standing.js';
import { accounts, aiUsageDays } from '../../src/db/schema.js';
import { setupTestDatabase, type TestDatabase } from './db-harness.js';
import { startService, type HttpResponse, type ServiceHarness } from './service-harness.js';

const SCAN_BODY = { model: 'm', messages: [{ role: 'user', content: 'what is on this plate?' }] };

let database: TestDatabase;
let upstream: Server;
let upstreamBaseUrl: string;
let upstreamCalls: number;

before(async () => {
  database = await setupTestDatabase();
  upstream = createServer((request, response) => {
    request.resume();
    request.on('end', () => {
      upstreamCalls += 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: 'a plate' } }] }));
    });
  });
  upstream.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => upstream.once('listening', resolve));
  // SAFETY: `listen(0, host)` binds a TCP port; Node returns the string form
  // only for a Unix domain socket, which this never opens.
  upstreamBaseUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
  await database.close();
});

beforeEach(async () => {
  await database.reset();
  upstreamCalls = 0;
});

async function startInstance(input: { defaultFreeDailyAiLimit: number | null }): Promise<ServiceHarness> {
  return startService({
    db: database.db,
    ai: { baseUrl: upstreamBaseUrl, apiKey: 'sk-the-operators-key' },
    standing:
      input.defaultFreeDailyAiLimit === null
        ? null
        : { ...NO_INSTANCE_STANDING, defaultFreeDailyAiLimit: input.defaultFreeDailyAiLimit },
  });
}

function scan(service: ServiceHarness, accessToken: string): Promise<HttpResponse<{ error?: string }>> {
  return service.request<{ error?: string }>({
    method: 'POST',
    path: '/v1/chat/completions',
    accessToken,
    body: SCAN_BODY,
  });
}

async function usageCount(accountId: number): Promise<number> {
  const rows = await database.db.select().from(aiUsageDays).where(eq(aiUsageDays.accountId, accountId));
  return rows[0]?.count ?? 0;
}

test('a new account with no AI of its own gets the standing limit, and is refused at it with a 429', async () => {
  const service = await startInstance({ defaultFreeDailyAiLimit: 2 });
  try {
    // An ordinary invite: no AI limit, no trial. Before the default it meant
    // `403 ai-not-allowed` until an operator granted some.
    const session = await service.signupThroughInvite({ email: 'anna@example.org' });
    const [row] = await database.db.select().from(accounts).where(eq(accounts.id, session.account.id));
    assert.equal(row?.freeDailyAiLimit, 0, 'the default is never written onto the row');
    assert.equal(row?.trialScans, null, 'and no scan trial was given');

    const first = await scan(service, session.tokens.accessToken);
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('x-quota-limit'), '2');
    assert.equal(first.headers.get('x-trial-scans-left'), null, 'no trial is in play');
    assert.equal((await scan(service, session.tokens.accessToken)).status, 200);
    assert.equal(await usageCount(session.account.id), 2);

    const spent = await scan(service, session.tokens.accessToken);
    assert.equal(spent.status, 429, 'a day used up is a 429 with a reset, never the 403 of no allowance');
    assert.match(spent.body.error ?? '', /daily quota spent: 2 of 2 units used/);
    const retryAfter = Number(spent.headers.get('retry-after'));
    assert.ok(Number.isInteger(retryAfter) && retryAfter > 0 && retryAfter <= 86_400);
    assert.equal(await usageCount(session.account.id), 2, 'the refused request was not counted');
    assert.equal(upstreamCalls, 2, 'and nothing left the host for it');
  } finally {
    await service.close();
  }
});

test('CONTROL: the same sign-up on an instance with no default is 403 ai-not-allowed and writes no row', async () => {
  for (const defaultFreeDailyAiLimit of [null, 0]) {
    const service = await startInstance({ defaultFreeDailyAiLimit });
    try {
      const session = await service.signupThroughInvite({
        email: `anna${String(defaultFreeDailyAiLimit)}@example.org`,
      });
      const refused = await scan(service, session.tokens.accessToken);
      assert.equal(refused.status, 403);
      assert.equal(refused.body.error, 'ai-not-allowed');
      assert.equal(await usageCount(session.account.id), 0);
    } finally {
      await service.close();
    }
  }
});

test('an account that still carries a scan trial falls under the standing limit and spends no scan', async () => {
  const service = await startInstance({ defaultFreeDailyAiLimit: 2 });
  try {
    const session = await service.signupThroughInvite({
      email: 'trial@example.org',
      dailyAiLimit: 20,
      trialScans: 10,
    });

    const answered = await scan(service, session.tokens.accessToken);
    assert.equal(answered.status, 200);
    assert.equal(answered.headers.get('x-quota-limit'), '2', 'held to the standing limit, not the trial day limit');
    assert.equal(answered.headers.get('x-trial-scans-left'), null);
    const [row] = await database.db.select().from(accounts).where(eq(accounts.id, session.account.id));
    assert.equal(row?.trialScansUsed, 0, 'no scan was claimed');

    assert.equal((await scan(service, session.tokens.accessToken)).status, 200);
    assert.equal((await scan(service, session.tokens.accessToken)).status, 429);
  } finally {
    await service.close();
  }
});

test('CONTROL: that trial account on an instance with no default claims a scan, at the trial day limit', async () => {
  const service = await startInstance({ defaultFreeDailyAiLimit: null });
  try {
    const session = await service.signupThroughInvite({
      email: 'trial@example.org',
      dailyAiLimit: 20,
      trialScans: 10,
    });
    const answered = await scan(service, session.tokens.accessToken);
    assert.equal(answered.status, 200);
    assert.equal(answered.headers.get('x-quota-limit'), '20');
    assert.equal(answered.headers.get('x-trial-scans-left'), '9');
  } finally {
    await service.close();
  }
});

test('an own free limit is kept, and the account view reports the number the proxy enforces', async () => {
  const service = await startInstance({ defaultFreeDailyAiLimit: 2 });
  try {
    const plain = await service.signupThroughInvite({ email: 'plain@example.org' });
    const granted = await service.signupThroughInvite({ email: 'granted@example.org' });
    await database.db.update(accounts).set({ freeDailyAiLimit: 7 }).where(eq(accounts.id, granted.account.id));

    const read = async (accessToken: string): Promise<number> => {
      const view = await service.request<{ account: { freeDailyAiLimit: number } }>({
        method: 'GET',
        path: '/v1/auth/account',
        accessToken,
      });
      return view.body.account.freeDailyAiLimit;
    };
    assert.equal(await read(plain.tokens.accessToken), 2);
    assert.equal(await read(granted.tokens.accessToken), 7);
    assert.equal((await scan(service, granted.tokens.accessToken)).headers.get('x-quota-limit'), '7');
  } finally {
    await service.close();
  }
});

test('CONTROL: with no default the account view reports the column', async () => {
  const service = await startInstance({ defaultFreeDailyAiLimit: null });
  try {
    const plain = await service.signupThroughInvite({ email: 'plain@example.org' });
    const view = await service.request<{ account: { freeDailyAiLimit: number } }>({
      method: 'GET',
      path: '/v1/auth/account',
      accessToken: plain.tokens.accessToken,
    });
    assert.equal(view.body.account.freeDailyAiLimit, 0);
  } finally {
    await service.close();
  }
});
