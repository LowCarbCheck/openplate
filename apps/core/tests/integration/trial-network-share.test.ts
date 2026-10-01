/**
 * One caller network's share of the trial ceiling (M270 spec 12), end to end:
 * real accounts, a real proxy, a fake upstream on an ephemeral port, and the
 * real counters in Postgres.
 *
 * Every rule here has a control that goes red when the rule is removed:
 *
 *  - trial requests from one network stop at its share with the trial
 *    ceiling's own refusal, while another network still passes;
 *  - two IPv6 addresses in one /64 share the bucket, the next /64 does not;
 *  - a paid account and a free-grant account on a spent network are neither
 *    refused nor counted;
 *  - a refused request takes no scan, no daily unit, no trial ceiling unit
 *    and never reaches the provider;
 *  - parallel requests cannot pass the share;
 *  - a provider 4xx gives the network's unit back, a 5xx keeps it;
 *  - the row holds a keyed hash, never the address, and the sweep deletes
 *    every row before today.
 *
 * The caller's address comes from `X-Forwarded-For` under `trust proxy`,
 * which is how a production instance behind its reverse proxy reads it.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq, sql } from 'drizzle-orm';
import { setupTestDatabase, type TestDatabase } from './db-harness.js';
import { startService, type HttpResponse, type ServiceHarness, type StartServiceOptions } from './service-harness.js';
import { accounts, aiInstanceDays, aiUsageDays } from '../../src/db/schema.js';
import { createDrizzleAiQuotaStore } from '../../src/ai/quota-store.js';
import { startAiUsageRetention } from '../../src/ai/usage-retention.js';
import { createSilentLogger } from '../../src/logger.js';

const UPSTREAM_KEY = 'sk-the-operators-own-provider-key';
const PEPPER = 'a-trial-address-pepper-that-is-long-enough-0123';
const TRIAL = { scans: 10, dailyAiLimit: 50 };
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const NETWORK_A = '203.0.113.7';
const NETWORK_B = '198.51.100.9';

/** What the fake upstream does with the next request. */
type UpstreamMode = 'ok' | { status: number };

let database: TestDatabase;
let upstream: Server;
let upstreamBaseUrl: string;
let mode: UpstreamMode;
let upstreamCalls: number;
/** A delay before the fake upstream answers, so parallel requests overlap. */
let answerDelayMs: number;

before(async () => {
  database = await setupTestDatabase();
  upstream = createServer((request: IncomingMessage, response: ServerResponse) => {
    request.resume();
    request.on('end', () => {
      upstreamCalls += 1;
      setTimeout(() => answer(response), answerDelayMs);
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
  mode = 'ok';
  upstreamCalls = 0;
  answerDelayMs = 0;
});

function answer(response: ServerResponse): void {
  if (mode === 'ok') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: 'rice' } }] }));
    return;
  }
  response.writeHead(mode.status, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: { message: 'no' } }));
}

/** A service with a trial, a trial ceiling of 100 and a network share of `share` units. */
async function withShare(
  input: { share: number | null; trialCeiling?: number; extra?: Partial<StartServiceOptions> },
  body: (service: ServiceHarness) => Promise<void>,
): Promise<void> {
  const service = await startService({
    db: database.db,
    trial: TRIAL,
    trialAddressPepper: PEPPER,
    trustProxy: true,
    ai: {
      baseUrl: upstreamBaseUrl,
      apiKey: UPSTREAM_KEY,
      timeoutMs: 2_000,
      trialInstanceDailyLimit: input.trialCeiling ?? 100,
      trialNetworkDailyLimit: input.share,
    },
    ...input.extra,
  });
  try {
    await body(service);
  } finally {
    await service.close();
  }
}

/** A signed-in trial account with free scans and no date. */
async function trialAccount(service: ServiceHarness, email: string): Promise<string> {
  const session = await service.signupThroughInvite({ email, dailyAiLimit: TRIAL.dailyAiLimit, trialScans: 10 });
  return session.tokens.accessToken;
}

/** A 16+ character intake id, as the app makes one per action. */
function intake(label: string): string {
  return `intake${label.padStart(12, '0')}`;
}

function scan(
  service: ServiceHarness,
  input: { token: string; from: string; intakeId?: string },
): Promise<HttpResponse<unknown>> {
  const forwarded = { 'x-forwarded-for': input.from };
  const headers = input.intakeId === undefined ? forwarded : { ...forwarded, 'x-intake-id': input.intakeId };
  return service.request<unknown>({
    method: 'POST',
    path: '/v1/chat/completions',
    accessToken: input.token,
    headers,
    body: { model: 'm', messages: [{ role: 'user', content: 'a plate' }] },
  });
}

/** The trial ceiling's own refusal, which the share answers with too, so the app needs no change. */
function assertCeilingRefusal(response: HttpResponse<unknown>, label: string): void {
  assert.equal(response.status, 503, label);
  assert.deepEqual(response.body, { error: 'ai-instance-ceiling' }, label);
  assert.ok(Number(response.headers.get('retry-after')) > 0, `${label}: Retry-After names the next UTC midnight`);
}

