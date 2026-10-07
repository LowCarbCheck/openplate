/**
 * An AI limit counted per week (2026-10-07), against real Postgres and the
 * real proxy. The week is Monday 00:00 UTC to the next Monday 00:00 UTC, and
 * its count is the sum of that week's `ai_usage_days` rows.
 *
 * THE CLAIMS, EACH WITH ITS CONTROL:
 *  1. A weekly paid limit sums Monday to today, and a spent week is a `429`
 *     whose `Retry-After` and `resetsAt` name the next Monday. Control: the
 *     day before Monday is not summed.
 *  2. NOTHING EXISTING GETS WORSE. A daily paid limit (the old Plus plan, 25 a
 *     day) with spending earlier in the same week is NOT refused today, and a
 *     Beta supporter's own free 10 a day stays per day on an instance whose
 *     default is weekly.
 *  3. The week resets on Monday at 00:00 UTC, not a millisecond later.
 *  4. Concurrent requests cannot overshoot the week: the window reserve takes
 *     a lock, so N parallel requests with 2 units left serve exactly 2.
 *  5. The account view reports the same sum and reset the proxy holds to.
 *  6. The column defaults every row to `'day'` and refuses any other value.
 *
 * The clock is pinned to a Wednesday at noon UTC, so no case crosses a day or
 * a week boundary by the wall clock.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { and, eq } from 'drizzle-orm';
import { NO_INSTANCE_STANDING, type InstanceStanding } from '../../src/accounts/instance-standing.js';
import type { AccountView, AiLimitPeriod } from '../../src/protocol.js';
import { accounts, aiUsageDays } from '../../src/db/schema.js';
import { sqlstate } from '../../src/lib/storage-conflict.js';
import { setupTestDatabase, type TestDatabase } from './db-harness.js';
import { startService, type HttpResponse, type ServiceHarness } from './service-harness.js';

const SCAN_BODY = { model: 'm', messages: [{ role: 'user', content: 'what is on this plate?' }] };

/** Wednesday 2026-10-07 12:00 UTC. The week began Monday 2026-10-05 and resets Monday 2026-10-12. */
const WEDNESDAY_NOON = Date.parse('2026-10-07T12:00:00.000Z');
const NEXT_MONDAY = '2026-10-12T00:00:00.000Z';
const SECONDS_TO_NEXT_MONDAY = (4 * 24 + 12) * 60 * 60;
const PAID_UNTIL = new Date('2026-12-01T00:00:00.000Z');
const CHECK_VIOLATION = '23514';

interface QuotaSpentBody {
  error?: string;
  code?: string;
  period?: string;
  used?: number;
  limit?: number;
  weight?: number;
  resetsAt?: string;
}

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

async function startInstance(
  input: { standing?: InstanceStanding; clockStartsAt?: number } = {},
): Promise<ServiceHarness> {
  return startService({
    db: database.db,
    ai: { baseUrl: upstreamBaseUrl, apiKey: 'sk-the-operators-key' },
    standing: input.standing ?? null,
    clockStartsAt: input.clockStartsAt ?? WEDNESDAY_NOON,
  });
}

function scan(service: ServiceHarness, accessToken: string): Promise<HttpResponse<QuotaSpentBody>> {
  return service.request<QuotaSpentBody>({
    method: 'POST',
    path: '/v1/chat/completions',
    accessToken,
    body: SCAN_BODY,
  });
}

/** Writes what the biller writes: a paid limit, its window and an end date in the future. */
async function grantPaid(input: { accountId: number; limit: number; period: AiLimitPeriod }): Promise<void> {
  await database.db
    .update(accounts)
    .set({
      dailyAiLimit: input.limit,
      aiLimitPeriod: input.period,
      allowanceExpiresAt: PAID_UNTIL,
      freeDailyAiLimit: 0,
    })
    .where(eq(accounts.id, input.accountId));
}

async function seedUsage(input: { accountId: number; day: string; count: number }): Promise<void> {
  await database.db.insert(aiUsageDays).values(input);
}

