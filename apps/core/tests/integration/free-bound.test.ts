/**
 * The opt-in bounds on free-grant traffic (2026-10-07, `ai/free-bound.ts`),
 * against real Postgres.
 *
 *  1. `AI_FREE_INSTANCE_DAILY_LIMIT` bounds every free account together, and
 *     takes free traffic out of `AI_INSTANCE_DAILY_LIMIT`, so that ceiling is
 *     the paying accounts' alone.
 *  2. `AI_FREE_NETWORK_DAILY_LIMIT` bounds one caller network's free traffic,
 *     and stores a keyed hash, never the address.
 *  3. Unset means off: no row and no column is written, and free requests
 *     count against the instance ceiling exactly as before.
 *  4. A refusal on the person's own limit gives the free units back.
 *  5. A paying account the paid floor holds to its own free grant is paid
 *     traffic, and is not bounded as free.
 *
 * Every request here arrives from one loopback address, which is one network.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import { accounts, aiFreeNetworkDays, aiInstanceDays, aiUsageDays } from '../../src/db/schema.js';
import { setupTestDatabase, type TestDatabase } from './db-harness.js';
import { startService, type HttpResponse, type ServiceHarness } from './service-harness.js';

const SCAN_BODY = { model: 'm', messages: [{ role: 'user', content: 'what is on this plate?' }] };
const PAID_UNTIL = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

let database: TestDatabase;
let upstream: Server;
let upstreamBaseUrl: string;

before(async () => {
  database = await setupTestDatabase();
  upstream = createServer((request, response) => {
    request.resume();
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: 'rice' } }] }));
    });
  });
  upstream.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => upstream.once('listening', resolve));
  // SAFETY: `listen(0, host)` binds a TCP port, so the address is never a string.
  upstreamBaseUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
  await database.close();
});

beforeEach(async () => {
  await database.reset();
});

async function startInstance(input: {
  instanceDailyLimit?: number | null;
  freeInstanceDailyLimit?: number | null;
  freeNetworkDailyLimit?: number | null;
}): Promise<ServiceHarness> {
  return startService({
    db: database.db,
    ai: {
      baseUrl: upstreamBaseUrl,
      apiKey: 'sk-the-operators-key',
      instanceDailyLimit: input.instanceDailyLimit ?? null,
      freeInstanceDailyLimit: input.freeInstanceDailyLimit ?? null,
      freeNetworkDailyLimit: input.freeNetworkDailyLimit ?? null,
    },
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

/** An account on a free grant of its own, `limit` a day, as an operator's invite writes it. */
async function freeAccount(input: { service: ServiceHarness; email: string; limit?: number }) {
  return input.service.signupThroughInvite({ email: input.email, dailyAiLimit: input.limit ?? 50 });
}

/** What the biller writes for a paying account: a paid limit and a date in the future. */
async function makePaying(input: { accountId: number; limit: number; period: 'day' | 'week' }): Promise<void> {
  await database.db
    .update(accounts)
    .set({ dailyAiLimit: input.limit, aiLimitPeriod: input.period, allowanceExpiresAt: PAID_UNTIL })
    .where(eq(accounts.id, input.accountId));
}

async function instanceDay(): Promise<{ count: number; freeCount: number } | null> {
  const [row] = await database.db.select().from(aiInstanceDays);
  return row === undefined ? null : { count: row.count, freeCount: row.freeCount };
}

async function usageOf(accountId: number): Promise<number> {
  const rows = await database.db.select().from(aiUsageDays).where(eq(aiUsageDays.accountId, accountId));
  return rows.reduce((sum, row) => sum + row.count, 0);
}

