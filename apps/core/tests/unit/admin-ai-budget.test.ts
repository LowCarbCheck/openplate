/**
 * `GET /v1/admin/ai/budget` (2026-09-30): who may read it, what the body is,
 * and how often the provider is asked.
 *
 * ── THROUGH THE REAL APP ─────────────────────────────────────────────────
 *
 * Every request goes through `createApp` on a loopback port
 * (`admin-harness.ts`), so the admin door and the billing scope in front of
 * the route are the production ones. The provider is a counting fake `fetch`
 * behind the REAL cached source (`ai/upstream-budget.ts`), so "one upstream
 * read for two calls" is a count of requests, not of calls to a stub.
 *
 * ── THE CONTROLS ─────────────────────────────────────────────────────────
 *
 *  - The billing and member refusals sit beside an operator read that answers
 *    200 on the same instance. A route that did not exist would refuse all
 *    three and prove nothing.
 *  - The cache test moves the clock past 60 seconds and requires a SECOND
 *    request, so a source that never asked again would fail it.
 *  - The secret test plants the key and a label in the provider's answer and
 *    requires both absent from the body and from every log line.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { hashToken } from '../../src/lib/tokens.js';
import { asObject, asString, type JsonObject, type JsonValue } from '../../src/lib/json.js';
import type { AiCapacityReader, AiDayCapacityUsage } from '../../src/ai/quota-store.js';
import {
  UPSTREAM_BUDGET_FAILED_TTL_MS,
  UPSTREAM_BUDGET_OK_TTL_MS,
  createUpstreamBudgetSource,
  parseOpenRouterKeyBody,
  type FetchKey,
  type UpstreamBudgetSource,
} from '../../src/ai/upstream-budget.js';
import { createSilentLogger } from '../../src/logger.js';
import { startAdminHarness, createCapturingLogger, type AdminHarness } from './admin-harness.js';

const ADMIN_TOKEN = 'admin-token-for-the-budget-suite-0123456789';
const BILLING_TOKEN = 'billing-token-for-the-budget-suite-0123456789';
const PROVIDER_KEY = 'sk-or-v1-provider-key-that-must-not-leak';
const KEY_LABEL = 'sk-or-v1-abc...label-that-must-not-leak';
const BUDGET_PATH = '/v1/admin/ai/budget';

/** OpenRouter's answer, as checked live on 2026-09-30, with the label and flag this service must drop. */
const OPENROUTER_BODY = {
  data: {
    label: KEY_LABEL,
    limit: 5,
    limit_remaining: 3.94,
    limit_reset: 'monthly',
    usage: 1.06,
    usage_daily: 0.12,
    usage_weekly: 0.4,
    usage_monthly: 1.06,
    is_free_tier: false,
  },
};

const harnesses: AdminHarness[] = [];

after(async () => {
  for (const harness of harnesses) await harness.close();
});

/** A clock the test moves. The source and the harness both read it. */
class TestClock {
  private ms = Date.parse('2026-09-30T10:00:00.000Z');
  now = (): Date => new Date(this.ms);
  advance(ms: number): void {
    this.ms += ms;
  }
}

/** A fake provider that counts requests and answers what the test set. */
class FakeProvider {
  requests = 0;
  authorizations: string[] = [];
  answer: () => Promise<Response> = async () => Response.json(OPENROUTER_BODY);
  fetchKey: FetchKey = async (_url, init) => {
    this.requests += 1;
    this.authorizations.push(init.headers.Authorization ?? '');
    return this.answer();
  };
}

function capacityOf(usage: AiDayCapacityUsage): AiCapacityReader & { days: string[] } {
  const days: string[] = [];
  return {
    days,
    async readDay(input: { day: string }): Promise<AiDayCapacityUsage> {
      days.push(input.day);
      return usage;
    },
  };
}