async function usageOn(input: { accountId: number; day: string }): Promise<number> {
  const rows = await database.db
    .select()
    .from(aiUsageDays)
    .where(and(eq(aiUsageDays.accountId, input.accountId), eq(aiUsageDays.day, input.day)));
  return rows[0]?.count ?? 0;
}

async function readQuota(service: ServiceHarness, accessToken: string): Promise<AccountView['aiQuota']> {
  const response = await service.request<{ account: AccountView }>({
    method: 'GET',
    path: '/v1/auth/account',
    accessToken,
  });
  assert.equal(response.status, 200);
  return response.body.account.aiQuota;
}

test('a weekly paid limit sums Monday to today, and a spent week is a 429 to the next Monday', async () => {
  const service = await startInstance();
  try {
    const session = await service.signupThroughInvite({ email: 'weekly@example.org' });
    const accountId = session.account.id;
    await grantPaid({ accountId, limit: 5, period: 'week' });
    // The Sunday before the week: NOT summed. Without the window it would spend the limit alone.
    await seedUsage({ accountId, day: '2026-10-04', count: 50 });
    await seedUsage({ accountId, day: '2026-10-05', count: 3 }); // Monday
    await seedUsage({ accountId, day: '2026-10-06', count: 1 }); // Tuesday

    const served = await scan(service, session.tokens.accessToken);
    assert.equal(served.status, 200, 'the week holds 4 of 5, so one more fits');
    assert.equal(served.headers.get('x-quota-used'), '5', 'Monday 3 + Tuesday 1 + this one');
    assert.equal(served.headers.get('x-quota-limit'), '5');
    assert.equal(await usageOn({ accountId, day: '2026-10-07' }), 1, 'the unit lands on today, one row per day');

    assert.deepEqual(await readQuota(service, session.tokens.accessToken), {
      kind: 'paid',
      limit: 5,
      period: 'week',
      used: 5,
      resetsAt: NEXT_MONDAY,
    });

    const spent = await scan(service, session.tokens.accessToken);
    assert.equal(spent.status, 429);
    assert.equal(Number(spent.headers.get('retry-after')), SECONDS_TO_NEXT_MONDAY);
    assert.equal(spent.body.code, 'ai-quota-spent');
    assert.equal(spent.body.period, 'week');
    assert.equal(spent.body.used, 5);
    assert.equal(spent.body.limit, 5);
    assert.equal(spent.body.resetsAt, NEXT_MONDAY);
    assert.match(spent.body.error ?? '', /^weekly quota spent: 5 of 5 units used/);
    assert.equal(await usageOn({ accountId, day: '2026-10-07' }), 1, 'the refused request was not counted');
    assert.equal(upstreamCalls, 1, 'and nothing left the host for it');
  } finally {
    await service.close();
  }
});

test('CONTROL: the old daily plan with spending earlier this week is not refused today', async () => {
  const service = await startInstance();
  try {
    const session = await service.signupThroughInvite({ email: 'legacy-plus@example.org' });
    const accountId = session.account.id;
    // A legacy Plus subscriber: 25 a day, and 24 spent on each of Monday and Tuesday.
    await grantPaid({ accountId, limit: 25, period: 'day' });
    await seedUsage({ accountId, day: '2026-10-05', count: 24 });
    await seedUsage({ accountId, day: '2026-10-06', count: 24 });

    const served = await scan(service, session.tokens.accessToken);
    assert.equal(served.status, 200, 'a daily limit is never summed over the week');
    assert.equal(served.headers.get('x-quota-used'), '1', 'today alone');
    assert.equal(served.headers.get('x-quota-limit'), '25');
    assert.deepEqual(await readQuota(service, session.tokens.accessToken), {
      kind: 'paid',
      limit: 25,
      period: 'day',
      used: 1,
      resetsAt: '2026-10-08T00:00:00.000Z',
    });

    // And it still resets daily: spend today to the limit, and the refusal names tomorrow.
    await database.db
      .update(aiUsageDays)
      .set({ count: 25 })
      .where(and(eq(aiUsageDays.accountId, accountId), eq(aiUsageDays.day, '2026-10-07')));
    const spent = await scan(service, session.tokens.accessToken);
    assert.equal(spent.status, 429);
    assert.equal(spent.body.period, 'day');
    assert.equal(spent.body.resetsAt, '2026-10-08T00:00:00.000Z');
    assert.equal(Number(spent.headers.get('retry-after')), 12 * 60 * 60);
    assert.match(spent.body.error ?? '', /^daily quota spent: 25 of 25 units used/);
  } finally {
    await service.close();
  }
});

