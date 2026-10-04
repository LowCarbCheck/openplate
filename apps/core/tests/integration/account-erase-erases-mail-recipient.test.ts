/**
 * Both erasure paths ask Pigeon to forget the address, AFTER the account is
 * gone, and neither waits on it to delete (M1 spec 01, 2026-10-05).
 *
 * WHY. Deleting an account removed its rows here and nothing in the mail
 * service, which keeps the recipient and the body of every letter it sent. A
 * password reset letter is a key to a diary. Now `POST /v1/auth/delete` and
 * `DELETE /v1/admin/accounts/:id` call `POST <mail API>/v1/recipients/erase`
 * with the address in the body.
 *
 * THE ORDER IS PROVEN BY THE FAKE PIGEON, not by reading the handler: it looks
 * the address up in the database while it handles the call and records whether
 * the account row was still there. A call made before the delete would see it.
 *
 * THE ADDRESS REACHES NO LOG. Every line the service logged is searched for it,
 * in the success case and in both failure cases, and the same capture is shown
 * to hold the lines that prove the delete and the failure really happened, so
 * an empty search is a result and not a silent logger. Pigeon's error body
 * echoes the address, as the real one does, so a leak from that echo would show.
 *
 * THE CONTROL, by hand: delete the `mailRecipientEraser` call in
 * `handleDeleteAccount` and this file fails. The output is in the commit that
 * added it.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { eq } from 'drizzle-orm';
import { accounts } from '../../src/db/schema.js';
import { asObject, asString, type JsonValue } from '../../src/lib/json.js';
import { createPigeonRecipientEraser } from '../../src/mail/recipient-eraser.js';
import { setupTestDatabase, type TestDatabase } from './db-harness.js';
import { sampleAuthHash, startService, type ServiceHarness } from './service-harness.js';
import { createRecordingLogger, type RecordedLine } from '../unit/pulse-harness.js';

const ADMIN_TOKEN = 'admin-token-that-is-long-enough-to-be-real';
const MAIL_KEY = 'ske_the-key-of-the-fake-pigeon';
const ADDRESS = 'erased.recipient@example.org';
/** The part before the @, which a log line could carry on its own. */
const LOCAL_PART = 'erased.recipient';

interface EraseCall {
  method: string | undefined;
  url: string | undefined;
  authorization: string | undefined;
  body: string;
  /** Whether an account row with the address in the body still existed while Pigeon handled the call. */
  accountStillExisted: boolean;
}

interface FakePigeon {
  /** What `MAIL_API_URL` is set to. */
  mailUrl: string;
  calls: EraseCall[];
  /** The status every call gets. */
  status: number;
  close(): Promise<void>;
}

let database: TestDatabase;
let pigeon: FakePigeon;
let service: ServiceHarness;
let lines: RecordedLine[];

async function startFakePigeon(): Promise<FakePigeon> {
  const calls: EraseCall[] = [];
  const sockets = new Set<Socket>();
  const fake: FakePigeon = {
    mailUrl: '',
    calls,
    status: 204,
    async close(): Promise<void> {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      void (async () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const email = readEmail(body);
        const rows =
          email === null
            ? []
            : await database.db.select({ id: accounts.id }).from(accounts).where(eq(accounts.email, email));
        calls.push({
          method: req.method,
          url: req.url,
          authorization: req.headers.authorization,
          body,
          accountStillExisted: rows.length > 0,
        });
        res.writeHead(fake.status, { 'content-type': 'application/json' });
        // Pigeon's error body echoes the request, address included. So does Resend's.
        res.end(fake.status === 204 ? undefined : JSON.stringify({ error: 'refused', email }));
      })();
    });
  });
  server.on('connection', (socket: Socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  // SAFETY: `listen(0, host)` binds a TCP port; Node returns the string form only for a Unix socket.
  const { port } = server.address() as AddressInfo;
  fake.mailUrl = `http://127.0.0.1:${port}/v1/emails`;
  return fake;
}

/** The `email` of a request body, or `null` when it is not the JSON this suite expects. */
function readEmail(body: string): string | null {
  try {
    // SAFETY: `JSON.parse` yields a JSON value, which is what `JsonValue` names; `asObject` and `asString` narrow it.
    return asString(asObject(JSON.parse(body) as JsonValue)?.email);
  } catch {
    return null;
  }
}

before(async () => {
  database = await setupTestDatabase();
  pigeon = await startFakePigeon();
});

after(async () => {
  await service?.close();
  await pigeon.close();
  await database.close();
});

beforeEach(async () => {
  await database.reset();
  pigeon.calls.length = 0;
  pigeon.status = 204;
  lines = [];
  await service?.close();
  const logger = createRecordingLogger(lines);
  service = await startService({
    db: database.db,
    adminToken: ADMIN_TOKEN,
    authLogger: logger,
    mailRecipientEraser: createPigeonRecipientEraser({
      mail: { url: pigeon.mailUrl, apiKey: MAIL_KEY, from: 'f@example.org', operatorEmail: 'o@example.org' },
      logger,
      attemptTimeoutMs: 500,
      backoffMs: [5, 5],
      answerBudgetMs: 1_500,
    }),
  });
});

async function accountExists(accountId: number): Promise<boolean> {
  const rows = await database.db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, accountId));
  return rows.length === 1;
}

/** Everything the service logged, as one lowercase string, for the address search. */
function transcript(): string {
  return JSON.stringify(lines).toLowerCase();
}