async function start(input: {
  upstream: UpstreamBudgetSource | null;
  capacity?: AiCapacityReader;
  withBudget?: boolean;
}): Promise<AdminHarness> {
  const harness = await startAdminHarness({
    adminToken: ADMIN_TOKEN,
    billingToken: BILLING_TOKEN,
    aiInstanceDailyLimit: 2000,
    aiTrialInstanceDailyLimit: 500,
    aiBudget:
      input.withBudget === false
        ? undefined
        : { capacity: input.capacity ?? capacityOf({ paid: 42, trial: 7 }), upstream: input.upstream },
  });
  harnesses.push(harness);
  return harness;
}

function sourceFor(input: { provider: FakeProvider; clock: TestClock; timeoutMs?: number }): UpstreamBudgetSource {
  return createUpstreamBudgetSource({
    keyUrl: 'https://openrouter.ai/api/v1/key',
    apiKey: PROVIDER_KEY,
    logger: createSilentLogger(),
    now: input.clock.now,
    fetchKey: input.provider.fetchKey,
    timeoutMs: input.timeoutMs,
  });
}

async function readBudget(harness: AdminHarness, token: string | null = ADMIN_TOKEN): Promise<Response> {
  return harness.request({ method: 'GET', path: BUDGET_PATH, token });
}

async function bodyOf(response: Response): Promise<JsonObject> {
  // SAFETY: `Response.json()` yields parsed JSON; `asObject` proves it is an object.
  const body = asObject((await response.json()) as JsonValue);
  if (body === null) throw new Error('expected a JSON object');
  return body;
}

// ---------------------------------------------------------------------------
// The door
// ---------------------------------------------------------------------------

test('the operator reads the budget, and the billing token is refused at the scope', async () => {
  const harness = await start({ upstream: sourceFor({ provider: new FakeProvider(), clock: new TestClock() }) });

  const asOperator = await readBudget(harness);
  assert.equal(asOperator.status, 200, 'the route exists and the operator reaches it');

  const asBilling = await readBudget(harness, BILLING_TOKEN);
  assert.equal(asBilling.status, 403);
  assert.equal(asString((await bodyOf(asBilling)).error), 'service-scope');
});

test("a member's valid session gets the answer a garbage token gets", async () => {
  const harness = await start({ upstream: sourceFor({ provider: new FakeProvider(), clock: new TestClock() }) });
  const member = await harness.fakeAccounts.seedAccount({ email: 'member@example.org', role: 'member' });
  await harness.fakeAccounts.insertTokens([
    {
      accountId: member.id,
      kind: 'access',
      tokenHash: hashToken('a-member-session-token-for-budget'),
      familyId: 'family-member-budget',
      expiresAt: new Date(harness.fixture.now().getTime() + 60_000),
    },
  ]);

  const asMember = await readBudget(harness, 'a-member-session-token-for-budget');
  const asGarbage = await readBudget(harness, 'z'.repeat(41));
  assert.equal(asMember.status, 401);
  assert.equal(await asMember.text(), await asGarbage.text());

  // The control: the operator on the same instance is let through.
  assert.equal((await readBudget(harness)).status, 200);
});

test('an instance with no budget surface answers the ordinary 404', async () => {
  const harness = await start({ upstream: null, withBudget: false });
  assert.equal((await readBudget(harness)).status, 404);
});

// ---------------------------------------------------------------------------
// The body
// ---------------------------------------------------------------------------

