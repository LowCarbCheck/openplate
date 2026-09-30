/**
 * The consent to health data is REQUIRED on every data route, against the real
 * app, the real routes and Postgres (owner decision, 2026-09-29).
 *
 * THE RULE. On an instance that sets `HEALTH_CONSENT_VERSION`, an account that
 * does not hold that exact version is answered `403 health-consent-required`
 * on every route that stores, sends or spends something for it: the sync
 * writes, sharing, research, the AI proxy, reported estimates, the pulse, web
 * push, the plans proxy, the account patch, the member mint and the passphrase
 * change. It keeps what it needs to agree, to leave and to read back its own
 * copy: sign in, refresh, sign out, the account view, the consent route
 * itself, deletion, its own blob and its own key records.
 *
 * EVERY REFUSAL HAS A TWIN. The same request from an account that agreed is
 * not refused, and the same request on an instance that asks for nothing is
 * not refused either, so a middleware that refused everybody fails the twins
 * and one that refused nobody fails the refusals.
 *
 * AN ACCOUNT FROM BEFORE THE VERSION is made the way production makes one:
 * signed up on a service that asked for nothing, then used against a service
 * on the same database that asks. No row is written by hand.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setupTestDatabase, type TestDatabase } from './db-harness.js';
import {
  sampleAuthHash,
  sampleCiphertext,
  sampleKdfDescriptor,
  sampleWrappedDek,
  startService,
  type ServiceHarness,
  type StartServiceOptions,
} from './service-harness.js';
import { aiUsageDays } from '../../src/db/schema.js';
import { createDrizzlePushStore } from '../../src/push/push-store.js';
import { FIXTURE_PUSH_ENDPOINT_POLICY } from '../unit/fake-push-store.js';
import { runPushTick } from '../../src/push/push-scheduler.js';
import { createSilentLogger } from '../../src/logger.js';
import type { SessionResponse } from '../../src/accounts/auth-handlers.js';
import type { AccountView } from '../../src/protocol.js';

const VERSION = '2026-09-28';
const NEXT_VERSION = '2027-01-15';
const ADMIN_TOKEN = 'admin-token-for-the-required-consent-suite-01';
const UPSTREAM_KEY = 'sk-upstream-key-for-the-consent-suite';
/** The machine code every refusal here carries, transcribed from `PROTOCOL.md` §4. */
const REFUSED = { error: 'health-consent-required' };

let database: TestDatabase;
/** A stand-in for both the AI provider and the biller: it answers every request `200` and counts them by path. */
let upstream: Server;
let upstreamBaseUrl: string;
let upstreamPaths: string[];
/** Every service a test starts, closed after it whatever happened. */
const running: ServiceHarness[] = [];

before(async () => {
  database = await setupTestDatabase();
  upstream = createServer((request: IncomingMessage, response: ServerResponse) => {
    request.resume();
    request.on('end', () => {
      upstreamPaths.push(request.url ?? '');
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: 'a bowl of rice' } }] }));
    });
  });
  upstream.listen(0);
  await new Promise<void>((resolve) => upstream.once('listening', resolve));
  const address = upstream.address();
  if (address === null) throw new Error('expected a listening upstream');
  // SAFETY: `listen(0)` binds a TCP port; Node returns the string form only
  // for a Unix domain socket, which this never opens.
  upstreamBaseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;
});

beforeEach(async () => {
  for (const service of running.splice(0)) await service.close();
  await database.reset();
  upstreamPaths = [];
});

after(async () => {
  for (const service of running.splice(0)) await service.close();
  await new Promise<void>((resolve, reject) => upstream.close((error) => (error ? reject(error) : resolve())));
  await database.close();
});

/**
 * A service with every optional data surface switched on, so each refusal
 * below is the consent and never an unmounted route's 404.
 */
