/**
 * A large request on each grant, against real Postgres (2026-09-30, made one
 * unit on 2026-10-07).
 *
 * TWO BRANCHES MEET IN ONE LINE of `ai/proxy.ts`. The cost pass made every
 * reservation carry a `weight`, the free-tier pass made `accounts/ai-allowance.ts`
 * pick the limit the reservation is held to. Until 2026-10-07 a request near
 * the text bound weighed 2. The owner then decided that one action a person
 * starts is ONE scan, whatever its size, so this suite now sends a 47 KB
 * request, just under the 48 KB bound, down all three grants and checks:
 *
 *  - the reservation takes ONE unit, against the limit the grant picked
 *    (`X-Quota-Limit` names it, and the row holds the count);
 *  - the request that no longer fits the picked limit is 429, even where the
 *    other limit on the row would have let it through;
 *  - a release gives the one unit back, on the account and on the ceiling
 *    the grant counts against;
 *  - THE CONTROL: one byte over the bound is still 400 and counts nothing, so
 *    the size bound, not a weight, is the guard on size.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import { accounts, aiInstanceDays, aiUsageDays } from '../../src/db/schema.js';
import { setupTestDatabase, type TestDatabase } from './db-harness.js';
import { startService, type HttpResponse, type ServiceHarness } from './service-harness.js';

const UPSTREAM_KEY = 'sk-the-operators-own-provider-key';
const PEPPER = 'a-trial-address-pepper-that-is-long-enough-0123';
const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** About 12,000 estimated input tokens: two units under the old weight, one now. Under the 48 KB bound. */
const HEAVY_TEXT_BYTES = 47 * 1024;
/** One byte over `AI_MAX_TEXT_BYTES`' default. */
const OVERSIZE_TEXT_BYTES = 48 * 1024 + 1;

let database: TestDatabase;
let upstream: Server;
let upstreamBaseUrl: string;
/** The status the fake provider answers with next. */
let upstreamStatus: number;