test('the body names the day, both counters against their limits, and the key budget', async () => {
  const capacity = capacityOf({ paid: 42, trial: 7 });
  const harness = await start({
    capacity,
    upstream: sourceFor({ provider: new FakeProvider(), clock: new TestClock() }),
  });

  const body = await bodyOf(await readBudget(harness));
  const day = harness.fixture.now().toISOString().slice(0, 10);
  assert.deepEqual(Object.keys(body).toSorted(), ['capacity', 'day', 'upstream']);
  assert.equal(body.day, day);
  assert.deepEqual(capacity.days, [day], 'the counters are read for the day the body names');
  assert.deepEqual(body.capacity, { paid: { used: 42, limit: 2000 }, trial: { used: 7, limit: 500 } });
  assert.deepEqual(body.upstream, {
    status: 'ok',
    limitUsd: 5,
    remainingUsd: 3.94,
    reset: 'monthly',
    usageDailyUsd: 0.12,
    usageWeeklyUsd: 0.4,
    usageMonthlyUsd: 1.06,
    checkedAt: '2026-09-30T10:00:00.000Z',
  });
});

test('an upstream that is not OpenRouter reports upstream null and still reports capacity', async () => {
  const harness = await start({ upstream: null });
  const body = await bodyOf(await readBudget(harness));
  assert.equal(body.upstream, null);
  assert.deepEqual(body.capacity, { paid: { used: 42, limit: 2000 }, trial: { used: 7, limit: 500 } });
});

test('a key with no limit reports nulls, not zeroes', async () => {
  const provider = new FakeProvider();
  provider.answer = async () =>
    Response.json({ data: { ...OPENROUTER_BODY.data, limit: null, limit_remaining: null, limit_reset: null } });
  const harness = await start({ upstream: sourceFor({ provider, clock: new TestClock() }) });
  const upstream = asObject((await bodyOf(await readBudget(harness))).upstream);
  assert.equal(upstream?.status, 'ok');
  assert.equal(upstream?.limitUsd, null);
  assert.equal(upstream?.remainingUsd, null);
  assert.equal(upstream?.reset, null);
});

test('neither the provider key nor the key label reaches the body or a log line', async () => {
  const capturing = createCapturingLogger();
  const provider = new FakeProvider();
  const source = createUpstreamBudgetSource({
    keyUrl: 'https://openrouter.ai/api/v1/key',
    apiKey: PROVIDER_KEY,
    logger: capturing.logger,
    now: new TestClock().now,
    fetchKey: provider.fetchKey,
  });
  const harness = await start({ upstream: source });

  const text = await (await readBudget(harness)).text();
  assert.ok(!text.includes(PROVIDER_KEY), 'the key is not in the body');
  assert.ok(!text.includes(KEY_LABEL), 'the label is not in the body');
  assert.ok(!text.includes('label'), 'no label field at all');
  // The key DID travel, as the bearer of the one provider request.
  assert.deepEqual(provider.authorizations, [`Bearer ${PROVIDER_KEY}`]);

  // A failed read logs too; neither log may carry the key or the label.
  provider.answer = async () =>
    new Response(JSON.stringify({ error: PROVIDER_KEY, label: KEY_LABEL }), { status: 500 });
  const failing = createUpstreamBudgetSource({
    keyUrl: 'https://openrouter.ai/api/v1/key',
    apiKey: PROVIDER_KEY,
    logger: capturing.logger,
    now: new TestClock().now,
    fetchKey: provider.fetchKey,
  });
  assert.equal((await failing.read()).status, 'unavailable');
  const logged = JSON.stringify([...capturing.lines, ...harness.logLines]);
  assert.ok(capturing.lines.length > 0, 'the failure was logged');
  assert.ok(!logged.includes(PROVIDER_KEY));
  assert.ok(!logged.includes(KEY_LABEL));
});

// ---------------------------------------------------------------------------
// The cache
// ---------------------------------------------------------------------------

test('two reads inside 60 seconds are one provider request, and the third after it is a second', async () => {
  const provider = new FakeProvider();
  const clock = new TestClock();
  const harness = await start({ upstream: sourceFor({ provider, clock }) });

  await readBudget(harness);
  clock.advance(UPSTREAM_BUDGET_OK_TTL_MS - 1000);
  await readBudget(harness);
  assert.equal(provider.requests, 1, 'the second read inside the minute is served from memory');

  clock.advance(2000);
  const third = await bodyOf(await readBudget(harness));
  assert.equal(provider.requests, 2, 'past the minute the provider is asked again');
  assert.equal(asObject(third.upstream)?.checkedAt, clock.now().toISOString());
});

