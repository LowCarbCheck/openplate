/**
 * The scan trial (M253), end to end: a real account, a real proxy, a real
 * upstream on an ephemeral port, and the real counters in Postgres.
 *
 * Every rule here has a control that goes red when the rule is removed:
 *
 *  - the ladder: two scans, then `403 trial-scans-spent`; a future date lifts
 *    the gate; a passed date is still `allowance-expired`;
 *  - one scan per intake id, an overlapping request refused with `409
 *    intake-in-flight` at no cost (2026-09-30), a request after a delivered
 *    answer costing a new one, an intake abandoned in flight taken over after
 *    thirty minutes, and no id meaning its own scan (M256/02: one scan buys
 *    one delivered answer);
 *  - a give-back or a delivery for an older claim on an id changes nothing
 *    (M256/02), and a throw after the claim gives the scan back;
 *  - the give-back: a 4xx, a 5xx, a connect error and a body cut mid-stream
 *    leave the count where it was, a 2xx moves it, and a 5xx still spends the
 *    daily unit;
 *  - concurrency: ten parallel requests on three scans claim three, and
 *    parallel requests on one new id claim one and answer one;
 *  - every refusal after the claim gives the scan back, the trial accounts'
 *    sub-ceiling refuses them and nobody else, and with it set their traffic
 *    takes nothing from the instance ceiling;
 *  - redemption, the member door's switch, the admin fields, the lapsed day
 *    trials, the one mailbox, one trial rule across a deletion, and the
 *    headers a browser needs.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq, sql } from 'drizzle-orm';
import { setupTestDatabase, type TestDatabase } from './db-harness.js';
import {
  sampleAuthHash,
  sampleKdfDescriptor,
  sampleRecoveryCode,
  sampleWrappedDek,
  startService,
  type HttpResponse,
  type ServiceHarness,
  type StartServiceOptions,
} from './service-harness.js';
import {
  accounts,
  aiInstanceDays,
  aiTrialIntakes,
  aiUsageDays,
  signupInvites,
  trialAddressHashes,
} from '../../src/db/schema.js';
import { createDrizzleAiQuotaStore, type AiQuotaStore } from '../../src/ai/quota-store.js';
import { startAiUsageRetention } from '../../src/ai/usage-retention.js';
import { createDrizzleInviteStore } from '../../src/db/invite-store.js';
import { createTrialAddressHasher } from '../../src/accounts/trial-address.js';
import { createSilentLogger, type LogFields, type Logger } from '../../src/logger.js';

const UPSTREAM_KEY = 'sk-the-operators-own-provider-key';
const ADMIN_TOKEN = 'integration-admin-token-0123456789abcdef';
const PEPPER = 'a-trial-address-pepper-that-is-long-enough-0123';
const TRIAL = { scans: 10, dailyAiLimit: 50 };
const MS_PER_MINUTE = 60 * 1000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

/** What the fake upstream does with the next request. */
type UpstreamMode = 'ok' | 'cut' | 'slow-stream' | { status: number };

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
  if (mode === 'cut') {
    // Headers and half a body, then the socket dies: the provider stopped.
    response.writeHead(200, { 'content-type': 'application/json' });
    response.write('{"choices":[');
    setTimeout(() => response.socket?.destroy(), 20);
    return;
  }
  if (mode === 'slow-stream') {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    let sent = 0;
    const timer = setInterval(() => {
      sent += 1;
      if (response.destroyed || sent > 20) {
        clearInterval(timer);
        response.end();
        return;
      }
      response.write(`data: ${sent}\n\n`);
    }, 50);
    return;
  }
  response.writeHead(mode.status, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: { message: 'no' } }));
}

async function startWithTrial(options: Partial<StartServiceOptions> = {}): Promise<ServiceHarness> {
  return startService({
    db: database.db,
    adminToken: ADMIN_TOKEN,
    trial: TRIAL,
    trialAddressPepper: PEPPER,
    ai: { baseUrl: upstreamBaseUrl, apiKey: UPSTREAM_KEY, timeoutMs: 2_000 },
    ...options,
  });
}

async function withService(
  options: Partial<StartServiceOptions>,
  body: (service: ServiceHarness) => Promise<void>,
): Promise<void> {
  const service = await startWithTrial(options);
  try {
    await body(service);
  } finally {
    await service.close();
  }
}

/** A signed-in account with `granted` free scans and no date. */
async function trialAccount(service: ServiceHarness, input: { email: string; granted: number }): Promise<string> {
  const session = await service.signupThroughInvite({
    email: input.email,
    dailyAiLimit: TRIAL.dailyAiLimit,
    trialScans: input.granted,
  });
  return session.tokens.accessToken;
}

function scan(service: ServiceHarness, input: { token: string; intakeId?: string }): Promise<HttpResponse<unknown>> {
  const headers: Record<string, string> = {};
  if (input.intakeId !== undefined) headers['x-intake-id'] = input.intakeId;
  return service.request<unknown>({
    method: 'POST',
    path: '/v1/chat/completions',
    accessToken: input.token,
    headers,
    body: { model: 'm', messages: [{ role: 'user', content: 'a plate' }] },
  });
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

/**
 * A new access token for an account, after the harness clock moved past the
 * old one's lifetime. The same credential every fixture account signs up with.
 */
async function signInAgain(service: ServiceHarness, email: string): Promise<string> {
  const response = await service.request<{ tokens: { accessToken: string } }>({
    method: 'POST',
    path: '/v1/auth/login',
    body: { email, authHash: sampleAuthHash() },
  });
  if (response.status !== 200) throw new Error(`could not sign ${email} in again: ${response.status}`);
  return response.body.tokens.accessToken;
}

/** A 16+ character intake id, as the app makes one per action. */
function intake(label: string): string {
  return `intake${label.padStart(12, '0')}`;
}

/**
 * Waits until an intake row carries `requests` requests, with a bound, so a
 * test can send the next request while the earlier ones are still in flight
 * rather than guessing a sleep.
 */
async function waitForIntakeRequests(input: { intakeId: string; requests: number }): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const [row] = await database.db
      .select({ requests: aiTrialIntakes.requests })
      .from(aiTrialIntakes)
      .where(eq(aiTrialIntakes.intakeId, input.intakeId));
    if (row !== undefined && row.requests >= input.requests) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`intake ${input.intakeId} never carried ${input.requests} requests`);
}

// ── the ladder ─────────────────────────────────────────────────────────────

test('two scans, then 403 trial-scans-spent before any upstream call or usage row', async () => {
  await withService({}, async (service) => {
    const token = await trialAccount(service, { email: 'two@example.org', granted: 2 });
    const first = await scan(service, { token, intakeId: intake('a') });
    const second = await scan(service, { token, intakeId: intake('b') });
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('x-trial-scans-left'), '1');
    assert.equal(second.status, 200);
    assert.equal(second.headers.get('x-trial-scans-left'), '0');

    const third = await scan(service, { token, intakeId: intake('c') });
    assert.equal(third.status, 403);
    // `endedBy` (M267) names which limit ended the trial, the same field the
    // day limit's `trial-expired` carries.
    assert.deepEqual(third.body, { error: 'trial-scans-spent', endedBy: 'scans' });
    assert.equal(third.headers.get('x-trial-scans-left'), '0');
    assert.equal(upstreamCalls, 2, 'the refused scan never reached the provider');
    assert.equal(await usageToday('two@example.org'), 2, 'the refused scan spent no daily unit');
  });
});

