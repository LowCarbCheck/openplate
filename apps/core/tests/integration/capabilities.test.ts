/**
 * Capabilities against real Postgres and the real proxy (2026-10-05).
 *
 * WHAT ONLY A DATABASE CAN SAY. That `accounts.capabilities` exists (migration
 * 0031) and is a nullable array, so a new account has NO RECORD (`NULL`) rather
 * than an empty one. That an operator's PATCH writes it through the real store
 * and reads it back through the real admin view. And that a request refused for
 * a missing capability leaves no `ai_usage_days` row, which is the claim the
 * whole check exists to keep: it is decided before anything is counted.
 *
 * EVERY REFUSAL HAS ITS CONTROL: the same request from an account that holds
 * the capability, or from an instance that checks nothing, goes through.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import { NO_INSTANCE_STANDING, type InstanceStanding } from '../../src/accounts/instance-standing.js';
import { accounts, aiUsageDays } from '../../src/db/schema.js';
import { setupTestDatabase, type TestDatabase } from './db-harness.js';
import { startService, type HttpResponse, type ServiceHarness } from './service-harness.js';

const ADMIN_TOKEN = 'admin-capabilities-3f1c9b7a5d2e48a6';
const BODY = { model: 'm', messages: [{ role: 'user', content: 'what is on this plate?' }] };
const SCAN_SCHEMA_BODY = {
  ...BODY,
  response_format: { type: 'json_schema', json_schema: { name: 'scan_result', schema: { type: 'object' } } },
};

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

async function startInstance(standing: Partial<InstanceStanding> | null): Promise<ServiceHarness> {
  return startService({
    db: database.db,
    adminToken: ADMIN_TOKEN,
    ai: { baseUrl: upstreamBaseUrl, apiKey: 'sk-the-operators-key' },
    standing: standing === null ? null : { ...NO_INSTANCE_STANDING, ...standing },
  });
}

function call(input: {
  service: ServiceHarness;
  accessToken: string;
  feature?: string;
  body?: object;
}): Promise<HttpResponse<{ error?: string; capability?: string }>> {
  return input.service.request({
    method: 'POST',
    path: '/v1/chat/completions',
    accessToken: input.accessToken,
    body: input.body ?? BODY,
    headers: input.feature === undefined ? {} : { 'X-Openplate-Feature': input.feature },
  });
}

async function usageRows(accountId: number): Promise<number> {
  const rows = await database.db.select().from(aiUsageDays).where(eq(aiUsageDays.accountId, accountId));
  return rows.length;
}

function patchCapabilities(input: {
  service: ServiceHarness;
  accountId: number;
  capabilities: string[] | null;
}): Promise<HttpResponse<{ account: { capabilities: string[] | null } }>> {
  return input.service.request({
    method: 'PATCH',
    path: `/v1/admin/accounts/${input.accountId}`,
    adminToken: ADMIN_TOKEN,
    body: { capabilities: input.capabilities },
  });
}

test('a new account has no capability record, and an instance that checks nothing refuses nothing', async () => {
  const service = await startInstance(null);
  try {
    const session = await service.signupThroughInvite({ email: 'anna@example.org', dailyAiLimit: 5 });
    const [row] = await database.db.select().from(accounts).where(eq(accounts.id, session.account.id));
    assert.equal(row?.capabilities, null, 'NULL, not an empty array: there is no record');

    for (const feature of [undefined, 'scan', 'recipes']) {
      const answered = await call({ service, accessToken: session.tokens.accessToken, feature });
      assert.equal(answered.status, 200, String(feature));
    }
    assert.equal(upstreamCalls, 3);
  } finally {
    await service.close();
  }
});

test('an operator writes a record, and a feature outside it is a 403 that counts nothing', async () => {
  const service = await startInstance({ capabilitySchemaMap: new Map([['scan_result', 'scan']]) });
  try {
    const session = await service.signupThroughInvite({ email: 'anna@example.org', dailyAiLimit: 5 });

    const written = await patchCapabilities({
      service,
      accountId: session.account.id,
      capabilities: ['recipes', 'scan', 'scan'],
    });
    assert.equal(written.status, 200);
    assert.deepEqual(written.body.account.capabilities, ['recipes', 'scan']);
    const [row] = await database.db.select().from(accounts).where(eq(accounts.id, session.account.id));
    assert.deepEqual(row?.capabilities, ['recipes', 'scan']);

    // The record holds `recipes` and `scan`: a feature outside it is refused.
    const refused = await call({ service, accessToken: session.tokens.accessToken, feature: 'meal-plan' });
    assert.equal(refused.status, 403);
    assert.deepEqual(refused.body, { error: 'capability-required', capability: 'meal-plan' });
    assert.equal(await usageRows(session.account.id), 0, 'a refused request writes no usage row');
    assert.equal(upstreamCalls, 0);

    // THE CONTROL: a feature in the record goes through and is counted.
    const allowed = await call({ service, accessToken: session.tokens.accessToken, feature: 'recipes' });
    assert.equal(allowed.status, 200);
    assert.equal(await usageRows(session.account.id), 1);
    assert.equal(upstreamCalls, 1);

    // Narrow the record to `recipes`: the mapped schema now needs `scan`, whatever the header says.
    await patchCapabilities({ service, accountId: session.account.id, capabilities: ['recipes'] });
    const lying = await call({
      service,
      accessToken: session.tokens.accessToken,
      feature: 'recipes',
      body: SCAN_SCHEMA_BODY,
    });
    assert.equal(lying.status, 403);
    assert.deepEqual(lying.body, { error: 'capability-required', capability: 'scan' });
    assert.equal(upstreamCalls, 1, 'the lying request never reached the provider');
  } finally {
    await service.close();
  }
});

test('removing the record hands the decision back to the instance default', async () => {
  const service = await startInstance({ defaultCapabilities: ['scan'] });
  try {
    const session = await service.signupThroughInvite({ email: 'anna@example.org', dailyAiLimit: 5 });
    const accessToken = session.tokens.accessToken;
    const view = async (): Promise<string[] | null> => {
      const response = await service.request<{ account: { capabilities: string[] | null } }>({
        method: 'GET',
        path: '/v1/auth/account',
        accessToken,
      });
      return response.body.account.capabilities;
    };

    // No record: the default decides, and the account view says so.
    assert.deepEqual(await view(), ['scan']);
    assert.equal((await call({ service, accessToken, feature: 'scan' })).status, 200);
    assert.equal((await call({ service, accessToken, feature: 'recipes' })).status, 403);

    // A record replaces the default.
    await patchCapabilities({ service, accountId: session.account.id, capabilities: ['recipes'] });
    assert.deepEqual(await view(), ['recipes']);
    assert.equal((await call({ service, accessToken, feature: 'recipes' })).status, 200);
    assert.equal((await call({ service, accessToken, feature: 'scan' })).status, 403);

    // The admin view shows the OWN record, not the default.
    const adminView = await service.request<{ account: { capabilities: string[] | null } }>({
      method: 'GET',
      path: `/v1/admin/accounts/${session.account.id}`,
      adminToken: ADMIN_TOKEN,
    });
    assert.deepEqual(adminView.body.account.capabilities, ['recipes']);

    // `null` removes the record.
    const removed = await patchCapabilities({ service, accountId: session.account.id, capabilities: null });
    assert.equal(removed.body.account.capabilities, null, 'the admin view says there is no record');
    assert.deepEqual(await view(), ['scan'], 'and the account view is the default again');
    assert.equal((await call({ service, accessToken, feature: 'scan' })).status, 200);
  } finally {
    await service.close();
  }
});

test('the operator PATCH refuses a bad list, and /health publishes the default', async () => {
  const service = await startInstance({ defaultCapabilities: ['scan', 'recipes'] });
  try {
    const session = await service.signupThroughInvite({ email: 'anna@example.org', dailyAiLimit: 5 });
    const refused = await service.request<{ error: string }>({
      method: 'PATCH',
      path: `/v1/admin/accounts/${session.account.id}`,
      adminToken: ADMIN_TOKEN,
      body: { capabilities: ['none'] },
    });
    assert.equal(refused.status, 400);
    const [row] = await database.db.select().from(accounts).where(eq(accounts.id, session.account.id));
    assert.equal(row?.capabilities, null);

    const health = await service.request<{ instance: { defaultCapabilities: string[] | null } }>({
      method: 'GET',
      path: '/health',
    });
    assert.deepEqual(health.body.instance.defaultCapabilities, ['scan', 'recipes']);
  } finally {
    await service.close();
  }
});

test('CONTROL: /health says null on an instance with no default, and [] for the default "none"', async () => {
  for (const [defaultCapabilities, expected] of [
    [null, null],
    [[], []],
  ] as const) {
    const service = await startInstance({ defaultCapabilities });
    try {
      const health = await service.request<{ instance: { defaultCapabilities: string[] | null } }>({
        method: 'GET',
        path: '/health',
      });
      assert.deepEqual(health.body.instance.defaultCapabilities, expected);
    } finally {
      await service.close();
    }
  }
});