async function serve(options: { healthConsent: string | null }): Promise<ServiceHarness> {
  const surfaces: StartServiceOptions = {
    db: database.db,
    healthConsent: options.healthConsent === null ? null : { version: options.healthConsent },
    adminToken: ADMIN_TOKEN,
    sharing: true,
    research: true,
    feedback: {},
    push: {},
    memberInvites: {},
    ai: { baseUrl: upstreamBaseUrl, apiKey: UPSTREAM_KEY },
    plans: { baseUrl: upstreamBaseUrl, secret: 'plans-secret-for-the-consent-suite-0123' },
  };
  const service = await startService(surfaces);
  running.push(service);
  return service;
}

let addressCounter = 0;

/** A fresh address per account, so two accounts in one test never collide. */
function nextEmail(): string {
  addressCounter += 1;
  return `consent-${addressCounter}@example.org`;
}

/** An account signed up on a service that asked for nothing: every account a hosted instance held before the version. */
async function accountWithoutConsent(): Promise<SessionResponse> {
  const earlier = await serve({ healthConsent: null });
  const session = await earlier.signupThroughInvite({ email: nextEmail(), dailyAiLimit: 5 });
  assert.equal(session.account.healthConsent, null, 'the fixture account must hold no consent');
  return session;
}

/** An account that agreed to `VERSION` when it was created on `/join`. */
async function accountWithConsent(service: ServiceHarness): Promise<SessionResponse> {
  const session = await service.signupThroughInvite({ email: nextEmail(), dailyAiLimit: 5 });
  assert.equal(session.account.healthConsent?.version, VERSION, 'the fixture account must hold the consent');
  return session;
}

/** One request a data route answers, named for the failure message. */
interface DataRequest {
  name: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
}

/** Every route family the consent guards, one request each. The bodies are well formed where a success is asserted. */
function dataRequests(): DataRequest[] {
  return [
    {
      name: 'a sync push',
      method: 'POST',
      path: '/v1/sync/blob',
      body: { baseVersion: 0, envelopeVersion: 1, ciphertext: sampleCiphertext() },
    },
    {
      name: 'a key-record write',
      method: 'PUT',
      path: '/v1/sync/key-records/passphrase',
      body: { kdfDescriptor: sampleKdfDescriptor(), wrappedDek: sampleWrappedDek(), expectedUpdatedAt: null },
    },
    { name: 'a DEK rotation', method: 'POST', path: '/v1/sync/rotate-dek', body: {} },
    { name: 'the share list', method: 'GET', path: '/v1/sync/shares' },
    { name: 'the shared-with-me list', method: 'GET', path: '/v1/sync/shared' },
    { name: 'the research contributions', method: 'GET', path: '/v1/sync/contributions' },
    {
      name: 'an AI request',
      method: 'POST',
      path: '/v1/chat/completions',
      body: { model: 'a-vision-model', messages: [{ role: 'user', content: 'what is on this plate?' }] },
    },
    { name: 'a reported estimate', method: 'POST', path: '/v1/feedback', body: {} },
    { name: 'a pulse meal', method: 'POST', path: '/v1/pulse/meal', body: {} },
    { name: 'the pulse today', method: 'GET', path: '/v1/pulse/today' },
    {
      name: 'a push subscription',
      method: 'PUT',
      path: '/v1/push/subscriptions',
      body: {
        endpoint: 'https://push.example.org/consent',
        keys: { p256dh: 'a-device-public-key', auth: 'a-device-auth-secret' },
        timeZone: 'Europe/Berlin',
        locale: 'de',
        catchUpMinute: 480,
        fastTargetEnabled: true,
      },
    },
    { name: 'the plan read', method: 'GET', path: '/v1/plans/me' },
    { name: 'the account patch', method: 'PATCH', path: '/v1/auth/account', body: { displayName: 'Anna' } },
    { name: 'the member mint', method: 'POST', path: '/v1/auth/invites', body: { email: 'friend@example.org' } },
    { name: 'the passphrase change', method: 'POST', path: '/v1/auth/change-passphrase', body: {} },
  ];
}