test('a future date lifts the scan gate, and a passed date is still allowance-expired', async () => {
  // THE CONTROL for the refusal above: the same account with a paid window.
  await withService({}, async (service) => {
    const token = await trialAccount(service, { email: 'paid@example.org', granted: 2 });
    await database.db
      .update(accounts)
      .set({ allowanceExpiresAt: new Date(service.now() + 30 * MS_PER_DAY) })
      .where(eq(accounts.email, 'paid@example.org'));
    for (const label of ['a', 'b', 'c']) {
      assert.equal((await scan(service, { token, intakeId: intake(label) })).status, 200, label);
    }
    assert.equal(await usedScans('paid@example.org'), 0, 'a paid window counts no scans');

    await database.db
      .update(accounts)
      .set({ allowanceExpiresAt: new Date(service.now() - 1) })
      .where(eq(accounts.email, 'paid@example.org'));
    const expired = await scan(service, { token, intakeId: intake('d') });
    assert.equal(expired.status, 403);
    assert.deepEqual(expired.body, { error: 'allowance-expired' });
  });
});

test('an account with no scan trial is never counted and never sees the header', async () => {
  await withService({}, async (service) => {
    const session = await service.signupThroughInvite({ email: 'standing@example.org', dailyAiLimit: 50 });
    const response = await scan(service, { token: session.tokens.accessToken, intakeId: intake('a') });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-trial-scans-left'), null);
    assert.equal((await database.db.select().from(aiTrialIntakes)).length, 0);
  });
});

// ── the intake id ──────────────────────────────────────────────────────────

test('a delivered intake id is not reused: the next request claims a new scan, then is refused', async () => {
  // M256/02: ONE SCAN BUYS ONE DELIVERED ANSWER. Before it, a client could
  // send one id three times and get three answers for one scan.
  await withService({}, async (service) => {
    const token = await trialAccount(service, { email: 'delivered@example.org', granted: 2 });
    const first = await scan(service, { token, intakeId: intake('same') });
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('x-trial-scans-left'), '1');

    const again = await scan(service, { token, intakeId: intake('same') });
    assert.equal(again.status, 200);
    assert.equal(again.headers.get('x-trial-scans-left'), '0', 'the answer after an answer rode on the spent scan');
    assert.equal(await usedScans('delivered@example.org'), 2);

    const refused = await scan(service, { token, intakeId: intake('same') });
    assert.equal(refused.status, 403);
    assert.deepEqual(refused.body, { error: 'trial-scans-spent', endedBy: 'scans' });
    assert.equal(upstreamCalls, 2, 'the refused request never reached the provider');
  });
});

test('a retry after an attempt that got no answer costs nothing more on the same id', async () => {
  // THE CONTROL for the rule above: it is the ANSWER that spends the scan,
  // not the id. The app's one retry follows a refusal, which delivered nothing.
  await withService({}, async (service) => {
    const token = await trialAccount(service, { email: 'retry@example.org', granted: 5 });
    mode = { status: 400 };
    assert.equal((await scan(service, { token, intakeId: intake('retry') })).status, 400);
    mode = 'ok';
    assert.equal((await scan(service, { token, intakeId: intake('retry') })).status, 200);
    assert.equal(await usedScans('retry@example.org'), 1);
  });
});

test('a second request on an id while the first is in flight is 409 intake-in-flight and spends nothing', async () => {
  // 2026-09-30: before, the second request rode on the first one's scan, and
  // two overlapping requests got two answers for one scan.
  await withService({}, async (service) => {
    answerDelayMs = 200;
    const token = await trialAccount(service, { email: 'overlap@example.org', granted: 5 });
    const first = scan(service, { token, intakeId: intake('r') });
    await waitForIntakeRequests({ intakeId: intake('r'), requests: 1 });

    const second = await scan(service, { token, intakeId: intake('r') });
    assert.equal(second.status, 409);
    assert.deepEqual(second.body, { error: 'intake-in-flight' });
    assert.equal((await first).status, 200);
    assert.equal(upstreamCalls, 1, 'the refused request never reached the provider');
    assert.equal(await usedScans('overlap@example.org'), 1);
    assert.equal(await usageToday('overlap@example.org'), 1, 'the refused request reserved no daily unit');

    // THE CONTROL: once the first one settled, the id is usable again, and
    // after a delivered answer that is a new action with a new scan.
    assert.equal((await scan(service, { token, intakeId: intake('r') })).status, 200);
    assert.equal(await usedScans('overlap@example.org'), 2);
  });
});

test('an intake abandoned in flight is taken over after thirty minutes, without a new scan', async () => {
  // A request whose process died after the claim: the row says in flight, and
  // nothing will ever settle it. It must not lock the id for longer than the
  // reuse window, and the person must not pay a second scan for it.
  await withService({}, async (service) => {
    const token = await trialAccount(service, { email: 'abandoned@example.org', granted: 5 });
    const [account] = await database.db.select().from(accounts).where(eq(accounts.email, 'abandoned@example.org'));
    if (!account) throw new Error('no account');
    const quota = createDrizzleAiQuotaStore(database.db);
    const claimed = await quota.claimTrialScan({
      accountId: account.id,
      intakeId: intake('dead'),
      now: new Date(service.now()),
    });
    assert.ok(claimed.ok);
    assert.equal(await usedScans('abandoned@example.org'), 1);

    // Inside the window the id is still in flight.
    assert.equal((await scan(service, { token, intakeId: intake('dead') })).status, 409);

    service.advance(30 * MS_PER_MINUTE);
    const renewed = await signInAgain(service, 'abandoned@example.org');
    const taken = await scan(service, { token: renewed, intakeId: intake('dead') });
    assert.equal(taken.status, 200);
    assert.equal(taken.headers.get('x-trial-scans-left'), '4');
    assert.equal(await usedScans('abandoned@example.org'), 1, 'the abandoned scan was reused, not charged twice');
  });
});

test('a request with no intake id is its own scan', async () => {
  await withService({}, async (service) => {
    const token = await trialAccount(service, { email: 'no-id@example.org', granted: 5 });
    await scan(service, { token });
    await scan(service, { token });
    assert.equal(await usedScans('no-id@example.org'), 2);
  });
});

test('a malformed intake id is a 400 before any row is written', async () => {
  await withService({}, async (service) => {
    const token = await trialAccount(service, { email: 'bad-id@example.org', granted: 5 });
    const response = await scan(service, { token, intakeId: 'short' });
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { error: 'intake-id-invalid' });
    assert.equal(await usedScans('bad-id@example.org'), 0);
    assert.equal((await database.db.select().from(aiTrialIntakes)).length, 0);
    assert.equal(upstreamCalls, 0);
  });
});

// ── the give-back ──────────────────────────────────────────────────────────

test('an upstream 4xx and 5xx leave the scan count where it was; a 2xx moves it', async () => {
  await withService({}, async (service) => {
    const token = await trialAccount(service, { email: 'errors@example.org', granted: 5 });
    mode = { status: 400 };
    const refused = await scan(service, { token, intakeId: intake('four') });
    assert.equal(refused.status, 400);
    assert.equal(refused.headers.get('x-trial-scans-left'), '5', 'the answer says the attempt cost nothing');
    mode = { status: 502 };
    assert.equal((await scan(service, { token, intakeId: intake('five') })).status, 502);
    assert.equal(await usedScans('errors@example.org'), 0);
    // THE UNIT IS NOT THE SCAN: the 5xx still spent the daily unit, the 4xx did not.
    assert.equal(await usageToday('errors@example.org'), 1);

    // THE CONTROL: the same account, a 2xx.
    mode = 'ok';
    assert.equal((await scan(service, { token, intakeId: intake('ok') })).status, 200);
    assert.equal(await usedScans('errors@example.org'), 1);
  });
});

test('a connect error gives the scan back', async () => {
  await withService(
    // A port nothing listens on: the connection is refused.
    { ai: { baseUrl: 'http://127.0.0.1:9', apiKey: UPSTREAM_KEY, timeoutMs: 1_000 } },
    async (service) => {
      const token = await trialAccount(service, { email: 'refused@example.org', granted: 5 });
      assert.equal((await scan(service, { token, intakeId: intake('c') })).status, 502);
      assert.equal(await usedScans('refused@example.org'), 0);
    },
  );
});

