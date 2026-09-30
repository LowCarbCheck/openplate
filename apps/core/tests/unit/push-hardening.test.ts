/**
 * What one subscription may cost everybody else (2026-09-30).
 *
 * Before these bounds, the registration route took any non-empty string as an
 * endpoint, the sender had no timeout, the tick sent one by one, and a row
 * that failed was tried again every minute forever. So one account could
 * stall every delivery on the instance and make this service POST to an
 * internal host every minute. Each case below failed against that code:
 *
 *  - an endpoint that is not https at a known push service is refused at
 *    registration, and a row that already holds one is deleted unsent;
 *  - one slow endpoint does not hold the others, and no more than
 *    `PUSH_SEND_CONCURRENCY` are in flight at once;
 *  - a failing row backs off, and is deleted at the limit;
 *  - a tick that outlives its minute is not joined by a second one;
 *  - the web-push sender gives up on its own.
 *
 * Every refusal has its control beside it: the fixture endpoint, which the
 * policy allows, goes through the same path and is accepted or sent.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import { createServer as createTcpServer, type Server as TcpServer, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import webpush from 'web-push';
import {
  PUSH_FAILED_SENDS_LIMIT,
  PUSH_SEND_CONCURRENCY,
  PUSH_TICK_INTERVAL_MS,
  pushRetryDelayMs,
  runPushTick,
  startPushScheduler,
} from '../../src/push/push-scheduler.js';
import { createPushEndpointPolicy, DEFAULT_PUSH_SERVICE_HOSTS } from '../../src/push/endpoint-policy.js';
import { createWebPushSender } from '../../src/push/web-push-sender.js';
import { PUSH_ENDPOINT_REFUSED } from '../../src/server/register-push-routes.js';
import { createSilentLogger } from '../../src/logger.js';
import { createFakePushStore, FakeWebPushError, FIXTURE_PUSH_ENDPOINT_POLICY } from './fake-push-store.js';
import { registrationBody, startPushHarness } from './push-harness.js';

const ZONE = 'Europe/Berlin';
/** 09:00 Berlin in winter, past the 08:00 catch-up minute below. */
const MORNING = new Date('2026-01-15T08:00:00Z');
const EIGHT_AM = 8 * 60;

/** A catch-up due at {@link MORNING}. */
function dueRow(endpoint: string) {
  return { endpoint, accountId: 1, timeZone: ZONE, catchUpMinute: EIGHT_AM, lastSeenDay: '2026-01-15' };
}

/** A promise a test opens by hand, for a send that must hang until the test says otherwise. */
class Gate {
  readonly #waiters: (() => void)[] = [];
  #isOpen = false;