async function send(
  service: ServiceHarness,
  input: { request: DataRequest; accessToken: string },
): Promise<{ status: number; body: unknown }> {
  return await service.request<unknown>({
    method: input.request.method,
    path: input.request.path,
    accessToken: input.accessToken,
    body: input.request.body,
  });
}

/** The three requests whose success is asserted exactly, not only as "not refused". */
function sync(): DataRequest {
  const found = dataRequests().find((request) => request.path === '/v1/sync/blob' && request.method === 'POST');
  if (found === undefined) throw new Error('the sync push is missing from the table');
  return found;
}

function aiRequest(): DataRequest {
  const found = dataRequests().find((request) => request.path === '/v1/chat/completions');
  if (found === undefined) throw new Error('the AI request is missing from the table');
  return found;
}

function pushSubscription(): DataRequest {
  const found = dataRequests().find((request) => request.path === '/v1/push/subscriptions');
  if (found === undefined) throw new Error('the push subscription is missing from the table');
  return found;
}

/** The body of `PUT /v1/push/subscriptions` the table above sends, for a test that names its own endpoint. */
function pushSubscriptionBody() {
  return {
    endpoint: 'https://push.example.org/consent',
    keys: { p256dh: 'a-device-public-key', auth: 'a-device-auth-secret' },
    timeZone: 'Europe/Berlin',
    locale: 'de',
    catchUpMinute: 480,
    fastTargetEnabled: true,
  };
}

/** How many AI units an account has spent on the fixture day. */
async function aiUnitsSpent(accountId: number): Promise<number> {
  const rows = await database.db.select().from(aiUsageDays);
  return rows.filter((row) => row.accountId === accountId).reduce((sum, row) => sum + row.count, 0);
}

// ── The refusal ────────────────────────────────────────────────────────────

test('an account without the consent is refused a sync push, an AI request and a push subscription', async () => {
  const session = await accountWithoutConsent();
  const service = await serve({ healthConsent: VERSION });
  const accessToken = session.tokens.accessToken;

  for (const request of [sync(), aiRequest(), pushSubscription()]) {
    const refused = await send(service, { request, accessToken });
    assert.equal(refused.status, 403, `${request.name}: ${JSON.stringify(refused.body)}`);
    assert.deepEqual(refused.body, REFUSED, request.name);
  }

  // NOTHING WAS SPENT OR SENT: the refusal comes before the reservation and
  // before the upstream call, and no blob was stored.
  assert.equal(await aiUnitsSpent(session.account.id), 0, 'a refused AI request spent a unit');
  assert.deepEqual(upstreamPaths, [], 'a refused AI request reached the provider');
  const pulled = await service.request<unknown>({ method: 'GET', path: '/v1/sync/blob', accessToken });
  assert.equal(pulled.status, 404, 'a refused push stored a blob');
});

test('every data route family refuses an account without the consent', async () => {
  const session = await accountWithoutConsent();
  const service = await serve({ healthConsent: VERSION });

  for (const request of dataRequests()) {
    const refused = await send(service, { request, accessToken: session.tokens.accessToken });
    assert.equal(refused.status, 403, `${request.name}: ${JSON.stringify(refused.body)}`);
    assert.deepEqual(refused.body, REFUSED, request.name);
  }
});

test('a consent to an older wording is refused like none', async () => {
  const first = await serve({ healthConsent: VERSION });
  const session = await accountWithConsent(first);
  // The operator changed the wording.
  const service = await serve({ healthConsent: NEXT_VERSION });

  const refused = await send(service, { request: sync(), accessToken: session.tokens.accessToken });
  assert.equal(refused.status, 403);
  assert.deepEqual(refused.body, REFUSED);
});

// ── Twin (a): an account that agreed ───────────────────────────────────────