async function deleteMyself(input: { accessToken: string; seed: number }): Promise<number> {
  const response = await service.request({
    method: 'POST',
    path: '/v1/auth/delete',
    accessToken: input.accessToken,
    body: { authHash: sampleAuthHash(input.seed) },
  });
  return response.status;
}

test('a self-service delete asks Pigeon once, with the address in the body, after the account is gone', async () => {
  const session = await service.signupThroughInvite({ email: ADDRESS, authHash: sampleAuthHash(91) });

  assert.equal(await deleteMyself({ accessToken: session.tokens.accessToken, seed: 91 }), 204);

  assert.equal(pigeon.calls.length, 1);
  const call = pigeon.calls[0];
  assert.equal(call?.method, 'POST');
  assert.equal(call?.url, '/v1/recipients/erase');
  assert.equal(call?.authorization, `Bearer ${MAIL_KEY}`);
  assert.deepEqual(JSON.parse(call?.body ?? ''), { email: ADDRESS });
  assert.equal(call?.url?.toLowerCase().includes(LOCAL_PART), false, 'the address must not be in the URL');
  assert.equal(call?.accountStillExisted, false, 'Pigeon must hear AFTER the account is deleted');
  assert.equal(await accountExists(session.account.id), false);
});

test('an admin delete asks Pigeon too', async () => {
  const session = await service.signupThroughInvite({ email: ADDRESS, authHash: sampleAuthHash(92) });

  const response = await service.request({
    method: 'DELETE',
    path: `/v1/admin/accounts/${session.account.id}`,
    adminToken: ADMIN_TOKEN,
  });
  assert.equal(response.status, 204);

  assert.equal(pigeon.calls.length, 1);
  assert.deepEqual(JSON.parse(pigeon.calls[0]?.body ?? ''), { email: ADDRESS });
  assert.equal(pigeon.calls[0]?.accountStillExisted, false);
  assert.equal(await accountExists(session.account.id), false);
});

test('a Pigeon without the route (404) does not fail the delete, and is asked once', async () => {
  pigeon.status = 404;
  const session = await service.signupThroughInvite({ email: ADDRESS, authHash: sampleAuthHash(93) });

  assert.equal(await deleteMyself({ accessToken: session.tokens.accessToken, seed: 93 }), 204);

  assert.equal(await accountExists(session.account.id), false);
  assert.equal(pigeon.calls.length, 1);
  const failure = lines.find((line) => line.message.startsWith('Could not ask the mail service'));
  assert.equal(failure?.fields?.status, 404);
  assert.equal(failure?.fields?.attempts, 1);
});

test('a Pigeon that answers 500 does not fail the delete, is asked three times, and one line says so', async () => {
  pigeon.status = 500;
  const session = await service.signupThroughInvite({ email: ADDRESS, authHash: sampleAuthHash(94) });

  assert.equal(await deleteMyself({ accessToken: session.tokens.accessToken, seed: 94 }), 204);
  for (let poll = 1; poll <= 100 && !lines.some((line) => line.message.startsWith('Could not ask')); poll += 1) {
    await sleep(20);
  }

  assert.equal(await accountExists(session.account.id), false);
  assert.equal(pigeon.calls.length, 3);
  const failures = lines.filter((line) => line.message.startsWith('Could not ask the mail service'));
  assert.equal(failures.length, 1);
  assert.deepEqual(failures[0]?.fields, { attempts: 3, status: 500, errorName: null, errorCode: null });
});

test('a wrong password deletes nothing and asks Pigeon nothing', async () => {
  const session = await service.signupThroughInvite({ email: ADDRESS, authHash: sampleAuthHash(95) });

  assert.equal(await deleteMyself({ accessToken: session.tokens.accessToken, seed: 96 }), 401);

  assert.equal(pigeon.calls.length, 0);
  assert.equal(await accountExists(session.account.id), true);
});

test('no line the service logged holds the address, in success, 404 and 500', async () => {
  for (const [status, seed] of [
    [204, 97],
    [404, 98],
    [500, 99],
  ] as const) {
    pigeon.status = status;
    const session = await service.signupThroughInvite({
      email: `${LOCAL_PART}.${status}@example.org`,
      authHash: sampleAuthHash(seed),
    });
    assert.equal(await deleteMyself({ accessToken: session.tokens.accessToken, seed }), 204);
  }
  for (let poll = 1; poll <= 100 && pigeon.calls.length < 5; poll += 1) await sleep(20);
  await sleep(50);

  // THE CONTROL: the capture is not empty and holds the lines that prove each case ran.
  const messages = lines.map((line) => line.message);
  assert.equal(messages.filter((message) => message === 'Account deleted with all sync data').length, 3);
  assert.ok(messages.includes('The mail service erased the copies of a deleted account address'));
  assert.equal(messages.filter((message) => message.startsWith('Could not ask the mail service')).length, 2);
  assert.ok(pigeon.calls.length >= 5, `Pigeon saw ${pigeon.calls.length} calls, expected 1 + 1 + 3`);

  const text = transcript();
  assert.equal(text.includes(LOCAL_PART), false, 'the local part of the address reached a log line');
  assert.equal(text.includes('@example.org'), false, 'the domain of the address reached a log line');
});

test('the address search CAN find an address: the same search over a line that carries one', () => {
  // THE CONTROL for the test above, so a pass there is not the search looking at the wrong thing.
  const leaky = JSON.stringify([...lines, { message: 'oops', fields: { to: ADDRESS } }]).toLowerCase();
  assert.equal(leaky.includes(LOCAL_PART), true);
});
