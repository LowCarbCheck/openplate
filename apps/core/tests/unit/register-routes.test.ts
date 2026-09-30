/**
 * Authz-layer unit tests for `registerSyncRoutes` (security review finding
 * #5): every route MUST call `context.resolveEntitledUser` first and 403 on
 * `null` BEFORE the route's own handler core runs — never leak a 404/400/etc
 * from a handler that never should have been reached. Spins up a real
 * Express app on an ephemeral loopback port (no extra HTTP-testing
 * dependency needed) against a fake `SyncStorageAdapter` and a mock
 * `resolveEntitledUser` this file controls per test via a distinct account
 * id (keeps tests isolated without needing a fresh server per test).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { registerSyncRoutes } from '../../src/server/register-routes.js';
import { createFakeStorageAdapter } from './fake-storage-adapter.js';
import { createFakePassphraseGate } from './fake-passphrase-gate.js';
import type { SyncHostContext } from '../../src/contract-types.js';
import { asArray, asObject, asString, type JsonValue } from '../../src/lib/json.js';

let server: Server;
let baseUrl: string;

/** `null` makes every route's `resolveEntitledUser` resolve `null` (not entitled); a number entitles that userId. */
let currentEntitledUserId: number | null = null;

const passphrase = createFakePassphraseGate();

before(async () => {
  const app = express();
  const context: SyncHostContext = {
    storage: createFakeStorageAdapter(),
    resolveEntitledUser: async () => (currentEntitledUserId === null ? null : { userId: currentEntitledUserId }),
    passphrase,
  };
  registerSyncRoutes(app, context);

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (address === null) throw new Error('expected a listening server');
  // SAFETY: `listen(0)` binds a TCP port, and Node only returns the string
  // form of an address for a Unix domain socket, which this never opens.
  const { port } = address as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

function samplePushBody(): string {
  return JSON.stringify({
    baseVersion: 0,
    envelopeVersion: 1,
    ciphertext: Buffer.from('opaque-bytes').toString('base64'),
  });
}

function sampleKeyRecordBody(): string {
  return JSON.stringify({
    kdfDescriptor: null,
    wrappedDek: Buffer.from('opaque-wrapped-dek').toString('base64'),
    expectedUpdatedAt: null,
  });
}

test('GET /v1/sync/blob returns 403 when not entitled', async () => {
  currentEntitledUserId = null;
  const response = await fetch(`${baseUrl}/v1/sync/blob`);
  assert.equal(response.status, 403);
});

test('GET /v1/sync/blob reaches the handler once entitled (404, no blob yet)', async () => {
  currentEntitledUserId = 101;
  const response = await fetch(`${baseUrl}/v1/sync/blob`);
  assert.equal(response.status, 404);
});

test('POST /v1/sync/blob returns 403 when not entitled', async () => {
  currentEntitledUserId = null;
  const response = await fetch(`${baseUrl}/v1/sync/blob`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: samplePushBody(),
  });
  assert.equal(response.status, 403);
});

test('POST /v1/sync/blob reaches the handler once entitled (200 accepted)', async () => {
  currentEntitledUserId = 102;
  const response = await fetch(`${baseUrl}/v1/sync/blob`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: samplePushBody(),
  });
  assert.equal(response.status, 200);
});

test('GET /v1/sync/key-records returns 403 when not entitled', async () => {
  currentEntitledUserId = null;
  const response = await fetch(`${baseUrl}/v1/sync/key-records`);
  assert.equal(response.status, 403);
});

test('GET /v1/sync/key-records reaches the handler once entitled (200, empty list)', async () => {
  currentEntitledUserId = 103;
  const response = await fetch(`${baseUrl}/v1/sync/key-records`);
  assert.equal(response.status, 200);
  const body: JsonValue = await response.json();
  assert.deepEqual(asArray(asObject(body)?.records), []);
});

test('PUT /v1/sync/key-records/:kind returns 403 when not entitled', async () => {
  currentEntitledUserId = null;
  const response = await fetch(`${baseUrl}/v1/sync/key-records/recovery`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: sampleKeyRecordBody(),
  });
  assert.equal(response.status, 403);
});

test('PUT /v1/sync/key-records/:kind reaches the handler once entitled (200 created)', async () => {
  currentEntitledUserId = 104;
  const response = await fetch(`${baseUrl}/v1/sync/key-records/recovery`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: sampleKeyRecordBody(),
  });
  assert.equal(response.status, 200);
});