test('a Beta supporter keeps ten a day on an instance whose free default is weekly', async () => {
  const service = await startInstance({
    standing: { ...NO_INSTANCE_STANDING, defaultFreeAiLimit: { limit: 10, period: 'week' } },
  });
  try {
    const supporter = await service.signupThroughInvite({ email: 'supporter@example.org', dailyAiLimit: 10 });
    const fresh = await service.signupThroughInvite({ email: 'fresh@example.org' });
    const [supporterRow] = await database.db.select().from(accounts).where(eq(accounts.id, supporter.account.id));
    assert.equal(supporterRow?.freeDailyAiLimit, 10, 'an operator invite writes the own free grant');
    assert.equal(supporterRow?.aiLimitPeriod, 'day');
    // Both spent 9 on Monday.
    await seedUsage({ accountId: supporter.account.id, day: '2026-10-05', count: 9 });
    await seedUsage({ accountId: fresh.account.id, day: '2026-10-05', count: 9 });

    // The supporter: today is a new day, so two scans fit, whatever Monday held.
    assert.equal((await scan(service, supporter.tokens.accessToken)).status, 200);
    const second = await scan(service, supporter.tokens.accessToken);
    assert.equal(second.status, 200);
    assert.equal(second.headers.get('x-quota-used'), '2');

    // THE CONTROL, the same spending on the weekly default: one scan left in the week.
    const last = await scan(service, fresh.tokens.accessToken);
    assert.equal(last.status, 200);
    assert.equal(last.headers.get('x-quota-used'), '10');
    const refused = await scan(service, fresh.tokens.accessToken);
    assert.equal(refused.status, 429);
    assert.equal(refused.body.period, 'week');
    assert.equal(refused.body.resetsAt, NEXT_MONDAY);
    assert.deepEqual(await readQuota(service, fresh.tokens.accessToken), {
      kind: 'free',
      limit: 10,
      period: 'week',
      used: 10,
      resetsAt: NEXT_MONDAY,
    });
  } finally {
    await service.close();
  }
});

test('a Beta supporter who buys Basic keeps ten a day: the paid floor, through the real proxy', async () => {
  const service = await startInstance({
    standing: { ...NO_INSTANCE_STANDING, defaultFreeAiLimit: { limit: 10, period: 'week' } },
  });
  try {
    const supporter = await service.signupThroughInvite({ email: 'supporter@example.org', dailyAiLimit: 10 });
    const buyer = await service.signupThroughInvite({ email: 'buyer@example.org', dailyAiLimit: 10 });
    // What the biller writes for Basic (20 a week) and for Max (100 a week).
    // The own free grant of 10 a day stays on both rows.
    for (const [accountId, limit] of [
      [supporter.account.id, 20],
      [buyer.account.id, 100],
    ] as const) {
      await database.db
        .update(accounts)
        .set({ dailyAiLimit: limit, aiLimitPeriod: 'week', allowanceExpiresAt: PAID_UNTIL })
        .where(eq(accounts.id, accountId));
    }
    // Both spent 20 this week already, 10 on Monday and 10 on Tuesday.
    for (const accountId of [supporter.account.id, buyer.account.id]) {
      await seedUsage({ accountId, day: '2026-10-05', count: 10 });
      await seedUsage({ accountId, day: '2026-10-06', count: 10 });
    }

    // Basic: 20 a week would be spent. 10 a day (70 a week) is larger, so
    // today opens fresh, per day, exactly as before the purchase.
    const today = await scan(service, supporter.tokens.accessToken);
    assert.equal(today.status, 200);
    assert.equal(today.headers.get('x-quota-used'), '1');
    assert.equal(today.headers.get('x-quota-limit'), '10');
    assert.deepEqual(await readQuota(service, supporter.tokens.accessToken), {
      kind: 'free',
      limit: 10,
      period: 'day',
      used: 1,
      resetsAt: '2026-10-08T00:00:00.000Z',
    });

    // THE CONTROL: Max is larger than 70 a week, so the plan counts, summed over the week.
    const max = await scan(service, buyer.tokens.accessToken);
    assert.equal(max.status, 200);
    assert.equal(max.headers.get('x-quota-used'), '21');
    assert.equal(max.headers.get('x-quota-limit'), '100');
  } finally {
    await service.close();
  }
});