async function usedScans(email: string): Promise<number> {
  const [row] = await database.db
    .select({ used: accounts.trialScansUsed })
    .from(accounts)
    .where(eq(accounts.email, email));
  if (!row) throw new Error(`no account for ${email}`);
  return row.used;
}

async function usageToday(email: string): Promise<number> {
  const rows = await database.db
    .select({ count: aiUsageDays.count })
    .from(aiUsageDays)
    .innerJoin(accounts, eq(accounts.id, aiUsageDays.accountId))
    .where(eq(accounts.email, email));
  return rows.reduce((total, row) => total + row.count, 0);
}

async function trialCountToday(): Promise<number> {
  const [day] = await database.db.select({ trialCount: aiInstanceDays.trialCount }).from(aiInstanceDays);
  return day?.trialCount ?? 0;
}

/** One `ai_trial_network_days` row, as plain SQL hands it back. A type alias, so it satisfies `execute`'s record bound. */
type NetworkRow = {
  day: string;
  network_hash: string;
  count: number;
};

/** Every per-network counter row, read with plain SQL so the read does not lean on the code under test. */
async function networkRows(): Promise<NetworkRow[]> {
  const result = await database.db.execute<NetworkRow>(
    sql`select day::text as day, network_hash, count from ai_trial_network_days order by count desc`,
  );
  return result.rows;
}

// ── the bound ──────────────────────────────────────────────────────────────

test('trial requests from one network stop at its share, and another network still passes', async () => {
  await withShare({ share: 2 }, async (service) => {
    const first = await trialAccount(service, 'farm-1@example.org');
    const second = await trialAccount(service, 'farm-2@example.org');
    assert.equal((await scan(service, { token: first, from: NETWORK_A, intakeId: intake('a1') })).status, 200);
    assert.equal((await scan(service, { token: second, from: NETWORK_A, intakeId: intake('a2') })).status, 200);

    const third = await trialAccount(service, 'farm-3@example.org');
    assertCeilingRefusal(
      await scan(service, { token: third, from: NETWORK_A, intakeId: intake('a3') }),
      'a third account on the spent network',
    );

    // THE CONTROL: the same trial ceiling still has room for another network.
    const elsewhere = await trialAccount(service, 'real@example.org');
    assert.equal((await scan(service, { token: elsewhere, from: NETWORK_B, intakeId: intake('b1') })).status, 200);
    assert.equal(await trialCountToday(), 3);
  });
});

test('two IPv6 addresses in one /64 share the bucket, and the next /64 has its own', async () => {
  await withShare({ share: 1 }, async (service) => {
    const first = await trialAccount(service, 'six-1@example.org');
    const second = await trialAccount(service, 'six-2@example.org');
    assert.equal((await scan(service, { token: first, from: '2001:db8:1:2::1', intakeId: intake('v1') })).status, 200);
    assertCeilingRefusal(
      await scan(service, { token: second, from: '2001:db8:1:2:ffff:ffff:ffff:9', intakeId: intake('v2') }),
      'another address in the same /64',
    );

    // THE CONTROL: the neighbouring /64 is another subscriber.
    assert.equal((await scan(service, { token: second, from: '2001:db8:1:3::1', intakeId: intake('v3') })).status, 200);
  });
});

test('a paid account and a free-grant account on a spent network are neither refused nor counted', async () => {
  await withShare({ share: 1 }, async (service) => {
    const trial = await trialAccount(service, 'trial@example.org');
    assert.equal((await scan(service, { token: trial, from: NETWORK_A, intakeId: intake('t1') })).status, 200);
    // THE CONTROL that the network is spent for trials.
    const another = await trialAccount(service, 'trial-2@example.org');
    assertCeilingRefusal(
      await scan(service, { token: another, from: NETWORK_A, intakeId: intake('t2') }),
      'a second trial on the network',
    );

    const paid = await service.signupThroughInvite({ email: 'paid@example.org', dailyAiLimit: 50 });
    await database.db
      .update(accounts)
      .set({ dailyAiLimit: 50, allowanceExpiresAt: new Date(service.now() + 30 * MS_PER_DAY), freeDailyAiLimit: 0 })
      .where(eq(accounts.id, paid.account.id));
    const beta = await service.signupThroughInvite({ email: 'beta@example.org', dailyAiLimit: 10 });
    await database.db
      .update(accounts)
      .set({ dailyAiLimit: 0, allowanceExpiresAt: null, freeDailyAiLimit: 10, trialScans: null })
      .where(eq(accounts.id, beta.account.id));

    for (const label of ['p1', 'p2', 'p3']) {
      const response = await scan(service, {
        token: paid.tokens.accessToken,
        from: NETWORK_A,
        intakeId: intake(label),
      });
      assert.equal(response.status, 200, `paid ${label}`);
    }
    for (const label of ['f1', 'f2', 'f3']) {
      const response = await scan(service, {
        token: beta.tokens.accessToken,
        from: NETWORK_A,
        intakeId: intake(label),
      });
      assert.equal(response.status, 200, `free grant ${label}`);
    }
    const rows = await networkRows();
    assert.deepEqual(
      rows.map((row) => row.count),
      [1],
      'only the one trial request is on the network counter',
    );
  });
});