test('the twin: an account that agreed syncs, scans and subscribes', async () => {
  const service = await serve({ healthConsent: VERSION });
  const session = await accountWithConsent(service);
  const accessToken = session.tokens.accessToken;

  const pushed = await send(service, { request: sync(), accessToken });
  assert.equal(pushed.status, 200, JSON.stringify(pushed.body));

  const scanned = await send(service, { request: aiRequest(), accessToken });
  assert.equal(scanned.status, 200, JSON.stringify(scanned.body));
  assert.equal(upstreamPaths.length, 1, 'the consented scan must reach the provider');

  const subscribed = await send(service, { request: pushSubscription(), accessToken });
  assert.equal(subscribed.status, 201, JSON.stringify(subscribed.body));
});

test('the twin: no data route family refuses an account that agreed', async () => {
  const service = await serve({ healthConsent: VERSION });
  const session = await accountWithConsent(service);

  for (const request of dataRequests()) {
    const answered = await send(service, { request, accessToken: session.tokens.accessToken });
    assert.notDeepEqual(answered.body, REFUSED, `${request.name} was refused for consent: ${answered.status}`);
  }
});

test('agreeing on the consent route opens the data routes on the same access token', async () => {
  const session = await accountWithoutConsent();
  const service = await serve({ healthConsent: VERSION });
  const accessToken = session.tokens.accessToken;

  const refusedFirst = await send(service, { request: sync(), accessToken });
  assert.equal(refusedFirst.status, 403, 'the control: this account starts refused');

  const agreed = await service.request<{ account: AccountView }>({
    method: 'POST',
    path: '/v1/auth/account/health-consent',
    accessToken,
    body: { version: VERSION },
  });
  assert.equal(agreed.status, 200);

  const acceptedNext = await send(service, { request: sync(), accessToken });
  assert.equal(acceptedNext.status, 200, JSON.stringify(acceptedNext.body));
});

// ── Twin (b): what stays open ──────────────────────────────────────────────

test('the routes to agree, to leave and to read its own copy stay open to an account without the consent', async () => {
  const session = await accountWithoutConsent();
  const service = await serve({ healthConsent: VERSION });
  const accessToken = session.tokens.accessToken;

  const health = await service.request<unknown>({ method: 'GET', path: '/health' });
  assert.equal(health.status, 200, '/health');

  const login = await service.request<SessionResponse>({
    method: 'POST',
    path: '/v1/auth/login',
    body: { email: session.account.email, authHash: sampleAuthHash() },
  });
  assert.equal(login.status, 200, 'sign in');
  assert.equal(login.body.account.healthConsent, null);

  const refreshed = await service.request<unknown>({
    method: 'POST',
    path: '/v1/auth/refresh',
    body: { refreshToken: session.tokens.refreshToken },
  });
  assert.equal(refreshed.status, 200, 'refresh');

  const account = await service.request<{ account: AccountView }>({
    method: 'GET',
    path: '/v1/auth/account',
    accessToken: login.body.tokens.accessToken,
  });
  assert.equal(account.status, 200, 'the account view the app reads to decide it must ask');
  assert.equal(account.body.account.healthConsent, null);

  // ITS OWN COPY: sign-in reads the wrapped keys and pulls the diary before
  // the app can know where the person belongs, and the export needs the pull
  // on a new device. Nothing here stores anything.
  const keyRecords = await service.request<unknown>({
    method: 'GET',
    path: '/v1/sync/key-records',
    accessToken: login.body.tokens.accessToken,
  });
  assert.equal(keyRecords.status, 200, 'its own key records');
  const blob = await service.request<unknown>({
    method: 'GET',
    path: '/v1/sync/blob',
    accessToken: login.body.tokens.accessToken,
  });
  assert.equal(blob.status, 404, 'its own blob: none pushed yet, and not a refusal');

  const admin = await service.request<unknown>({ method: 'GET', path: '/v1/admin/accounts', adminToken: ADMIN_TOKEN });
  assert.equal(admin.status, 200, 'the operator API has its own credential and no consent');

  const loggedOut = await service.request<unknown>({
    method: 'POST',
    path: '/v1/auth/logout',
    accessToken: login.body.tokens.accessToken,
  });
  assert.equal(loggedOut.status, 204, 'sign out');

  // The original session is a different token family, so it is still live.
  const deleted = await service.request<unknown>({
    method: 'POST',
    path: '/v1/auth/delete',
    accessToken,
    body: { authHash: sampleAuthHash() },
  });
  assert.equal(deleted.status, 204, 'delete, which is how a consent is withdrawn or declined');
});