test('two overlapping reads share one provider request', async () => {
  const provider = new FakeProvider();
  const source = sourceFor({ provider, clock: new TestClock() });
  const [first, second] = await Promise.all([source.read(), source.read()]);
  assert.equal(provider.requests, 1);
  assert.equal(first, second);
});

// ---------------------------------------------------------------------------
// Unavailable
// ---------------------------------------------------------------------------

test('a provider that fails is reported unavailable, and asked again after 15 seconds', async () => {
  const provider = new FakeProvider();
  provider.answer = async () => {
    throw new TypeError('fetch failed');
  };
  const clock = new TestClock();
  const harness = await start({ upstream: sourceFor({ provider, clock }) });

  const body = await bodyOf(await readBudget(harness));
  assert.deepEqual(body.upstream, { status: 'unavailable', checkedAt: clock.now().toISOString() });
  // Capacity still answers: the provider being down is half the card, not all of it.
  assert.deepEqual(asObject(asObject(body.capacity)?.paid), { used: 42, limit: 2000 });

  clock.advance(UPSTREAM_BUDGET_FAILED_TTL_MS - 1000);
  await readBudget(harness);
  assert.equal(provider.requests, 1, 'a failed read is cached too');

  provider.answer = async () => Response.json(OPENROUTER_BODY);
  clock.advance(2000);
  const recovered = await bodyOf(await readBudget(harness));
  assert.equal(provider.requests, 2);
  assert.equal(asObject(recovered.upstream)?.status, 'ok');
});

test('a non-2xx, a body that is not the key read, and a timeout are each unavailable', async () => {
  const cases: { name: string; answer: FakeProvider['answer'] }[] = [
    { name: 'a 401', answer: async () => new Response('{}', { status: 401 }) },
    { name: 'no data', answer: async () => Response.json({ limit: 5 }) },
    {
      name: 'a string usage',
      answer: async () => Response.json({ data: { ...OPENROUTER_BODY.data, usage_daily: '0.12' } }),
    },
    { name: 'not JSON', answer: async () => new Response('<html>', { status: 200 }) },
  ];
  for (const testCase of cases) {
    const provider = new FakeProvider();
    provider.answer = testCase.answer;
    const read = await sourceFor({ provider, clock: new TestClock() }).read();
    assert.equal(read.status, 'unavailable', testCase.name);
  }

  // The timeout: a provider that never answers until the signal aborts.
  const hanging = new FakeProvider();
  hanging.fetchKey = async (_url, init) =>
    new Promise<Response>((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason));
    });
  const started = Date.now();
  const read = await sourceFor({ provider: hanging, clock: new TestClock(), timeoutMs: 50 }).read();
  assert.equal(read.status, 'unavailable');
  assert.ok(Date.now() - started < 2000, 'the timeout bounds the read');
});

test('the parser keeps the six named fields and nothing else', () => {
  const parsed = parseOpenRouterKeyBody(OPENROUTER_BODY);
  assert.deepEqual(parsed, {
    limitUsd: 5,
    remainingUsd: 3.94,
    reset: 'monthly',
    usageDailyUsd: 0.12,
    usageWeeklyUsd: 0.4,
    usageMonthlyUsd: 1.06,
  });
  // An unknown reset period is `null`, not a string the console would print.
  assert.equal(parseOpenRouterKeyBody({ data: { ...OPENROUTER_BODY.data, limit_reset: 'hourly' } })?.reset, null);
  // An absent usage figure is a refusal, not a zero.
  const { usage_monthly: _dropped, ...withoutMonthly } = OPENROUTER_BODY.data;
  assert.equal(parseOpenRouterKeyBody({ data: withoutMonthly }), null);
});
