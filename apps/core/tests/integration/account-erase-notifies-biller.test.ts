/**
 * Both erasure paths tell the biller BEFORE the account is deleted, and
 * neither waits on it to delete.
 *
 * WHY. Until 2026-09-30 only the biller's nightly reconciliation cancelled the
 * subscription of an erased account, so one failed night meant a person could
 * be charged after deleting their account. Now `POST /v1/auth/delete` and
 * `DELETE /v1/admin/accounts/:id` call `POST <PLANS_UPSTREAM_URL>/erase` with
 * the secret and the account id first.
 *
 * THE ORDER IS PROVEN BY THE BILLER, not by reading the handler: the fake
 * biller looks the account up in the database while it is handling the
 * notice, and records whether the row still existed.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { eq } from 'drizzle-orm';
import { accounts } from '../../src/db/schema.js';
import { setupTestDatabase, type TestDatabase } from './db-harness.js';
import { sampleAuthHash, startService, type ServiceHarness } from './service-harness.js';
import { createRecordingLogger, type RecordedLine } from '../unit/pulse-harness.js';

const SECRET = 'a-shared-secret-for-the-biller';
const ADMIN_TOKEN = 'admin-token-that-is-long-enough-to-be-real';

interface EraseNotice {
  url: string;
  method: string;
  secret: string | undefined;
  accountId: string | undefined;
  body: string;
  /** Whether the account row still existed while the biller handled the notice. */
  accountStillExisted: boolean;
}

interface FakeBiller {
  baseUrl: string;
  notices: EraseNotice[];
  reply: { status: number; hang: boolean };
  close(): Promise<void>;
}

let database: TestDatabase;
let biller: FakeBiller;
let service: ServiceHarness;
let authLines: RecordedLine[];

/** A header Node parsed, as one string: the first value of a repeated one, `undefined` for an absent one. */
function singleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function startFakeBiller(): Promise<FakeBiller> {
  const notices: EraseNotice[] = [];
  const reply = { status: 204, hang: false };
  const sockets = new Set<Socket>();
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      void (async () => {
        const accountId = singleHeader(req.headers['x-account-id']);
        const id = Number(accountId);
        const rows = Number.isInteger(id)
          ? await database.db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, id))
          : [];
        notices.push({
          url: req.url ?? '',
          method: req.method ?? '',
          secret: singleHeader(req.headers['x-plans-secret']),
          accountId,
          body: Buffer.concat(chunks).toString('utf8'),
          accountStillExisted: rows.length === 1,
        });
        if (reply.hang) return;
        res.writeHead(reply.status);
        res.end();
      })();
    });
  });
  server.on('connection', (socket: Socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  // SAFETY: `listen(0)` binds a TCP port; Node returns the string form of an
  // address only for a Unix domain socket, which this never opens.
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}/plans`,
    notices,
    reply,
    async close(): Promise<void> {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}

before(async () => {
  database = await setupTestDatabase();
  biller = await startFakeBiller();
});

after(async () => {
  await service?.close();
  await biller.close();
  await database.close();
});

beforeEach(async () => {
  await database.reset();
  biller.notices.length = 0;
  biller.reply.status = 204;
  biller.reply.hang = false;
  authLines = [];
  await service?.close();
  service = await startService({
    db: database.db,
    adminToken: ADMIN_TOKEN,
    plans: { baseUrl: biller.baseUrl, secret: SECRET, timeoutMs: 300 },
    authLogger: createRecordingLogger(authLines),
  });
});

async function accountExists(accountId: number): Promise<boolean> {
  const rows = await database.db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, accountId));
  return rows.length === 1;
}

test('a self-service delete tells the biller first, with the secret and the account id and no body', async () => {
  const session = await service.signupThroughInvite({ email: 'leaving@example.org', authHash: sampleAuthHash(81) });
  const accountId = session.account.id;

  const response = await service.request({
    method: 'POST',
    path: '/v1/auth/delete',
    accessToken: session.tokens.accessToken,
    body: { authHash: sampleAuthHash(81) },
  });
  assert.equal(response.status, 204);

  assert.equal(biller.notices.length, 1);
  const [notice] = biller.notices;
  assert.equal(notice?.method, 'POST');
  assert.equal(notice?.url, '/plans/erase');
  assert.equal(notice?.secret, SECRET);
  assert.equal(notice?.accountId, String(accountId));
  assert.equal(notice?.body, '');
  assert.equal(notice?.accountStillExisted, true, 'the biller must hear BEFORE the account is deleted');
  assert.equal(await accountExists(accountId), false);
});

test('an admin delete tells the biller first too', async () => {
  const session = await service.signupThroughInvite({ email: 'removed@example.org', authHash: sampleAuthHash(82) });
  const accountId = session.account.id;

  const response = await service.request({
    method: 'DELETE',
    path: `/v1/admin/accounts/${accountId}`,
    adminToken: ADMIN_TOKEN,
  });
  assert.equal(response.status, 204);

  assert.equal(biller.notices.length, 1);
  assert.equal(biller.notices[0]?.accountId, String(accountId));
  assert.equal(biller.notices[0]?.accountStillExisted, true);
  assert.equal(await accountExists(accountId), false);
});

test('a biller that refuses the notice does not stop the erasure, and the error names the account', async () => {
  biller.reply.status = 500;
  const session = await service.signupThroughInvite({ email: 'refused@example.org', authHash: sampleAuthHash(83) });
  const accountId = session.account.id;

  const response = await service.request({
    method: 'POST',
    path: '/v1/auth/delete',
    accessToken: session.tokens.accessToken,
    body: { authHash: sampleAuthHash(83) },
  });
  assert.equal(response.status, 204);
  assert.equal(await accountExists(accountId), false);
  const logged = authLines.find((line) => line.message.startsWith('The biller refused an erasure notice'));
  assert.equal(logged?.fields?.accountId, accountId);
  assert.equal(logged?.fields?.status, 500);
});

test('a biller that never answers costs the erasure the timeout and nothing else', async () => {
  biller.reply.hang = true;
  const session = await service.signupThroughInvite({ email: 'hanging@example.org', authHash: sampleAuthHash(84) });
  const accountId = session.account.id;

  const response = await service.request({
    method: 'DELETE',
    path: `/v1/admin/accounts/${accountId}`,
    adminToken: ADMIN_TOKEN,
  });
  assert.equal(response.status, 204);
  assert.equal(await accountExists(accountId), false);
  const logged = authLines.find((line) => line.message.startsWith('Could not tell the biller about an erasure'));
  assert.equal(logged?.fields?.accountId, accountId);
});

test('a wrong password deletes nothing and tells the biller nothing', async () => {
  const session = await service.signupThroughInvite({ email: 'staying@example.org', authHash: sampleAuthHash(85) });
  const response = await service.request({
    method: 'POST',
    path: '/v1/auth/delete',
    accessToken: session.tokens.accessToken,
    body: { authHash: sampleAuthHash(86) },
  });
  assert.equal(response.status, 401);
  assert.equal(biller.notices.length, 0);
  assert.equal(await accountExists(session.account.id), true);
});