test('the consent route itself stays open to an account without the consent', async () => {
  const session = await accountWithoutConsent();
  const service = await serve({ healthConsent: VERSION });

  const agreed = await service.request<{ account: AccountView }>({
    method: 'POST',
    path: '/v1/auth/account/health-consent',
    accessToken: session.tokens.accessToken,
    body: { version: VERSION },
  });
  assert.equal(agreed.status, 200);
  assert.equal(agreed.body.account.healthConsent?.version, VERSION);
});

// ── Twin (c): an instance that asks for nothing ────────────────────────────

test('the twin: an instance that asks for no consent lets an account without one sync, scan and subscribe', async () => {
  const service = await serve({ healthConsent: null });
  const session = await service.signupThroughInvite({ email: nextEmail(), dailyAiLimit: 5 });
  assert.equal(session.account.healthConsent, null);
  const accessToken = session.tokens.accessToken;

  const pushed = await send(service, { request: sync(), accessToken });
  assert.equal(pushed.status, 200, JSON.stringify(pushed.body));
  const scanned = await send(service, { request: aiRequest(), accessToken });
  assert.equal(scanned.status, 200, JSON.stringify(scanned.body));
  const subscribed = await send(service, { request: pushSubscription(), accessToken });
  assert.equal(subscribed.status, 201, JSON.stringify(subscribed.body));

  for (const request of dataRequests()) {
    const answered = await send(service, { request, accessToken });
    assert.notDeepEqual(answered.body, REFUSED, `${request.name} was refused on an instance that asks nothing`);
  }
});

// ── The push scheduler, which reads the table rather than a route ───────────

test('the push tick sends to the account that agreed and to nobody else, from the real store', async () => {
  // A SUBSCRIPTION FROM BEFORE THE VERSION: registered while the instance
  // asked for nothing, the only way one exists for an account without the
  // consent now that the route refuses new ones.
  const earlier = await serve({ healthConsent: null });
  const silent = await earlier.signupThroughInvite({ email: nextEmail() });
  const early = await earlier.request<unknown>({
    method: 'PUT',
    path: '/v1/push/subscriptions',
    accessToken: silent.tokens.accessToken,
    body: { ...pushSubscriptionBody(), endpoint: 'https://push.example.org/never-agreed', catchUpMinute: 0 },
  });
  assert.equal(early.status, 201, 'the fixture subscription must exist');

  const service = await serve({ healthConsent: VERSION });
  const agreed = await accountWithConsent(service);
  const late = await service.request<unknown>({
    method: 'PUT',
    path: '/v1/push/subscriptions',
    accessToken: agreed.tokens.accessToken,
    body: { ...pushSubscriptionBody(), endpoint: 'https://push.example.org/agreed', catchUpMinute: 0 },
  });
  assert.equal(late.status, 201);

  const sent: string[] = [];
  const result = await runPushTick({
    endpointPolicy: FIXTURE_PUSH_ENDPOINT_POLICY,
    store: createDrizzlePushStore(database.db),
    sender: async (subscription) => {
      sent.push(subscription.endpoint);
    },
    logger: createSilentLogger(),
    now: () => new Date(service.now()),
    healthConsent: { version: VERSION },
  });
  assert.deepEqual(sent, ['https://push.example.org/agreed']);
  assert.equal(result.sent, 1);
});