test('a spent week opens again at Monday 00:00 UTC, and not before', async () => {
  // Sunday 23:59:59.999 UTC, the last instant of the week. The session is
  // minted at this instant, so the access token outlives the step below.
  const service = await startInstance({ clockStartsAt: Date.parse('2026-10-11T23:59:59.999Z') });
  try {
    const session = await service.signupThroughInvite({ email: 'monday@example.org' });
    const accountId = session.account.id;
    await grantPaid({ accountId, limit: 2, period: 'week' });
    await seedUsage({ accountId, day: '2026-10-05', count: 2 });

    // Still the old week.
    const sunday = await scan(service, session.tokens.accessToken);
    assert.equal(sunday.status, 429);
    assert.equal(Number(sunday.headers.get('retry-after')), 1, 'one millisecond left, rounded up to a second');

    // One millisecond later: the new week, empty.
    service.advance(1);
    const monday = await scan(service, session.tokens.accessToken);
    assert.equal(monday.status, 200);
    assert.equal(monday.headers.get('x-quota-used'), '1');
  } finally {
    await service.close();
  }
});

test('parallel requests cannot overshoot a week: two units left serve exactly two', async () => {
  const service = await startInstance();
  try {
    const session = await service.signupThroughInvite({ email: 'race@example.org' });
    const accountId = session.account.id;
    await grantPaid({ accountId, limit: 10, period: 'week' });
    // Spent on Monday, so the week's sum and today's row are different rows:
    // a guard that read only today's row would let all six through.
    await seedUsage({ accountId, day: '2026-10-05', count: 8 });

    const responses = await Promise.all(Array.from({ length: 6 }, () => scan(service, session.tokens.accessToken)));
    const statuses = responses.map((response) => response.status).toSorted();
    assert.deepEqual(statuses, [200, 200, 429, 429, 429, 429]);
    assert.equal(await usageOn({ accountId, day: '2026-10-07' }), 2);
    assert.equal(upstreamCalls, 2);
  } finally {
    await service.close();
  }
});

test('every account row holds day unless something writes week, and no third value is stored', async () => {
  const service = await startInstance();
  try {
    const session = await service.signupThroughInvite({ email: 'column@example.org' });
    const [row] = await database.db.select().from(accounts).where(eq(accounts.id, session.account.id));
    assert.equal(row?.aiLimitPeriod, 'day');

    const id = session.account.id;
    await assert.rejects(
      database.pool.query(`UPDATE accounts SET ai_limit_period = 'month' WHERE id = $1`, [id]),
      (error: Error) => sqlstate(error) === CHECK_VIOLATION && error.message.includes('accounts_ai_limit_period'),
    );
    // THE CONTROL: the two known values are accepted.
    await database.pool.query(`UPDATE accounts SET ai_limit_period = 'week' WHERE id = $1`, [id]);
    await database.pool.query(`UPDATE accounts SET ai_limit_period = 'day' WHERE id = $1`, [id]);
  } finally {
    await service.close();
  }
});