test('the free ceiling bounds every free account together, and keeps the instance ceiling for the paying ones', async () => {
  const service = await startInstance({ instanceDailyLimit: 100, freeInstanceDailyLimit: 2 });
  try {
    const first = await freeAccount({ service, email: 'first@example.org' });
    const second = await freeAccount({ service, email: 'second@example.org' });
    const paying = await freeAccount({ service, email: 'paying@example.org' });
    await makePaying({ accountId: paying.account.id, limit: 40, period: 'week' });

    assert.equal((await scan(service, first.tokens.accessToken)).status, 200);
    assert.equal((await scan(service, first.tokens.accessToken)).status, 200);
    const refused = await scan(service, second.tokens.accessToken);
    assert.equal(refused.status, 503);
    assert.deepEqual(refused.body, { error: 'ai-instance-ceiling' });
    assert.ok(Number(refused.headers.get('retry-after')) > 0);
    assert.equal(await usageOf(second.account.id), 0, 'the refused person spent nothing of their own');

    // THE CONTROL: the paying account is not free traffic, and is served.
    assert.equal((await scan(service, paying.tokens.accessToken)).status, 200);
    // Free requests counted on their own column, never on the instance's.
    assert.deepEqual(await instanceDay(), { count: 1, freeCount: 2 });
  } finally {
    await service.close();
  }
});

test('the free network bound refuses one network past its share, keeps no address, and spares paying accounts', async () => {
  const service = await startInstance({ freeNetworkDailyLimit: 2 });
  try {
    const first = await freeAccount({ service, email: 'first@example.org' });
    const second = await freeAccount({ service, email: 'second@example.org' });
    const paying = await freeAccount({ service, email: 'paying@example.org' });
    await makePaying({ accountId: paying.account.id, limit: 40, period: 'week' });

    assert.equal((await scan(service, first.tokens.accessToken)).status, 200);
    assert.equal((await scan(service, second.tokens.accessToken)).status, 200);
    // A third free account on the same network is past the share.
    const third = await freeAccount({ service, email: 'third@example.org' });
    assert.equal((await scan(service, third.tokens.accessToken)).status, 503);
    // THE CONTROL: the paying account on the same network is served.
    assert.equal((await scan(service, paying.tokens.accessToken)).status, 200);

    const rows = await database.db.select().from(aiFreeNetworkDays);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.count, 2);
    assert.match(rows[0]?.networkHash ?? '', /^[0-9a-f]{64}$/);
    assert.ok(!(rows[0]?.networkHash ?? '').includes('127.0.0.1'));
  } finally {
    await service.close();
  }
});

test('unset means off: nothing written for the free bounds, and free traffic counts against the instance ceiling as before', async () => {
  const service = await startInstance({ instanceDailyLimit: 100 });
  try {
    const free = await freeAccount({ service, email: 'free@example.org' });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      assert.equal((await scan(service, free.tokens.accessToken)).status, 200);
    }
    assert.deepEqual(await instanceDay(), { count: 3, freeCount: 0 });
    assert.equal((await database.db.select().from(aiFreeNetworkDays)).length, 0);
  } finally {
    await service.close();
  }
});

test('a refusal on the person own limit gives the free ceiling and network units back', async () => {
  const service = await startInstance({ freeInstanceDailyLimit: 10, freeNetworkDailyLimit: 10 });
  try {
    const free = await freeAccount({ service, email: 'free@example.org', limit: 1 });
    assert.equal((await scan(service, free.tokens.accessToken)).status, 200);
    const refused = await scan(service, free.tokens.accessToken);
    assert.equal(refused.status, 429);
    assert.deepEqual(await instanceDay(), { count: 0, freeCount: 1 });
    const [network] = await database.db.select().from(aiFreeNetworkDays);
    assert.equal(network?.count, 1, 'the refused request gave its network unit back');
  } finally {
    await service.close();
  }
});

test('a paying account the paid floor holds to its own free grant is not bounded as free', async () => {
  const service = await startInstance({ freeInstanceDailyLimit: 1 });
  try {
    const free = await freeAccount({ service, email: 'free@example.org', limit: 10 });
    const supporter = await freeAccount({ service, email: 'supporter@example.org', limit: 10 });
    // A paid plan at 20 a week is below the supporter's own 10 a day: the floor holds them to the free grant.
    await makePaying({ accountId: supporter.account.id, limit: 20, period: 'week' });

    assert.equal((await scan(service, free.tokens.accessToken)).status, 200);
    // THE CONTROL: the free ceiling is now spent for free traffic.
    assert.equal((await scan(service, free.tokens.accessToken)).status, 503);
    const served = await scan(service, supporter.tokens.accessToken);
    assert.equal(served.status, 200);
    assert.equal(served.headers.get('x-quota-limit'), '10');
    assert.deepEqual(await instanceDay(), { count: 0, freeCount: 1 });
  } finally {
    await service.close();
  }
});