  wait(): Promise<void> {
    if (this.#isOpen) return Promise.resolve();
    return new Promise((resolve) => {
      this.#waiters.push(resolve);
    });
  }

  open(): void {
    this.#isOpen = true;
    for (const resolve of this.#waiters.splice(0)) resolve();
  }
}

/** Resolves once `condition` holds, or rejects after `ms`. For the concurrency cases, which cannot use a clock. */
async function waitFor(input: { condition: () => boolean; ms: number }): Promise<void> {
  const deadline = Date.now() + input.ms;
  for (let attempt = 1; attempt <= 1000 && Date.now() < deadline; attempt += 1) {
    if (input.condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  if (!input.condition()) throw new Error('condition did not hold in time');
}

// ---------------------------------------------------------------------------
// The endpoint policy
// ---------------------------------------------------------------------------

test('the policy allows the endpoints real browsers return', () => {
  const policy = createPushEndpointPolicy({ extraHosts: [] });
  const real = [
    'https://fcm.googleapis.com/fcm/send/dXJxYk3:APA91bH',
    'https://fcm.googleapis.com/wp/dXJxYk3:APA91bH',
    'https://updates.push.services.mozilla.com/wpush/v2/gAAAAABk',
    'https://web.push.apple.com/QGhHZ6yY',
    'https://api.push.apple.com/3/device/abc',
    'https://wns2-par02p.notify.windows.com/w/?token=BQYAAAB',
    'https://fcm.googleapis.com:443/fcm/send/written-with-the-default-port',
  ];
  for (const endpoint of real) assert.equal(policy.isAllowed(endpoint), true, endpoint);
});

test('the policy refuses every endpoint that is not https at a known push service', () => {
  const policy = createPushEndpointPolicy({ extraHosts: [] });
  const refused = [
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://fcm.googleapis.com:8443/fcm/send/abc',
    'https://user:secret@fcm.googleapis.com/fcm/send/abc',
    'https://10.0.0.5/',
    'https://169.254.169.254/latest/meta-data/',
    'http://127.0.0.1:6379/',
    'https://localhost/',
    'https://fcm.googleapis.com.evil.example/',
    'https://evilpush.apple.com/',
    'https://push.apple.com/',
    'https://notify.windows.com/',
    'https://push.example.org/not-configured-here',
    'not a url',
    '',
  ];
  for (const endpoint of refused) assert.equal(policy.isAllowed(endpoint), false, endpoint);
});

test('an operator host extends the list, and a wildcard needs a label in front of it', () => {
  const policy = createPushEndpointPolicy({ extraHosts: ['push.example.org', '*.relay.example.net'] });
  assert.equal(policy.isAllowed('https://push.example.org/device'), true);
  assert.equal(policy.isAllowed('https://eu.relay.example.net/device'), true);
  assert.equal(policy.isAllowed('https://relay.example.net/device'), false);
  // And the defaults are still there.
  assert.ok(DEFAULT_PUSH_SERVICE_HOSTS.includes('fcm.googleapis.com'));
  assert.equal(policy.isAllowed('https://fcm.googleapis.com/fcm/send/abc'), true);
});

test('a registration naming an internal host is refused and writes nothing', async () => {
  const harness = await startPushHarness();
  try {
    const refused = await harness.request({
      person: harness.anna,
      method: 'PUT',
      path: '/v1/push/subscriptions',
      body: registrationBody({ endpoint: 'http://10.0.0.5:6379/' }),
    });
    assert.equal(refused.status, 400);
    assert.deepEqual(await refused.json(), { error: PUSH_ENDPOINT_REFUSED });
    assert.equal(harness.store.rows.size, 0);

    // THE CONTROL: the fixture endpoint, which the policy allows.
    const accepted = await harness.request({
      person: harness.anna,
      method: 'PUT',
      path: '/v1/push/subscriptions',
      body: registrationBody(),
    });
    assert.equal(accepted.status, 201);
    assert.equal(harness.store.rows.size, 1);
  } finally {
    await harness.close();
  }
});

test('a row written before the policy existed is deleted unsent, and an allowed one beside it is sent', async () => {
  const store = createFakePushStore();
  store.seed(dueRow('http://169.254.169.254/latest/meta-data/'));
  store.seed(dueRow('https://push.example.org/allowed'));
  const sentTo: string[] = [];

  const result = await runPushTick({
    endpointPolicy: FIXTURE_PUSH_ENDPOINT_POLICY,
    healthConsent: null,
    store,
    sender: async (credential) => {
      sentTo.push(credential.endpoint);
    },
    logger: createSilentLogger(),
    now: () => MORNING,
  });

  assert.deepEqual(sentTo, ['https://push.example.org/allowed']);
  assert.equal(result.refused, 1);
  assert.equal(result.sent, 1);
  assert.deepEqual([...store.rows.keys()], ['https://push.example.org/allowed']);
});

// ---------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------

test('one endpoint that never answers does not hold the others', async () => {
  const store = createFakePushStore();
  // FIRST in the table, so a tick that sends one by one would wait on it
  // before anybody else.
  store.seed(dueRow('https://push.example.org/slow'));
  for (let index = 1; index <= 5; index += 1) store.seed(dueRow(`https://push.example.org/quick-${index}`));

  const slowGate = new Gate();
  const delivered: string[] = [];
  const tick = runPushTick({
    endpointPolicy: FIXTURE_PUSH_ENDPOINT_POLICY,
    healthConsent: null,
    store,
    sender: async (credential) => {
      if (credential.endpoint.endsWith('/slow')) await slowGate.wait();
      delivered.push(credential.endpoint);
    },
    logger: createSilentLogger(),
    now: () => MORNING,
  });

  try {
    await waitFor({ condition: () => delivered.length === 5, ms: 1000 });
  } finally {
    slowGate.open();
  }
  const result = await tick;
  assert.equal(result.sent, 6);
});

test('no more than PUSH_SEND_CONCURRENCY deliveries are in flight at once', async () => {
  const store = createFakePushStore();
  const endpoints = 3 * PUSH_SEND_CONCURRENCY;
  for (let index = 1; index <= endpoints; index += 1) store.seed(dueRow(`https://push.example.org/device-${index}`));
  let inFlight = 0;
  let maxInFlight = 0;

  const result = await runPushTick({
    endpointPolicy: FIXTURE_PUSH_ENDPOINT_POLICY,
    healthConsent: null,
    store,
    sender: async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight -= 1;
    },
    logger: createSilentLogger(),
    now: () => MORNING,
  });

  assert.equal(result.sent, endpoints);
  assert.equal(maxInFlight, PUSH_SEND_CONCURRENCY);
});

test('two sends to one row land in plan order, so the cap counts up', async () => {
  const store = createFakePushStore();
  store.seed({ ...dueRow('https://push.example.org/both'), fastTargetEnabled: true, wakeAt: new Date(0) });
  const kinds: string[] = [];

  await runPushTick({
    endpointPolicy: FIXTURE_PUSH_ENDPOINT_POLICY,
    healthConsent: null,
    store,
    sender: async (_credential, payload) => {
      kinds.push(payload);
      await new Promise((resolve) => setTimeout(resolve, 2));
    },
    logger: createSilentLogger(),
    now: () => MORNING,
  });

  assert.deepEqual(kinds, ['{"kind":"catch-up"}', '{"kind":"fast-target"}']);
  assert.equal(store.rows.get('https://push.example.org/both')?.sendsToday, 2);
});

// ---------------------------------------------------------------------------
// Backoff
// ---------------------------------------------------------------------------

test('the retry delay doubles from one minute and stops at a day', () => {
  assert.equal(pushRetryDelayMs(1), PUSH_TICK_INTERVAL_MS);
  assert.equal(pushRetryDelayMs(2), 2 * PUSH_TICK_INTERVAL_MS);
  assert.equal(pushRetryDelayMs(5), 16 * PUSH_TICK_INTERVAL_MS);
  assert.equal(pushRetryDelayMs(40), 24 * 60 * 60 * 1000);
  // The whole walk to the limit is days, so a push service outage deletes nothing.
  let total = 0;
  for (let failures = 1; failures < PUSH_FAILED_SENDS_LIMIT; failures += 1) total += pushRetryDelayMs(failures);
  assert.ok(total > 4 * 24 * 60 * 60 * 1000, `only ${total} ms before a row is deleted`);
});

test('a failing row waits out its backoff, then is tried again', async () => {
  const store = createFakePushStore();
  const endpoint = 'https://push.example.org/flaky';
  store.seed(dueRow(endpoint));
  let calls = 0;
  let isFailing = true;
  const tickAt = (now: Date): ReturnType<typeof runPushTick> =>
    runPushTick({
      endpointPolicy: FIXTURE_PUSH_ENDPOINT_POLICY,
      healthConsent: null,
      store,
      sender: async () => {
        calls += 1;
        if (isFailing) throw new FakeWebPushError(503);
      },
      logger: createSilentLogger(),
      now: () => now,
    });

  const first = await tickAt(MORNING);
  assert.equal(first.failed, 1);
  assert.equal(store.rows.get(endpoint)?.failedSends, 1);
  assert.equal(store.rows.get(endpoint)?.retryAt?.getTime(), MORNING.getTime() + PUSH_TICK_INTERVAL_MS);

  // Thirty seconds later: still backing off, nothing sent.
  const early = await tickAt(new Date(MORNING.getTime() + 30_000));
  assert.equal(early.deferred, 1);
  assert.equal(calls, 1);

  // A minute later it is tried, and a delivery that lands clears the count.
  isFailing = false;
  const later = await tickAt(new Date(MORNING.getTime() + PUSH_TICK_INTERVAL_MS));
  assert.equal(later.sent, 1);
  assert.equal(calls, 2);
  assert.equal(store.rows.get(endpoint)?.failedSends, 0);
  assert.equal(store.rows.get(endpoint)?.retryAt, null);
});

test('a row at the failure limit is deleted, and one short of it is kept', async () => {
  const store = createFakePushStore();
  store.seed({ ...dueRow('https://push.example.org/dead'), failedSends: PUSH_FAILED_SENDS_LIMIT - 1 });
  // THE CONTROL: two failures short, so this one ends one short and stays.
  store.seed({ ...dueRow('https://push.example.org/ailing'), failedSends: PUSH_FAILED_SENDS_LIMIT - 2 });

  const result = await runPushTick({
    endpointPolicy: FIXTURE_PUSH_ENDPOINT_POLICY,
    healthConsent: null,
    store,
    sender: async () => {
      throw new FakeWebPushError(500);
    },
    logger: createSilentLogger(),
    now: () => MORNING,
  });

  assert.equal(result.abandoned, 1);
  assert.equal(store.rows.has('https://push.example.org/dead'), false);
  assert.equal(store.rows.get('https://push.example.org/ailing')?.failedSends, PUSH_FAILED_SENDS_LIMIT - 1);
});

// ---------------------------------------------------------------------------
// The scheduler and the sender
// ---------------------------------------------------------------------------

test('a tick still running when the next interval fires is not joined by a second one', async () => {
  const store = createFakePushStore();
  store.seed(dueRow('https://push.example.org/stuck'));
  let calls = 0;
  const gate = new Gate();

  const scheduler = startPushScheduler({
    endpointPolicy: FIXTURE_PUSH_ENDPOINT_POLICY,
    healthConsent: null,
    store,
    sender: async () => {
      calls += 1;
      await gate.wait();
    },
    logger: createSilentLogger(),
    now: () => MORNING,
    intervalMs: 5,
  });
  try {
    await waitFor({ condition: () => calls === 1, ms: 1000 });
    // Ten more intervals while the first send hangs.
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(calls, 1, 'a second tick would have planned the same unmarked row and sent it again');
  } finally {
    scheduler.stop();
    gate.open();
  }
});

const hangingServers: TcpServer[] = [];
const hangingSockets = new Set<Socket>();
after(async () => {
  for (const socket of hangingSockets) socket.destroy();
  await Promise.all(hangingServers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

test('the web-push sender gives up on an endpoint that never answers', { timeout: 5000 }, async () => {
  // A TCP listener that accepts and then says nothing, not even the TLS
  // handshake: what a stuck push service looks like from here.
  const server = createTcpServer((socket) => {
    hangingSockets.add(socket);
    socket.on('error', () => undefined);
  });
  hangingServers.push(server);
  server.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  // SAFETY: `listen(0)` binds a TCP port; Node returns the string form of an
  // address only for a Unix domain socket, which this never opens.
  const { port } = server.address() as AddressInfo;

  const vapid = webpush.generateVAPIDKeys();
  const device = createECDH('prime256v1');
  device.generateKeys();
  const sender = createWebPushSender(
    { publicKey: vapid.publicKey, privateKey: vapid.privateKey, subject: 'mailto:ops@example.org' },
    200,
  );

  const started = Date.now();
  await assert.rejects(
    sender(
      {
        endpoint: `https://127.0.0.1:${port}/hang`,
        keys: { p256dh: device.getPublicKey('base64url'), auth: randomBytes(16).toString('base64url') },
      },
      '{"kind":"catch-up"}',
      { TTL: 60, topic: 'openplate-fast', urgency: 'normal' },
    ),
  );
  assert.ok(Date.now() - started < 2000, 'the sender must give up near its timeout, not wait for the socket');
});