test('DELETE /v1/sync/key-records/:kind is not a route: 404 whether entitled or not, and nothing is deleted', async () => {
  currentEntitledUserId = 105;
  const created = await fetch(`${baseUrl}/v1/sync/key-records/recovery`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: sampleKeyRecordBody(),
  });
  assert.equal(created.status, 200);

  for (const entitled of [105, null]) {
    currentEntitledUserId = entitled;
    const response = await fetch(`${baseUrl}/v1/sync/key-records/recovery`, { method: 'DELETE' });
    assert.equal(response.status, 404);
  }

  currentEntitledUserId = 105;
  const listed = await fetch(`${baseUrl}/v1/sync/key-records`);
  assert.equal(asArray(asObject(await listed.json())?.records)?.length, 1);
});

/** A key-record body that asserts an existing record: an overwrite. */
function overwriteBody(input: { expectedUpdatedAt: string; currentAuthHash?: string }): string {
  return JSON.stringify({
    kdfDescriptor: null,
    wrappedDek: Buffer.from('a-replacement-wrap').toString('base64'),
    expectedUpdatedAt: input.expectedUpdatedAt,
    currentAuthHash: input.currentAuthHash,
  });
}

async function createRecoveryRecord(accountId: number): Promise<string> {
  currentEntitledUserId = accountId;
  const created = await fetch(`${baseUrl}/v1/sync/key-records/recovery`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: sampleKeyRecordBody(),
  });
  assert.equal(created.status, 200);
  const updatedAt = asString(asObject(await created.json())?.updatedAt);
  if (updatedAt === null) throw new Error('expected an updatedAt');
  return updatedAt;
}

const OWNER_AUTH_HASH = Buffer.alloc(32, 7).toString('base64');
const WRONG_AUTH_HASH = Buffer.alloc(32, 8).toString('base64');

test('a key-record OVERWRITE without currentAuthHash is 400 naming the field, and nothing changes', async () => {
  const updatedAt = await createRecoveryRecord(106);
  const checksBefore = passphrase.checks.length;
  const response = await fetch(`${baseUrl}/v1/sync/key-records/recovery`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: overwriteBody({ expectedUpdatedAt: updatedAt }),
  });
  assert.equal(response.status, 400);
  assert.match(asString(asObject(await response.json())?.error) ?? '', /currentAuthHash/);
  // Refused as a request, before any guess was spent.
  assert.equal(passphrase.checks.length, checksBefore);
});

test('a key-record OVERWRITE with a wrong currentAuthHash is 401 and the record keeps its wrap', async () => {
  const updatedAt = await createRecoveryRecord(107);
  passphrase.passphrases.set(107, OWNER_AUTH_HASH);
  const response = await fetch(`${baseUrl}/v1/sync/key-records/recovery`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: overwriteBody({ expectedUpdatedAt: updatedAt, currentAuthHash: WRONG_AUTH_HASH }),
  });
  assert.equal(response.status, 401);
  assert.equal(asString(asObject(await response.json())?.error), 'current passphrase is incorrect');

  const listed = await fetch(`${baseUrl}/v1/sync/key-records`);
  const record = asObject(asArray(asObject(await listed.json())?.records)?.[0] ?? null);
  assert.equal(asString(record?.updatedAt), updatedAt);
});

test('a key-record OVERWRITE with the right currentAuthHash is 200', async () => {
  const updatedAt = await createRecoveryRecord(108);
  passphrase.passphrases.set(108, OWNER_AUTH_HASH);
  const response = await fetch(`${baseUrl}/v1/sync/key-records/recovery`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: overwriteBody({ expectedUpdatedAt: updatedAt, currentAuthHash: OWNER_AUTH_HASH }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(passphrase.checks.at(-1), { accountId: 108, authHash: OWNER_AUTH_HASH });
});

test('a key-record CREATE stays token-only: no currentAuthHash, and the gate is never asked', async () => {
  const checksBefore = passphrase.checks.length;
  await createRecoveryRecord(109);
  assert.equal(passphrase.checks.length, checksBefore);
});

test('the 403 body never leaks handler-shaped data — same generic message across every route', async () => {
  currentEntitledUserId = null;
  const responses = await Promise.all([
    fetch(`${baseUrl}/v1/sync/blob`),
    fetch(`${baseUrl}/v1/sync/key-records`),
    fetch(`${baseUrl}/v1/sync/key-records/passphrase`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: sampleKeyRecordBody(),
    }),
  ]);
  for (const response of responses) {
    assert.equal(response.status, 403);
    const body: JsonValue = await response.json();
    assert.equal(asString(asObject(body)?.error), 'sync not enabled for this account');
  }
});