test('an upstream body cut after its headers gives the scan back', async () => {
  await withService({}, async (service) => {
    const token = await trialAccount(service, { email: 'cut@example.org', granted: 5 });
    mode = 'cut';
    await assert.rejects(scan(service, { token, intakeId: intake('cut') }));
    // The give-back runs after the socket is destroyed; poll briefly.
    for (let attempt = 0; attempt < 50 && (await usedScans('cut@example.org')) !== 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(await usedScans('cut@example.org'), 0);
  });
});

test('a caller that hangs up after a 2xx keeps the scan spent', async () => {
  // THE CONTROL for the cut body: the provider answered, the caller left.
  await withService({}, async (service) => {
    const token = await trialAccount(service, { email: 'hangup@example.org', granted: 5 });
    mode = 'slow-stream';
    const abort = new AbortController();
    const response = await fetch(`${service.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-intake-id': intake('h') },
      body: JSON.stringify({ model: 'm', messages: [], stream: true }),
      signal: abort.signal,
    });
    assert.equal(response.status, 200);
    abort.abort();
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(await usedScans('hangup@example.org'), 1);
  });
});

// ── concurrency ────────────────────────────────────────────────────────────

test('ten parallel requests with ten ids on three scans claim exactly three', async () => {
  await withService({}, async (service) => {
    answerDelayMs = 50;
    const token = await trialAccount(service, { email: 'parallel@example.org', granted: 3 });
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_unused, index) => scan(service, { token, intakeId: intake(`p${index}`) })),
    );
    assert.equal(responses.filter((response) => response.status === 200).length, 3);
    assert.equal(responses.filter((response) => response.status === 403).length, 7);
    assert.equal(await usedScans('parallel@example.org'), 3);
  });
});

test('parallel requests with one new id claim exactly one scan and get one answer', async () => {
  await withService({}, async (service) => {
    answerDelayMs = 50;
    const token = await trialAccount(service, { email: 'same-id@example.org', granted: 5 });
    const responses = await Promise.all([1, 2].map(() => scan(service, { token, intakeId: intake('one') })));
    assert.deepEqual(responses.map((response) => response.status).toSorted(), [200, 409]);
    assert.equal(upstreamCalls, 1, 'one scan bought one answer');
    assert.equal(await usedScans('same-id@example.org'), 1);
  });
});

test('a late give-back or delivery for an older claim on an id changes nothing', async () => {
  // M256/02: THE CLAIM NUMBER. Claim 1 is abandoned in flight, a request
  // thirty minutes later takes the id over as claim 2, and then claim 1's
  // request turns out to have been only slow and fails, or succeeds, late.
  // Without the claim number, that give-back would find claim 2's row, drop
  // it and return its scan, and claim 2's answer would then be free.
  await withService({}, async (service) => {
    await trialAccount(service, { email: 'late@example.org', granted: 5 });
    const [account] = await database.db.select().from(accounts).where(eq(accounts.email, 'late@example.org'));
    if (!account) throw new Error('no account');
    const quota = createDrizzleAiQuotaStore(database.db);
    const now = new Date(service.now());
    const id = intake('late');

    const first = await quota.claimTrialScan({ accountId: account.id, intakeId: id, now });
    const overlapping = await quota.claimTrialScan({ accountId: account.id, intakeId: id, now });
    const takenOver = await quota.claimTrialScan({
      accountId: account.id,
      intakeId: id,
      now: new Date(now.getTime() + 30 * MS_PER_MINUTE),
    });
    assert.ok(first.ok && takenOver.ok);
    assert.deepEqual(overlapping, { ok: false, reason: 'in-flight' });
    assert.equal(takenOver.claim, first.claim + 1, 'the takeover is a new claim');
    assert.equal(await usedScans('late@example.org'), 1, 'and no new scan');

    const late = await quota.releaseTrialScan({
      accountId: account.id,
      intakeId: id,
      claim: first.claim,
      undeliver: false,
    });
    assert.equal(late.givenBack, false);
    assert.equal(await usedScans('late@example.org'), 1, "the late failure returned the newer claim's scan");
    await quota.markTrialScanDelivered({ accountId: account.id, intakeId: id, claim: first.claim });
    const [row] = await database.db.select().from(aiTrialIntakes).where(eq(aiTrialIntakes.intakeId, id));
    assert.equal(row?.delivered, false, "a late 2xx for claim 1 marked claim 2's scan delivered");
    assert.equal(row?.requests, 1);

    // THE CONTROL: the give-back for the claim the row carries does return it.
    const own = await quota.releaseTrialScan({
      accountId: account.id,
      intakeId: id,
      claim: takenOver.claim,
      undeliver: false,
    });
    assert.equal(own.givenBack, true);
    assert.equal(await usedScans('late@example.org'), 0);
  });
});

test('a throw after the claim gives the scan back, so the retry on the id is not locked out', async () => {
  // 2026-09-30: a statement that failed after the claim (here the trial
  // day's reservation) used to leave the intake in flight with its scan
  // spent, and with in-flight refused, the person's retry got 409s for the
  // whole reuse window.
  let failures = 1;
  const wrapQuota = (quota: AiQuotaStore): AiQuotaStore => ({
    ...quota,
    async reserveTrialInstance(input) {
      if (failures > 0) {
        failures -= 1;
        throw new Error('the database went away');
      }
      return await quota.reserveTrialInstance(input);
    },
  });
  await withService(
    { ai: { baseUrl: upstreamBaseUrl, apiKey: UPSTREAM_KEY, timeoutMs: 2_000, wrapQuota } },
    async (service) => {
      const token = await trialAccount(service, { email: 'thrown@example.org', granted: 5 });
      const failed = await scan(service, { token, intakeId: intake('throw') });
      assert.equal(failed.status, 500);
      // The give-back runs in the handler's `finally`, after the 500 is sent.
      for (let attempt = 0; attempt < 50 && (await usedScans('thrown@example.org')) !== 0; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(await usedScans('thrown@example.org'), 0, 'the thrown request kept its scan');

      const retried = await scan(service, { token, intakeId: intake('throw') });
      assert.equal(retried.status, 200, 'the retry on the same id was locked out');
      assert.equal(await usedScans('thrown@example.org'), 1);
    },
  );
});

// ── refusals after the claim ───────────────────────────────────────────────

test('the instance ceiling and the daily quota give the scan back', async () => {
  await withService(
    { ai: { baseUrl: upstreamBaseUrl, apiKey: UPSTREAM_KEY, timeoutMs: 2_000, instanceDailyLimit: 1 } },
    async (service) => {
      const standing = await service.signupThroughInvite({ email: 'first@example.org', dailyAiLimit: 50 });
      assert.equal((await scan(service, { token: standing.tokens.accessToken })).status, 200);

      const token = await trialAccount(service, { email: 'ceiling@example.org', granted: 5 });
      const refused = await scan(service, { token, intakeId: intake('c') });
      assert.equal(refused.status, 503);
      assert.deepEqual(refused.body, { error: 'ai-instance-ceiling' });
      assert.equal(await usedScans('ceiling@example.org'), 0);
    },
  );

  await withService({}, async (service) => {
    const session = await service.signupThroughInvite({
      email: 'quota@example.org',
      dailyAiLimit: 1,
      trialScans: 5,
    });
    const token = session.tokens.accessToken;
    assert.equal((await scan(service, { token, intakeId: intake('q1') })).status, 200);
    assert.equal((await scan(service, { token, intakeId: intake('q2') })).status, 429);
    assert.equal(await usedScans('quota@example.org'), 1, 'the refused request gave its scan back');
  });
});

test('with a trial ceiling set, trial traffic takes nothing from the instance ceiling paying accounts use', async () => {
  // 2026-09-30: before, a trial request took a unit of both ceilings, so the
  // trials could spend the instance's capacity: here the first trial scan
  // took the only instance unit and the second was refused with 503.
  await withService(
    {
      ai: {
        baseUrl: upstreamBaseUrl,
        apiKey: UPSTREAM_KEY,
        timeoutMs: 2_000,
        instanceDailyLimit: 1,
        trialInstanceDailyLimit: 5,
      },
    },
    async (service) => {
      const token = await trialAccount(service, { email: 'trial-traffic@example.org', granted: 5 });
      assert.equal((await scan(service, { token, intakeId: intake('t1') })).status, 200);
      assert.equal((await scan(service, { token, intakeId: intake('t2') })).status, 200);

      // THE CONTROL: the instance's one unit is still there for a paying account.
      const standing = await service.signupThroughInvite({ email: 'payer@example.org', dailyAiLimit: 50 });
      assert.equal((await scan(service, { token: standing.tokens.accessToken })).status, 200);

      const [day] = await database.db.select().from(aiInstanceDays);
      assert.equal(day?.trialCount, 2);
      assert.equal(day?.count, 1);
    },
  );
});

test('the trial sub-ceiling refuses trial accounts and not a standing account on the same day', async () => {
  await withService(
    { ai: { baseUrl: upstreamBaseUrl, apiKey: UPSTREAM_KEY, timeoutMs: 2_000, trialInstanceDailyLimit: 1 } },
    async (service) => {
      const first = await trialAccount(service, { email: 'trial-a@example.org', granted: 5 });
      assert.equal((await scan(service, { token: first, intakeId: intake('a') })).status, 200);

      const second = await trialAccount(service, { email: 'trial-b@example.org', granted: 5 });
      const refused = await scan(service, { token: second, intakeId: intake('b') });
      assert.equal(refused.status, 503);
      assert.deepEqual(refused.body, { error: 'ai-instance-ceiling' });
      assert.equal(await usedScans('trial-b@example.org'), 0);

      // THE CONTROL: a paying or granted account is not the trials' budget.
      const standing = await service.signupThroughInvite({ email: 'standing@example.org', dailyAiLimit: 50 });
      assert.equal((await scan(service, { token: standing.tokens.accessToken })).status, 200);

      const [day] = await database.db.select().from(aiInstanceDays);
      assert.equal(day?.trialCount, 1);
    },
  );
});

// ── redemption, the member door and /health ────────────────────────────────

/** Redeems an invite token through the real signup route. */
async function redeem(service: ServiceHarness, inviteToken: string): Promise<HttpResponse<RedeemedBody>> {
  return service.request<RedeemedBody>({
    method: 'POST',
    path: '/v1/auth/signup',
    body: {
      inviteToken,
      authHash: sampleAuthHash(),
      kdfDescriptor: sampleKdfDescriptor(),
      recoveryAuthHash: sampleAuthHash(31),
      recoveryCode: sampleRecoveryCode(),
      keyRecords: [
        { kind: 'passphrase', kdfDescriptor: sampleKdfDescriptor(), wrappedDek: sampleWrappedDek() },
        { kind: 'recovery', kdfDescriptor: null, wrappedDek: sampleWrappedDek(41) },
      ],
    },
  });
}

interface RedeemedBody {
  account: {
    id: number;
    dailyAiLimit: number;
    allowanceExpiresAt: string | null;
    trialScans: { granted: number; left: number } | null;
    trialEndsAt: string | null;
  };
  tokens: { accessToken: string };
}

test('a trial invite redeems into ten scans and no date', async () => {
  await withService({ openSignup: {} }, async (service) => {
    await service.request({ method: 'POST', path: '/v1/auth/signup-request', body: { email: 'new@example.org' } });
    const letter = service.mailer.signupRequests[0];
    assert.ok(letter);
    const created = await redeem(service, letter.inviteToken);
    assert.equal(created.status, 201);
    assert.deepEqual(created.body.account.trialScans, { granted: 10, left: 10 });
    assert.equal(created.body.account.allowanceExpiresAt, null);
    assert.equal(created.body.account.dailyAiLimit, TRIAL.dailyAiLimit);
  });
});

/** Mints a member-caused invite with no scan trial on the row, as a letter from before the switch. */
async function mintMemberRow(service: ServiceHarness, input: { email: string; inviterId: number }): Promise<string> {
  const minted = await createDrizzleInviteStore(database.db).mint({
    email: input.email,
    displayName: null,
    role: 'member',
    dailyAiLimit: 50,
    trialScans: null,
    trialDays: null,
    expiresAt: new Date(service.now() + 7 * MS_PER_DAY),
    now: new Date(service.now()),
    invitedByAccountId: input.inviterId,
    source: null,
  });
  if (!minted.ok) throw new Error('could not mint');
  return minted.minted.token;
}

test('an old member letter redeemed after the switch gets the scan trial, not a date', async () => {
  await withService({ memberInvites: { trial: true } }, async (service) => {
    const inviter = await service.signupThroughInvite({ email: 'inviter@example.org' });
    const token = await mintMemberRow(service, { email: 'invited@example.org', inviterId: inviter.account.id });
    const created = await redeem(service, token);
    assert.equal(created.status, 201);
    assert.deepEqual(created.body.account.trialScans, { granted: 10, left: 10 });
    assert.equal(created.body.account.allowanceExpiresAt, null);
  });

  // THE CONTROL: the same letter on an instance that still runs the day pair.
  await database.reset();
  await withService({ memberInvites: { allowanceDays: 3 } }, async (service) => {
    const inviter = await service.signupThroughInvite({ email: 'inviter@example.org' });
    const token = await mintMemberRow(service, { email: 'invited@example.org', inviterId: inviter.account.id });
    const created = await redeem(service, token);
    assert.equal(created.body.account.trialScans, null);
    assert.notEqual(created.body.account.allowanceExpiresAt, null);
  });
});

test('/health promises the trial only where there is one: the key is absent, not null, without it', async () => {
  await withService({}, async (service) => {
    const health = await service.request<{ instance: { trial?: { scans: number } } }>({
      method: 'GET',
      path: '/health',
    });
    assert.deepEqual(health.body.instance.trial, { scans: 10 });
  });
  const plain = await startService({ db: database.db });
  try {
    const health = await plain.request<{ instance: object }>({ method: 'GET', path: '/health' });
    assert.equal('trial' in health.body.instance, false);
  } finally {
    await plain.close();
  }
});

// ── one mailbox, one trial ─────────────────────────────────────────────────

/** Opens a trial account through the door and returns its session. */
async function openAccount(service: ServiceHarness, email: string): Promise<HttpResponse<RedeemedBody>> {
  const lettersBefore = service.mailer.signupRequests.length;
  await service.request({ method: 'POST', path: '/v1/auth/signup-request', body: { email } });
  const letter = service.mailer.signupRequests[lettersBefore];
  if (letter === undefined) throw new Error(`no letter for ${email}`);
  return redeem(service, letter.inviteToken);
}

test('a deleted trial mailbox keeps only a keyed hash, and asking again gets zero scans', async () => {
  await withService({ openSignup: {} }, async (service) => {
    const first = await openAccount(service, 'anna@gmail.com');
    assert.deepEqual(first.body.account.trialScans, { granted: 10, left: 10 });

    const deleted = await service.request({
      method: 'POST',
      path: '/v1/auth/delete',
      accessToken: first.body.tokens.accessToken,
      body: { authHash: sampleAuthHash() },
    });
    assert.equal(deleted.status, 204);

    // ONLY THE HASH. No invite row still names the mailbox, and the one kept
    // value is the keyed hash, not the address.
    const hashes = await database.db.select().from(trialAddressHashes);
    assert.equal(hashes.length, 1);
    assert.equal(hashes[0]?.hash, createTrialAddressHasher(PEPPER)('anna@gmail.com'));
    assert.match(hashes[0]?.hash ?? '', /^[0-9a-f]{64}$/);
    const rows = await database.db.select().from(signupInvites);
    assert.ok(rows.length > 0);
    for (const row of rows) {
      assert.equal(JSON.stringify(row).includes('anna'), false, 'an invite row still names the mailbox');
      assert.equal(row.trialKey, null);
    }

    // A dotted spelling after the next day's letter bound: the same mailbox.
    service.advance(MS_PER_DAY + MS_PER_MINUTE);
    const again = await openAccount(service, 'a.n.n.a+back@gmail.com');
    assert.equal(again.status, 201);
    assert.deepEqual(again.body.account.trialScans, { granted: 0, left: 0 });

    // THE CONTROL: another mailbox through the same door still gets ten.
    const other = await openAccount(service, 'bert@example.org');
    assert.deepEqual(other.body.account.trialScans, { granted: 10, left: 10 });
  });
});

test('a live trial account blocks a second spelling of its mailbox', async () => {
  await withService({ openSignup: {} }, async (service) => {
    await openAccount(service, 'carla@gmail.com');
    // Past the one letter per mailbox per day, which the two spellings share.
    service.advance(MS_PER_DAY + MS_PER_MINUTE);
    const second = await openAccount(service, 'c.arla@gmail.com');
    assert.deepEqual(second.body.account.trialScans, { granted: 0, left: 0 });
  });
});

test('an alias or forwarding domain gets an account and no trial, and any other domain still gets ten scans', async () => {
  // M270, spec 04. The door mints a ten-scan letter for each address, and the
  // alias address's comes out as `0`: the account exists and can buy a plan.
  await withService({ openSignup: {} }, async (service) => {
    const alias = await openAccount(service, 'anna@simplelogin.co');
    assert.equal(alias.status, 201);
    assert.deepEqual(alias.body.account.trialScans, { granted: 0, left: 0 });

    // A subdomain of a listed domain, in capitals the parser lowercases.
    const nested = await openAccount(service, 'Bert@A.B.SimpleLogin.co');
    assert.equal(nested.status, 201);
    assert.deepEqual(nested.body.account.trialScans, { granted: 0, left: 0 });

    // THE CONTROL: a real mailbox through the same door still gets ten.
    const real = await openAccount(service, 'carla@example.org');
    assert.deepEqual(real.body.account.trialScans, { granted: 10, left: 10 });
  });
});

test('an alias address with a ten-scan letter from before the rule is redeemed into no trial', async () => {
  // THE REDEMPTION SIDE. A letter minted before the rule carries scans on its
  // row; the account must not get them. The row is set by hand because the
  // mint now refuses to write them.
  await withService({}, async (service) => {
    const token = await mintTrialLetter(service, 'old@passmail.net');
    await database.db
      .update(signupInvites)
      .set({ trialScans: TRIAL.scans })
      .where(eq(signupInvites.email, 'old@passmail.net'));
    const created = await redeem(service, token);
    assert.equal(created.status, 201);
    assert.deepEqual(created.body.account.trialScans, { granted: 0, left: 0 });

    // THE CONTROL: the same hand-set row for a real address keeps its ten.
    const controlToken = await mintTrialLetter(service, 'old@example.org');
    const control = await redeem(service, controlToken);
    assert.deepEqual(control.body.account.trialScans, { granted: TRIAL.scans, left: TRIAL.scans });
  });
});

test('an invite an administrator minted by hand keeps its trial, even on an alias domain', async () => {
  // The operator chose that person, so the alias rule is the open door's only.
  await withService({ openSignup: {} }, async (service) => {
    const minted = await service.request<{ invite: { trialScans: number | null } }>({
      method: 'POST',
      path: '/v1/admin/invites',
      adminToken: ADMIN_TOKEN,
      body: { email: 'friend@duck.com', trial: true },
    });
    assert.equal(minted.status, 201);
    assert.equal(minted.body.invite.trialScans, 10);

    // Redemption too: a hand-minted row (source null) for an alias address.
    const token = await mintOperatorLetter(service, 'chosen@simplelogin.co');
    const created = await redeem(service, token);
    assert.equal(created.status, 201);
    assert.deepEqual(created.body.account.trialScans, { granted: TRIAL.scans, left: TRIAL.scans });

    // THE CONTROL: the same address through the open door gets none.
    const selfSignup = await openAccount(service, 'chosen@passmail.com');
    assert.deepEqual(selfSignup.body.account.trialScans, { granted: 0, left: 0 });
  });
});

/** Mints a ten-scan letter the way the operator's route does: no door, no inviter. */
async function mintOperatorLetter(service: ServiceHarness, email: string): Promise<string> {
  const minted = await createDrizzleInviteStore(database.db, { hashAddress: createTrialAddressHasher(PEPPER) }).mint({
    email,
    displayName: null,
    role: 'member',
    dailyAiLimit: TRIAL.dailyAiLimit,
    trialScans: TRIAL.scans,
    trialDays: null,
    expiresAt: new Date(service.now() + 7 * MS_PER_DAY),
    now: new Date(service.now()),
    invitedByAccountId: null,
    source: null,
  });
  if (!minted.ok) throw new Error(`could not mint for ${email}`);
  return minted.minted.token;
}

test('the alias rule needs no pepper', async () => {
  // The mailbox rule is the pepper's; this one is the domain's. An instance
  // with no pepper must still withhold the trial from an alias address.
  const service = await startService({ db: database.db, adminToken: ADMIN_TOKEN, trial: TRIAL, openSignup: {} });
  try {
    const alias = await openAccount(service, 'anna@mozmail.com');
    assert.deepEqual(alias.body.account.trialScans, { granted: 0, left: 0 });
    const real = await openAccount(service, 'bert@example.org');
    assert.deepEqual(real.body.account.trialScans, { granted: 10, left: 10 });
    // icloud.com is a real mailbox and is not on the list.
    const icloud = await openAccount(service, 'dora@icloud.com');
    assert.deepEqual(icloud.body.account.trialScans, { granted: 10, left: 10 });
  } finally {
    await service.close();
  }
});

/** Mints a ten-scan trial letter for one spelling, with the mailbox hash the service computes. */
async function mintTrialLetter(service: ServiceHarness, email: string): Promise<string> {
  const minted = await createDrizzleInviteStore(database.db, { hashAddress: createTrialAddressHasher(PEPPER) }).mint({
    email,
    displayName: null,
    role: 'member',
    dailyAiLimit: TRIAL.dailyAiLimit,
    trialScans: TRIAL.scans,
    trialDays: null,
    expiresAt: new Date(service.now() + 7 * MS_PER_DAY),
    now: new Date(service.now()),
    invitedByAccountId: null,
    source: 'open-signup',
  });
  if (!minted.ok) throw new Error(`could not mint for ${email}`);
  return minted.minted.token;
}

test('two spellings of one mailbox redeemed at the same moment grant one trial', async () => {
  // M256/02: THE RACE. Both letters were minted while neither spelling had
  // redeemed, so both carry ten scans, and the redemption's mailbox read is
  // the only thing between them and a second trial. Without the lock both
  // reads run before either commit and both say "no trial yet". Five pairs,
  // so one lucky interleaving cannot pass the check.
  await withService({}, async (service) => {
    for (const [index, local] of ['anna', 'bert', 'carla', 'dora', 'emil'].entries()) {
      const plain = index === 0 ? 'anna@gmail.com' : `${local}${index}@gmail.com`;
      const dotted = index === 0 ? 'a.nna@gmail.com' : `${local.slice(0, 1)}.${local.slice(1)}${index}@gmail.com`;
      const tokens = [await mintTrialLetter(service, plain), await mintTrialLetter(service, dotted)];
      const created = await Promise.all(tokens.map((token) => redeem(service, token)));

      assert.deepEqual(
        created.map((response) => response.status),
        [201, 201],
        'both spellings still get an account',
      );
      const granted = created.map((response) => response.body.account.trialScans?.granted).toSorted();
      assert.deepEqual(granted, [0, TRIAL.scans], `${plain} and ${dotted} got two trials`);
    }
    // THE CONTROL the loop cannot pass by granting nothing: a second mailbox
    // redeemed at the same moment is a different person and gets its own.
    const tokens = [
      await mintTrialLetter(service, 'fritz@example.org'),
      await mintTrialLetter(service, 'greta@example.org'),
    ];
    const created = await Promise.all(tokens.map((token) => redeem(service, token)));
    assert.deepEqual(
      created.map((response) => response.body.account.trialScans?.granted),
      [TRIAL.scans, TRIAL.scans],
    );
  });
});

test('without a pepper a deletion keeps the invite rows as before and writes no hash', async () => {
  // THE CONTROL for the scrub: the rule is the pepper's, not every deletion's.
  const service = await startService({ db: database.db });
  try {
    const session = await service.signupThroughInvite({ email: 'plain@example.org' });
    await service.request({
      method: 'POST',
      path: '/v1/auth/delete',
      accessToken: session.tokens.accessToken,
      body: { authHash: sampleAuthHash() },
    });
    assert.equal((await database.db.select().from(trialAddressHashes)).length, 0);
    const [row] = await database.db.select().from(signupInvites);
    assert.equal(row?.email, 'plain@example.org');
  } finally {
    await service.close();
  }
});

// ── the operator ───────────────────────────────────────────────────────────

test('an admin mint with "trial": true writes the instance pair, and is a 400 where there is none', async () => {
  await withService({}, async (service) => {
    const minted = await service.request<{ invite: { trialScans: number | null; dailyAiLimit: number } }>({
      method: 'POST',
      path: '/v1/admin/invites',
      adminToken: ADMIN_TOKEN,
      body: { email: 'op-trial@example.org', trial: true },
    });
    assert.equal(minted.status, 201);
    assert.equal(minted.body.invite.trialScans, 10);
    assert.equal(minted.body.invite.dailyAiLimit, TRIAL.dailyAiLimit);

    // THE CONTROL: without the field, the mint is the standing grant it always was.
    const standing = await service.request<{ invite: { trialScans: number | null } }>({
      method: 'POST',
      path: '/v1/admin/invites',
      adminToken: ADMIN_TOKEN,
      body: { email: 'op-standing@example.org', dailyAiLimit: 20 },
    });
    assert.equal(standing.body.invite.trialScans, null);
  });

  const plain = await startService({ db: database.db, adminToken: ADMIN_TOKEN });
  try {
    const refused = await plain.request({
      method: 'POST',
      path: '/v1/admin/invites',
      adminToken: ADMIN_TOKEN,
      body: { email: 'nothing@example.org', trial: true },
    });
    assert.equal(refused.status, 400);
  } finally {
    await plain.close();
  }
});

test('the operator PATCH sets the granted scans, and the account view shows them', async () => {
  await withService({}, async (service) => {
    const session = await service.signupThroughInvite({ email: 'patched@example.org', dailyAiLimit: 50 });
    const patched = await service.request<{ account: { trialScans: { granted: number; left: number } | null } }>({
      method: 'PATCH',
      path: `/v1/admin/accounts/${session.account.id}`,
      adminToken: ADMIN_TOKEN,
      body: { trialScans: 3 },
    });
    assert.equal(patched.status, 200);
    assert.deepEqual(patched.body.account.trialScans, { granted: 3, left: 3 });
    const outOfRange = await service.request({
      method: 'PATCH',
      path: `/v1/admin/accounts/${session.account.id}`,
      adminToken: ADMIN_TOKEN,
      body: { trialScans: 101 },
    });
    assert.equal(outOfRange.status, 400);
  });
});

test('lapsed day trials that nobody paid for get the scan trial once, and nobody else does', async () => {
  await withService({ memberInvites: { allowanceDays: 3, dailyAiLimit: 50 } }, async (service) => {
    const inviter = await service.signupThroughInvite({ email: 'inviter@example.org' });
    const lapsed = await service.signupThroughInvite({
      email: 'lapsed@example.org',
      invitedByAccountId: inviter.account.id,
      dailyAiLimit: 50,
    });
    const paid = await service.signupThroughInvite({
      email: 'paid-once@example.org',
      invitedByAccountId: inviter.account.id,
      dailyAiLimit: 50,
    });
    const running = await service.signupThroughInvite({
      email: 'running@example.org',
      invitedByAccountId: inviter.account.id,
      dailyAiLimit: 50,
    });
    // A payment moved this date, and it has run out since: it is not unpaid.
    await database.db
      .update(accounts)
      .set({ allowanceExpiresAt: sql`${accounts.allowanceExpiresAt} + interval '1 day'` })
      .where(eq(accounts.id, paid.account.id));

    service.advance(5 * MS_PER_DAY);
    // A trial that started later is still running and keeps its date.
    await database.db
      .update(accounts)
      .set({ allowanceExpiresAt: new Date(service.now() + MS_PER_DAY) })
      .where(eq(accounts.id, running.account.id));

    const dryRun = await service.request<{ accountIds: number[]; applied: boolean }>({
      method: 'POST',
      path: '/v1/admin/trials/grant-lapsed',
      adminToken: ADMIN_TOKEN,
      body: { trialDays: 3 },
    });
    assert.equal(dryRun.status, 200);
    assert.deepEqual(dryRun.body, { accountIds: [lapsed.account.id], applied: false });
    const [untouched] = await database.db.select().from(accounts).where(eq(accounts.id, lapsed.account.id));
    assert.equal(untouched?.trialScans, null, 'a dry run writes nothing');

    const applied = await service.request<{ accountIds: number[]; applied: boolean }>({
      method: 'POST',
      path: '/v1/admin/trials/grant-lapsed',
      adminToken: ADMIN_TOKEN,
      body: { trialDays: 3, apply: true },
    });
    assert.deepEqual(applied.body, { accountIds: [lapsed.account.id], applied: true });
    const [granted] = await database.db.select().from(accounts).where(eq(accounts.id, lapsed.account.id));
    assert.equal(granted?.trialScans, 10);
    assert.equal(granted?.allowanceExpiresAt, null);
    assert.equal(granted?.dailyAiLimit, TRIAL.dailyAiLimit);

    // IDEMPOTENT: the second run finds nobody.
    const rerun = await service.request<{ accountIds: number[] }>({
      method: 'POST',
      path: '/v1/admin/trials/grant-lapsed',
      adminToken: ADMIN_TOKEN,
      body: { trialDays: 3, apply: true },
    });
    assert.deepEqual(rerun.body.accountIds, []);
  });
});

test("the stats report the trials granted, today's trial requests and the sub-ceiling", async () => {
  await withService(
    {
      openSignup: {},
      ai: { baseUrl: upstreamBaseUrl, apiKey: UPSTREAM_KEY, timeoutMs: 2_000, trialInstanceDailyLimit: 40 },
    },
    async (service) => {
      const created = await openAccount(service, 'stats@example.org');
      await scan(service, { token: created.body.tokens.accessToken, intakeId: intake('s') });
      const stats = await service.request<{
        stats: {
          aiTrialInstanceDailyLimit: number | null;
          signup: { trialsGrantedLast7Days: number; trialRequestsToday: number };
        };
      }>({ method: 'GET', path: '/v1/admin/stats', adminToken: ADMIN_TOKEN });
      assert.equal(stats.body.stats.aiTrialInstanceDailyLimit, 40);
      assert.equal(stats.body.stats.signup.trialsGrantedLast7Days, 1);
      assert.equal(stats.body.stats.signup.trialRequestsToday, 1);
    },
  );
});

// ── the browser, the sweep and the logs ────────────────────────────────────

test('a browser may send X-Intake-Id to the proxy and read X-Trial-Scans-Left off the answer', async () => {
  await withService({}, async (service) => {
    const preflight = await service.request<undefined>({
      method: 'OPTIONS',
      path: '/v1/chat/completions',
      headers: {
        origin: 'https://app.openplate.de',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type,x-intake-id',
      },
    });
    assert.equal(preflight.status, 204);
    const allowed = (preflight.headers.get('access-control-allow-headers') ?? '').toLowerCase();
    for (const name of ['authorization', 'content-type', 'x-intake-id']) {
      assert.ok(
        allowed
          .split(',')
          .map((part) => part.trim())
          .includes(name),
        `${name} is refused by the preflight`,
      );
    }

    const token = await trialAccount(service, { email: 'browser@example.org', granted: 5 });
    const response = await scan(service, { token, intakeId: intake('b') });
    const exposed = (response.headers.get('access-control-expose-headers') ?? '')
      .toLowerCase()
      .split(',')
      .map((part) => part.trim());
    assert.ok(exposed.includes('x-trial-scans-left'));
  });
});

test('the hourly sweep deletes intake rows older than a day and keeps younger ones', async () => {
  await withService({}, async (service) => {
    const token = await trialAccount(service, { email: 'sweep@example.org', granted: 5 });
    await scan(service, { token, intakeId: intake('old') });
    service.advance(25 * 60 * MS_PER_MINUTE);
    const renewed = await signInAgain(service, 'sweep@example.org');
    assert.equal((await scan(service, { token: renewed, intakeId: intake('new') })).status, 200);

    const sweep = startAiUsageRetention({
      quota: createDrizzleAiQuotaStore(database.db),
      logger: createSilentLogger(),
      now: () => new Date(service.now()),
      intervalMs: 60 * MS_PER_MINUTE,
    });
    try {
      await sweep.runOnce();
    } finally {
      sweep.stop();
    }
    const rows = await database.db.select({ intakeId: aiTrialIntakes.intakeId }).from(aiTrialIntakes);
    assert.deepEqual(
      rows.map((row) => row.intakeId),
      [intake('new')],
    );
  });
});

interface RecordedLine {
  message: string;
  fields: LogFields | undefined;
}

test('no intake id and no address reaches a log line', async () => {
  const lines: RecordedLine[] = [];
  const logger: Logger = {
    debug: (message, fields) => lines.push({ message, fields }),
    info: (message, fields) => lines.push({ message, fields }),
    warn: (message, fields) => lines.push({ message, fields }),
    error: (message, fields) => lines.push({ message, fields }),
  };
  await withService({ logger, authLogger: logger }, async (service) => {
    // Every branch that touches an intake: a claim, a give-back after a 5xx,
    // a delivered id asked again, and the refusal after the last scan.
    const token = await trialAccount(service, { email: 'quiet@example.org', granted: 2 });
    assert.equal((await scan(service, { token, intakeId: intake('quiet') })).status, 200);
    mode = { status: 500 };
    assert.equal((await scan(service, { token, intakeId: intake('loud') })).status, 500);
    mode = 'ok';
    assert.equal((await scan(service, { token, intakeId: intake('spent') })).status, 200);
    assert.equal((await scan(service, { token, intakeId: intake('spent') })).status, 403);
    assert.equal((await scan(service, { token, intakeId: intake('over') })).status, 403);
  });
  // THE CONTROL the sweep cannot pass by finding nothing.
  assert.ok(lines.some((line) => line.message === 'Proxied a completion'));
  for (const needle of [intake('quiet'), intake('loud'), intake('spent'), intake('over'), 'quiet@example.org']) {
    assert.equal(
      lines.some((line) => JSON.stringify(line).includes(needle)),
      false,
      `a log line carries ${needle}`,
    );
  }
});

// ── the day limit (M267) ───────────────────────────────────────────────────

const TRIAL_DAYS = 14;
/** The instance's trial with `TRIAL_DAYS`, in UTC, the default `TRIAL_TIME_ZONE`. */
const DATED_TRIAL = { ...TRIAL, days: TRIAL_DAYS };

/**
 * A pinned fixture clock for the suites that assert the trial's last midnight
 * as a literal: 2026-10-01 09:00 UTC. The sign-up day does not count, so a
 * trial redeemed then ends at 2026-10-16 00:00 UTC (owner decision,
 * 2026-09-29, BGB 187(1) and 188(1)).
 */
const PINNED_START = Date.parse('2026-10-01T09:00:00.000Z');

/** A signed-in account whose invite carries the dated trial, as every trial door writes it since M267. */
async function datedTrialAccount(
  service: ServiceHarness,
  input: { email: string; granted?: number },
): Promise<SessionAccount> {
  const session = await service.signupThroughInvite({
    email: input.email,
    dailyAiLimit: TRIAL.dailyAiLimit,
    trialScans: input.granted ?? TRIAL.scans,
    trialDays: TRIAL_DAYS,
  });
  return { token: session.tokens.accessToken, trialEndsAt: session.account.trialEndsAt };
}

interface SessionAccount {
  token: string;
  trialEndsAt: string | null;
}

/** The end date on the account row itself, not the view, so a test sees what the proxy reads. */
async function trialEndsAtOf(email: string): Promise<Date | null> {
  const [row] = await database.db
    .select({ trialEndsAt: accounts.trialEndsAt })
    .from(accounts)
    .where(eq(accounts.email, email));
  if (!row) throw new Error(`no account for ${email}`);
  return row.trialEndsAt;
}

test('a new trial ends fourteen days after it starts: 403 trial-expired before any upstream call, scan or usage row', async () => {
  await withService({ trial: DATED_TRIAL, clockStartsAt: PINNED_START }, async (service) => {
    const account = await datedTrialAccount(service, { email: 'dated@example.org' });
    const endsAt = Date.parse('2026-10-16T00:00:00.000Z');
    assert.equal(account.trialEndsAt, new Date(endsAt).toISOString(), 'the account view names the end');
    assert.equal((await trialEndsAtOf('dated@example.org'))?.getTime(), endsAt, 'and the row carries it');
    assert.equal((await scan(service, { token: account.token, intakeId: intake('a') })).status, 200);

    // THE CONTROL: the last millisecond of the fourteenth day still scans.
    service.advance(endsAt - PINNED_START - 1);
    const lastMoment = await scan(service, {
      token: await signInAgain(service, 'dated@example.org'),
      intakeId: intake('b'),
    });
    assert.equal(lastMoment.status, 200);

    service.advance(1);
    const callsBefore = upstreamCalls;
    const usageBefore = await usageToday('dated@example.org');
    const expired = await scan(service, {
      token: await signInAgain(service, 'dated@example.org'),
      intakeId: intake('c'),
    });
    assert.equal(expired.status, 403);
    assert.deepEqual(expired.body, { error: 'trial-expired', endedBy: 'days' });
    assert.equal(upstreamCalls, callsBefore, 'the refused request never reached the provider');
    assert.equal(await usageToday('dated@example.org'), usageBefore, 'and spent no daily unit');
    assert.equal(await usedScans('dated@example.org'), 2, 'and no scan');
  });
});

test('an account whose invite carries no day limit keeps its trial with no end date, however long it waits', async () => {
  // Every account created before M267, and every invite row minted before it,
  // carries no day count. THE ROW DECIDES, so the instance's TRIAL_DAYS does
  // not reach it: those people signed up under terms with no time limit.
  await withService({ trial: DATED_TRIAL }, async (service) => {
    const session = await service.signupThroughInvite({
      email: 'before@example.org',
      dailyAiLimit: TRIAL.dailyAiLimit,
      trialScans: TRIAL.scans,
    });
    assert.equal(session.account.trialEndsAt, null);
    assert.equal(await trialEndsAtOf('before@example.org'), null);
    service.advance(400 * MS_PER_DAY);
    const late = await scan(service, {
      token: await signInAgain(service, 'before@example.org'),
      intakeId: intake('a'),
    });
    assert.equal(late.status, 200);
  });
});

test('used-up scans still end a dated trial first, and stay the reason after the days are over', async () => {
  await withService({ trial: DATED_TRIAL }, async (service) => {
    const account = await datedTrialAccount(service, { email: 'quick@example.org', granted: 1 });
    assert.equal((await scan(service, { token: account.token, intakeId: intake('a') })).status, 200);
    const spent = await scan(service, { token: account.token, intakeId: intake('b') });
    assert.equal(spent.status, 403);
    assert.deepEqual(spent.body, { error: 'trial-scans-spent', endedBy: 'scans' });

    service.advance((TRIAL_DAYS + 1) * MS_PER_DAY);
    const later = await scan(service, {
      token: await signInAgain(service, 'quick@example.org'),
      intakeId: intake('c'),
    });
    assert.deepEqual(later.body, { error: 'trial-scans-spent', endedBy: 'scans' });
  });
});

test('a paid account past its trial end is never refused by the free tier', async () => {
  await withService({ trial: DATED_TRIAL }, async (service) => {
    await datedTrialAccount(service, { email: 'payer@example.org' });
    service.advance((TRIAL_DAYS + 6) * MS_PER_DAY);
    await database.db
      .update(accounts)
      .set({ allowanceExpiresAt: new Date(service.now() + 30 * MS_PER_DAY) })
      .where(eq(accounts.email, 'payer@example.org'));
    const token = await signInAgain(service, 'payer@example.org');
    assert.equal((await scan(service, { token, intakeId: intake('a') })).status, 200);

    // THE CONTROL: the same account without its paid date is past its trial.
    await database.db.update(accounts).set({ allowanceExpiresAt: null }).where(eq(accounts.email, 'payer@example.org'));
    const refused = await scan(service, { token, intakeId: intake('b') });
    assert.deepEqual(refused.body, { error: 'trial-expired', endedBy: 'days' });
  });
});

test('every trial door starts the day limit at redemption, not at the mint', async () => {
  // Open sign-up: the letter is redeemed a day after it was asked for, and
  // the fourteen days start then.
  await withService({ trial: DATED_TRIAL, openSignup: {}, clockStartsAt: PINNED_START }, async (service) => {
    await service.request({ method: 'POST', path: '/v1/auth/signup-request', body: { email: 'open@example.org' } });
    const letter = service.mailer.signupRequests[0];
    assert.ok(letter);
    service.advance(MS_PER_DAY);
    const created = await redeem(service, letter.inviteToken);
    assert.equal(created.status, 201);
    // Redeemed on 2026-10-02: the fourteen days after it end at 2026-10-17 00:00 UTC.
    assert.equal(created.body.account.trialEndsAt, '2026-10-17T00:00:00.000Z');
  });

  // A member's invitation under MEMBER_INVITE_TRIAL=true.
  await database.reset();
  await withService(
    { trial: DATED_TRIAL, memberInvites: { trial: true }, clockStartsAt: PINNED_START },
    async (service) => {
      const inviter = await service.signupThroughInvite({ email: 'inviter@example.org', dailyAiLimit: 50 });
      const minted = await service.request({
        method: 'POST',
        path: '/v1/auth/invites',
        accessToken: inviter.tokens.accessToken,
        body: { email: 'friend@example.org' },
      });
      assert.equal(minted.status, 202);
      const letter = service.mailer.invites.find((sent) => sent.email === 'friend@example.org');
      assert.ok(letter);
      service.advance(2 * MS_PER_DAY);
      const created = await redeem(service, letter.inviteToken);
      assert.equal(created.body.account.trialEndsAt, '2026-10-18T00:00:00.000Z');

      // An old member letter with no trial on its row gets the instance's
      // whole trial at redemption, its day limit included.
      const oldToken = await mintMemberRow(service, { email: 'old-letter@example.org', inviterId: inviter.account.id });
      const fromOldLetter = await redeem(service, oldToken);
      assert.equal(fromOldLetter.body.account.trialEndsAt, '2026-10-18T00:00:00.000Z');
    },
  );

  // The operator's mint with "trial": true.
  await database.reset();
  await withService({ trial: DATED_TRIAL }, async (service) => {
    await service.request({
      method: 'POST',
      path: '/v1/admin/invites',
      adminToken: ADMIN_TOKEN,
      body: { email: 'op-dated@example.org', trial: true },
    });
    const [row] = await database.db
      .select({ trialDays: signupInvites.trialDays })
      .from(signupInvites)
      .where(eq(signupInvites.email, 'op-dated@example.org'));
    assert.equal(row?.trialDays, TRIAL_DAYS);
  });

  // THE CONTROL: the same open door on an instance without TRIAL_DAYS starts
  // a trial with no end date.
  await database.reset();
  await withService({ openSignup: {} }, async (service) => {
    await service.request({ method: 'POST', path: '/v1/auth/signup-request', body: { email: 'open@example.org' } });
    const letter = service.mailer.signupRequests[0];
    assert.ok(letter);
    const created = await redeem(service, letter.inviteToken);
    assert.equal(created.body.account.trialEndsAt, null);
  });
});

test('/health promises the day limit beside the scans, and only where one is set', async () => {
  await withService({ trial: DATED_TRIAL }, async (service) => {
    const health = await service.request<{ instance: { trial?: object } }>({ method: 'GET', path: '/health' });
    assert.deepEqual(health.body.instance.trial, { scans: TRIAL.scans, days: TRIAL_DAYS });
  });
  // THE CONTROL: no TRIAL_DAYS, no `days` key, not even a null one.
  await withService({}, async (service) => {
    const health = await service.request<{ instance: { trial?: object } }>({ method: 'GET', path: '/health' });
    assert.deepEqual(health.body.instance.trial, { scans: TRIAL.scans });
  });
});

test('TRIAL_TIME_ZONE=Europe/Berlin: the trial ends at Berlin midnight after the fourteenth day, read from the row', async () => {
  // Pinned at 2026-10-20 10:00 CEST. The fourteen days after the sign-up day
  // end at 2026-11-04 00:00, which is winter time again (the clocks go back on
  // 2026-10-25), so the row carries 2026-11-03 23:00 UTC.
  const berlinTrial = { ...TRIAL, days: TRIAL_DAYS, timeZone: 'Europe/Berlin' };
  await withService({ trial: berlinTrial, clockStartsAt: Date.parse('2026-10-20T08:00:00.000Z') }, async (service) => {
    await datedTrialAccount(service, { email: 'morning@example.org' });
    service.advance(13.5 * 60 * 60 * 1000); // 2026-10-20 23:30 CEST
    await datedTrialAccount(service, { email: 'late@example.org' });
    service.advance(40 * 60 * 1000); // 2026-10-21 00:10 CEST, the next day
    await datedTrialAccount(service, { email: 'next-day@example.org' });

    assert.equal((await trialEndsAtOf('morning@example.org'))?.toISOString(), '2026-11-03T23:00:00.000Z');
    assert.equal((await trialEndsAtOf('late@example.org'))?.toISOString(), '2026-11-03T23:00:00.000Z');
    assert.equal((await trialEndsAtOf('next-day@example.org'))?.toISOString(), '2026-11-04T23:00:00.000Z');
    // THE CONTROL: sign-up plus 14 x 24 hours would have written 2026-11-03
    // 08:00 and 21:30 and 2026-11-03 22:10 UTC, three different instants.
  });
});