before(async () => {
  database = await setupTestDatabase();
  upstream = createServer((request: IncomingMessage, response: ServerResponse) => {
    request.resume();
    request.on('end', () => {
      response.writeHead(upstreamStatus, { 'content-type': 'application/json' });
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
  upstreamStatus = 200;
});

async function startWithCeilings(): Promise<ServiceHarness> {
  return startService({
    db: database.db,
    trial: { scans: 10, dailyAiLimit: 50 },
    trialAddressPepper: PEPPER,
    ai: {
      baseUrl: upstreamBaseUrl,
      apiKey: UPSTREAM_KEY,
      timeoutMs: 2_000,
      instanceDailyLimit: 100,
      trialInstanceDailyLimit: 100,
    },
  });
}

function complete(
  service: ServiceHarness,
  input: { token: string; textBytes: number; intakeId?: string },
): Promise<HttpResponse<unknown>> {
  const headers: Record<string, string> = {};
  if (input.intakeId !== undefined) headers['x-intake-id'] = input.intakeId;
  return service.request<unknown>({
    method: 'POST',
    path: '/v1/chat/completions',
    accessToken: input.token,
    headers,
    body: { model: 'm', messages: [{ role: 'user', content: 'x'.repeat(input.textBytes) }] },
  });
}

async function usageOf(accountId: number): Promise<number> {
  const rows = await database.db.select().from(aiUsageDays).where(eq(aiUsageDays.accountId, accountId));
  return rows[0]?.count ?? 0;
}

interface InstanceDay {
  count: number;
  trialCount: number;
}

async function instanceDay(): Promise<InstanceDay> {
  const [row] = await database.db.select().from(aiInstanceDays);
  return { count: row?.count ?? 0, trialCount: row?.trialCount ?? 0 };
}

async function standingOf(accountId: number): Promise<{ dailyAiLimit: number; freeDailyAiLimit: number }> {
  const [row] = await database.db
    .select({ dailyAiLimit: accounts.dailyAiLimit, freeDailyAiLimit: accounts.freeDailyAiLimit })
    .from(accounts)
    .where(eq(accounts.id, accountId));
  if (row === undefined) throw new Error(`no account ${accountId}`);
  return row;
}

test('the free grant: a large request is one unit against freeDailyAiLimit, refused past it, released whole', async () => {
  const service = await startWithCeilings();
  try {
    // An operator's invite without a trial writes the free grant, paid 0.
    const session = await service.signupThroughInvite({ email: 'free@example.org', dailyAiLimit: 5 });
    const accountId = session.account.id;
    const token = session.tokens.accessToken;
    assert.deepEqual(await standingOf(accountId), { dailyAiLimit: 0, freeDailyAiLimit: 5 });

    // A provider refusal gives the unit back, on the account and the instance.
    upstreamStatus = 400;
    assert.equal((await complete(service, { token, textBytes: HEAVY_TEXT_BYTES })).status, 400);
    assert.equal(await usageOf(accountId), 0);
    assert.deepEqual(await instanceDay(), { count: 0, trialCount: 0 });

    upstreamStatus = 200;
    for (let used = 1; used <= 5; used += 1) {
      const response = await complete(service, { token, textBytes: HEAVY_TEXT_BYTES });
      assert.equal(response.status, 200, `large request ${used}`);
      assert.equal(response.headers.get('x-quota-used'), String(used));
      assert.equal(response.headers.get('x-quota-limit'), '5');
    }
    assert.equal(await usageOf(accountId), 5);

    // 5 + 1 > 5: refused, and the instance's unit goes back.
    const refused = await complete(service, { token, textBytes: HEAVY_TEXT_BYTES });
    assert.equal(refused.status, 429);
    assert.equal(refused.headers.get('x-quota-limit'), '5');
    assert.equal(await usageOf(accountId), 5);
    assert.deepEqual(await instanceDay(), { count: 5, trialCount: 0 });

    // THE CONTROL: one byte over the bound is refused before any count.
    const oversize = await complete(service, { token, textBytes: OVERSIZE_TEXT_BYTES });
    assert.equal(oversize.status, 400);
    assert.deepEqual(oversize.body, { error: 'ai-request-too-large', limit: 'text-bytes', max: 48 * 1024 });
    assert.equal(await usageOf(accountId), 5);
    assert.deepEqual(await instanceDay(), { count: 5, trialCount: 0 });
  } finally {
    await service.close();
  }
});

test('the paid window: a large request is one unit against dailyAiLimit, then held to the free limit once it ends', async () => {
  const service = await startWithCeilings();
  try {
    const session = await service.signupThroughInvite({ email: 'paid@example.org', dailyAiLimit: 1 });
    const accountId = session.account.id;
    const token = session.tokens.accessToken;
    // The biller's shape: a paid limit and a date, over a free grant of 3.
    await database.db
      .update(accounts)
      .set({ dailyAiLimit: 7, freeDailyAiLimit: 3, allowanceExpiresAt: new Date(service.now() + 30 * MS_PER_DAY) })
      .where(eq(accounts.id, accountId));

    upstreamStatus = 400;
    assert.equal((await complete(service, { token, textBytes: HEAVY_TEXT_BYTES })).status, 400);
    assert.equal(await usageOf(accountId), 0, 'the release gave back the unit');
    assert.deepEqual(await instanceDay(), { count: 0, trialCount: 0 });

    upstreamStatus = 200;
    for (let used = 1; used <= 4; used += 1) {
      const paid = await complete(service, { token, textBytes: HEAVY_TEXT_BYTES });
      assert.equal(paid.status, 200, `large request ${used}`);
      assert.equal(paid.headers.get('x-quota-used'), String(used));
      // THE CONTROL for the switch below: the fourth is past the free 3 and fits the paid 7.
      assert.equal(paid.headers.get('x-quota-limit'), '7');
    }

    // The window ends. 4 + 1 fits the paid 7 still on the row, not the free 3.
    await database.db
      .update(accounts)
      .set({ allowanceExpiresAt: new Date(service.now() - 1) })
      .where(eq(accounts.id, accountId));
    const refused = await complete(service, { token, textBytes: HEAVY_TEXT_BYTES });
    assert.equal(refused.status, 429);
    assert.equal(refused.headers.get('x-quota-limit'), '3');
    assert.equal(await usageOf(accountId), 4);
    assert.deepEqual(await instanceDay(), { count: 4, trialCount: 0 });
  } finally {
    await service.close();
  }
});

test('the scan trial: a large request is one unit on the account and the trial ceiling, released whole on both', async () => {
  const service = await startWithCeilings();
  try {
    const session = await service.signupThroughInvite({ email: 'trial@example.org', dailyAiLimit: 3, trialScans: 10 });
    const accountId = session.account.id;
    const token = session.tokens.accessToken;
    assert.deepEqual(await standingOf(accountId), { dailyAiLimit: 3, freeDailyAiLimit: 0 });

    upstreamStatus = 400;
    const refusedUpstream = await complete(service, {
      token,
      textBytes: HEAVY_TEXT_BYTES,
      intakeId: 'intake000000000a',
    });
    assert.equal(refusedUpstream.status, 400);
    assert.equal(await usageOf(accountId), 0);
    assert.deepEqual(await instanceDay(), { count: 0, trialCount: 0 }, 'the trial ceiling got the unit back');

    upstreamStatus = 200;
    for (const [index, intakeId] of ['intake000000000b', 'intake000000000c', 'intake000000000d'].entries()) {
      const scanned = await complete(service, { token, textBytes: HEAVY_TEXT_BYTES, intakeId });
      assert.equal(scanned.status, 200, intakeId);
      assert.equal(scanned.headers.get('x-quota-used'), String(index + 1));
      assert.equal(scanned.headers.get('x-quota-limit'), '3');
    }
    // The trial has its own ceiling, so the instance's is not charged.
    assert.deepEqual(await instanceDay(), { count: 0, trialCount: 3 });

    // 3 + 1 > 3: refused, the trial ceiling's unit and the scan go back.
    const refused = await complete(service, { token, textBytes: HEAVY_TEXT_BYTES, intakeId: 'intake000000000e' });
    assert.equal(refused.status, 429);
    assert.equal(await usageOf(accountId), 3);
    assert.deepEqual(await instanceDay(), { count: 0, trialCount: 3 });
    const [row] = await database.db
      .select({ used: accounts.trialScansUsed })
      .from(accounts)
      .where(eq(accounts.id, accountId));
    assert.equal(row?.used, 3, 'only the delivered scans are spent');
  } finally {
    await service.close();
  }
});