test('a refused request takes no scan, no daily unit, no trial ceiling unit, and never reaches the provider', async () => {
  await withShare({ share: 1 }, async (service) => {
    const first = await trialAccount(service, 'first@example.org');
    assert.equal((await scan(service, { token: first, from: NETWORK_A, intakeId: intake('r1') })).status, 200);

    const refused = await trialAccount(service, 'refused@example.org');
    const response = await scan(service, { token: refused, from: NETWORK_A, intakeId: intake('r2') });
    assertCeilingRefusal(response, 'the second network request');
    assert.equal(response.headers.get('x-trial-scans-left'), '10', 'the refusal says the scan came back');

    assert.equal(await usedScans('refused@example.org'), 0, 'the refused request kept a scan');
    assert.equal(await usageToday('refused@example.org'), 0, 'the refused request spent a daily unit');
    assert.equal(await trialCountToday(), 1, 'the refused request kept a unit of the trial ceiling');
    assert.equal(upstreamCalls, 1, 'the refused request reached the provider');
    assert.deepEqual(
      (await networkRows()).map((row) => row.count),
      [1],
    );

    // The same intake id is free to try again from another network: nothing
    // was left in flight.
    assert.equal((await scan(service, { token: refused, from: NETWORK_B, intakeId: intake('r2') })).status, 200);
  });
});

test('parallel trial requests from one network cannot pass its share', async () => {
  await withShare({ share: 3 }, async (service) => {
    answerDelayMs = 100;
    const tokens = [
      await trialAccount(service, 'burst-1@example.org'),
      await trialAccount(service, 'burst-2@example.org'),
    ];
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        scan(service, { token: tokens[index % 2] ?? '', from: NETWORK_A, intakeId: intake(`p${index}`) }),
      ),
    );
    const statuses = responses.map((response) => response.status).toSorted((left, right) => left - right);
    assert.deepEqual(statuses, [200, 200, 200, 503, 503, 503, 503, 503, 503, 503]);
    assert.equal(upstreamCalls, 3);
    assert.deepEqual(
      (await networkRows()).map((row) => row.count),
      [3],
    );
    assert.equal(await trialCountToday(), 3, 'the refused requests gave their trial ceiling units back');
    assert.equal(
      (await usedScans('burst-1@example.org')) + (await usedScans('burst-2@example.org')),
      3,
      'only the requests that passed kept a scan',
    );
  });
});

// ── the give-back follows the unit's table ─────────────────────────────────

test("a provider 4xx gives the network's unit back, a 5xx keeps it", async () => {
  await withShare({ share: 1 }, async (service) => {
    const token = await trialAccount(service, 'flaky@example.org');
    mode = { status: 400 };
    assert.equal((await scan(service, { token, from: NETWORK_A, intakeId: intake('x1') })).status, 400);
    mode = { status: 502 };
    assert.equal((await scan(service, { token, from: NETWORK_A, intakeId: intake('x2') })).status, 502);
    // THE 5XX KEPT THE UNIT, as it keeps the daily unit: the provider may
    // have billed it.
    mode = 'ok';
    assertCeilingRefusal(
      await scan(service, { token, from: NETWORK_A, intakeId: intake('x3') }),
      'after a 5xx the share is spent',
    );
  });
});

// ── what is kept ───────────────────────────────────────────────────────────

test('the counter row holds a keyed hash of the network, never the address, and the sweep deletes past days', async () => {
  await withShare({ share: 5 }, async (service) => {
    const token = await trialAccount(service, 'kept@example.org');
    assert.equal((await scan(service, { token, from: NETWORK_A, intakeId: intake('k1') })).status, 200);
    const [row] = await networkRows();
    assert.ok(row, 'the trial request was counted');
    assert.match(row.network_hash, /^[0-9a-f]{64}$/);
    assert.ok(!row.network_hash.includes(NETWORK_A));

    const sweepAt = (instant: number): Promise<{ deleted: number }> => {
      const sweep = startAiUsageRetention({
        quota: createDrizzleAiQuotaStore(database.db),
        logger: createSilentLogger(),
        now: () => new Date(instant),
        intervalMs: 60 * 60 * 1000,
      });
      return sweep.runOnce().finally(() => sweep.stop());
    };
    // THE CONTROL: a sweep on the same day keeps today's row.
    await sweepAt(service.now());
    assert.equal((await networkRows()).length, 1, "the sweep deleted today's row");
    await sweepAt(service.now() + MS_PER_DAY);
    assert.equal((await networkRows()).length, 0, "the sweep kept yesterday's row");
  });
});

test('without a share nothing is counted per network', async () => {
  await withShare({ share: null }, async (service) => {
    const token = await trialAccount(service, 'unshared@example.org');
    for (const label of ['u1', 'u2']) {
      assert.equal((await scan(service, { token, from: NETWORK_A, intakeId: intake(label) })).status, 200);
    }
    assert.equal((await networkRows()).length, 0);
  });
});
