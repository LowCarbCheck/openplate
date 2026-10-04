/**
 * The call that asks Pigeon to forget a deleted account's address
 * (`mail/recipient-eraser.ts`).
 *
 * IT RUNS AGAINST A REAL LISTENING SERVER on a loopback port, so what is
 * asserted is what a real request carries: the path, the Bearer key, and above
 * all that the address is in the BODY and nowhere in the URL. The retry is
 * counted at the server, not read off the code.
 *
 * THE CONTROLS: a Resend-shaped URL gets no eraser (so the Pigeon check is not
 * "always on"), a 404 is not retried while a 500 is (so the retry rule is not
 * "always" or "never"), and every log line is searched for the address while
 * the same capture is shown to hold the line that proves the failure happened.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import type { LogFields, Logger } from '../../src/logger.js';
import {
  ANSWER_BUDGET_MS,
  createPigeonRecipientEraser,
  ERASE_BACKOFF_MS,
  MAX_ERASE_ATTEMPTS,
  pigeonEraseUrl,
} from '../../src/mail/recipient-eraser.js';
import type { HttpMailConfig, MailConfig } from '../../src/mail/mailer.js';

const ADDRESS = 'forgotten.person@example.org';
const API_KEY = 'ske_a-key-the-fake-pigeon-expects';

const servers: Server[] = [];

after(async () => {
  for (const server of servers) server.closeAllConnections();
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

interface ReceivedErase {
  method: string | undefined;
  url: string | undefined;
  authorization: string | undefined;
  contentType: string | undefined;
  body: string;
}

interface FakePigeon {
  /** The mail API URL core is configured with, the way `MAIL_API_URL` names it. */
  mailUrl: string;
  received: ReceivedErase[];
  /** What requests get: `script` statuses first, one per request, then `status`; `hang` is no answer at all. */
  behave: { status: number; hang: boolean; script: number[] };
}

async function startFakePigeon(): Promise<FakePigeon> {
  const received: ReceivedErase[] = [];
  const script: number[] = [];
  const behave = { status: 204, hang: false, script };
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      received.push({
        method: req.method,
        url: req.url,
        authorization: req.headers.authorization,
        contentType: req.headers['content-type'],
        body: Buffer.concat(chunks).toString('utf8'),
      });
      if (behave.hang) return;
      const status = behave.script.shift() ?? behave.status;
      res.writeHead(status, { 'content-type': 'application/json' });
      // An error body that echoes the address, as Pigeon and Resend both do.
      res.end(status === 204 ? undefined : JSON.stringify({ error: 'nope', email: ADDRESS }));
    });
  });
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  // SAFETY: `listen(0, host)` binds a TCP port; Node returns the string form only for a Unix socket.
  const { port } = server.address() as AddressInfo;
  return { mailUrl: `http://127.0.0.1:${port}/v1/emails`, received, behave };
}

interface CapturedLine {
  level: string;
  message: string;
  fields: LogFields | undefined;
}

interface CapturingLogger {
  logger: Logger;
  lines: CapturedLine[];
}

function capturingLogger(): CapturingLogger {
  const lines: CapturedLine[] = [];
  const at =
    (level: string) =>
    (message: string, fields?: LogFields): void => {
      lines.push({ level, message, fields });
    };
  return { lines, logger: { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') } };
}

function mailConfig(url: string): HttpMailConfig {
  return {
    url,
    apiKey: API_KEY,
    from: 'openplate <openplate@mail.example.org>',
    operatorEmail: 'operator@example.org',
  };
}

/** Milliseconds, so a retry is watched in a blink and not in seconds. */
const FAST = { attemptTimeoutMs: 400, backoffMs: [5, 5], answerBudgetMs: 2_000 } as const;

/** Waits until `predicate` holds, polling, so a test reads the background retry without a fixed sleep. */
async function until(predicate: () => boolean, what: string): Promise<void> {
  const maxPolls = 200;
  for (let poll = 1; poll <= maxPolls; poll += 1) {
    if (predicate()) return;
    await sleep(10);
  }
  throw new Error(`never happened: ${what}`);
}

// ── Which mail APIs get an eraser ──────────────────────────────────────────

test('Pigeon is told from Resend by the path: /v1/emails has an erase sibling, /emails has none', () => {
  assert.equal(pigeonEraseUrl('http://pigeon:3601/v1/emails'), 'http://pigeon:3601/v1/recipients/erase');
  assert.equal(
    pigeonEraseUrl('https://mail.example.org/pigeon/v1/emails/'),
    'https://mail.example.org/pigeon/v1/recipients/erase',
  );
  // A query string or a fragment never travels with an address.
  assert.equal(pigeonEraseUrl('http://pigeon:3601/v1/emails?key=x#y'), 'http://pigeon:3601/v1/recipients/erase');
  // THE CONTROLS: Resend and anything else get no URL.
  assert.equal(pigeonEraseUrl('https://api.resend.com/emails'), null);
  assert.equal(pigeonEraseUrl('http://pigeon:3601/send'), null);
  assert.equal(pigeonEraseUrl('not a url'), null);
});

test('no mail, SMTP and a mail API that is not Pigeon each get no eraser', () => {
  const { logger } = capturingLogger();
  assert.equal(createPigeonRecipientEraser({ mail: null, logger }), null);
  const smtp: MailConfig = {
    transport: 'smtp',
    host: 'smtp.example.org',
    port: 587,
    tls: 'starttls-required',
    auth: null,
    from: 'f@example.org',
    operatorEmail: 'o@example.org',
  };
  assert.equal(createPigeonRecipientEraser({ mail: smtp, logger }), null);
  assert.equal(createPigeonRecipientEraser({ mail: mailConfig('https://api.resend.com/emails'), logger }), null);
  // THE CONTROL: the same function does build one for Pigeon's URL.
  assert.notEqual(createPigeonRecipientEraser({ mail: mailConfig('http://pigeon:3601/v1/emails'), logger }), null);
});

// ── What one call carries ──────────────────────────────────────────────────

test('the address is in the JSON body, the URL is the erase route alone, and the key is the mail key', async () => {
  const pigeon = await startFakePigeon();
  const { logger, lines } = capturingLogger();
  const erase = createPigeonRecipientEraser({ mail: mailConfig(pigeon.mailUrl), logger, ...FAST });
  assert.ok(erase);

  await erase({ email: ADDRESS });

  assert.equal(pigeon.received.length, 1);
  const call = pigeon.received[0];
  assert.equal(call?.method, 'POST');
  assert.equal(call?.url, '/v1/recipients/erase');
  assert.equal(call?.authorization, `Bearer ${API_KEY}`);
  assert.equal(call?.contentType, 'application/json');
  assert.deepEqual(JSON.parse(call?.body ?? ''), { email: ADDRESS });
  assert.equal(call?.url?.includes('forgotten'), false, 'the address must not be in the URL');
  assert.deepEqual(
    lines.map((line) => line.message),
    ['The mail service erased the copies of a deleted account address'],
  );
  assert.deepEqual(lines[0]?.fields, { attempts: 1 });
});

// ── Failure never throws, and only what can change is retried ──────────────

test('a 500 is tried three times, then one error line says how many, and nothing throws', async () => {
  const pigeon = await startFakePigeon();
  pigeon.behave.status = 500;
  const { logger, lines } = capturingLogger();
  const erase = createPigeonRecipientEraser({ mail: mailConfig(pigeon.mailUrl), logger, ...FAST });
  assert.ok(erase);

  await erase({ email: ADDRESS });
  await until(() => lines.some((line) => line.level === 'error'), 'the failure line');

  assert.equal(pigeon.received.length, MAX_ERASE_ATTEMPTS);
  const errors = lines.filter((line) => line.level === 'error');
  assert.equal(errors.length, 1);
  assert.deepEqual(errors[0]?.fields, { attempts: 3, status: 500, errorName: null, errorCode: null });
  // The echo of the address in Pigeon's error body reached no line.
  assert.equal(JSON.stringify(lines).toLowerCase().includes('forgotten'), false);
});

test('a 404 from an older Pigeon without the route is not retried, and does not throw', async () => {
  const pigeon = await startFakePigeon();
  pigeon.behave.status = 404;
  const { logger, lines } = capturingLogger();
  const erase = createPigeonRecipientEraser({ mail: mailConfig(pigeon.mailUrl), logger, ...FAST });
  assert.ok(erase);

  await erase({ email: ADDRESS });
  await sleep(100);

  // THE CONTROL for the retry rule: the 500 above made three calls, this one makes one.
  assert.equal(pigeon.received.length, 1);
  assert.deepEqual(lines[0]?.fields, { attempts: 1, status: 404, errorName: null, errorCode: null });
});

test('a Pigeon that fails once and then answers is retried to success', async () => {
  const pigeon = await startFakePigeon();
  pigeon.behave.script = [503];
  const { logger, lines } = capturingLogger();
  const erase = createPigeonRecipientEraser({ mail: mailConfig(pigeon.mailUrl), logger, ...FAST });
  assert.ok(erase);

  await erase({ email: ADDRESS });

  assert.equal(pigeon.received.length, 2);
  assert.deepEqual(
    lines.map((line) => line.level),
    ['info'],
  );
  assert.deepEqual(lines[0]?.fields, { attempts: 2 });
});

test('an unreachable Pigeon is a failure with an error name and code, never the address', async () => {
  const pigeon = await startFakePigeon();
  // A port nothing listens on: one a probe server held a moment ago, and released.
  const dead = new URL(pigeon.mailUrl);
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => probe.once('listening', resolve));
  // SAFETY: `listen(0, host)` binds a TCP port; Node returns the string form only for a Unix socket.
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  dead.port = String(port);

  const { logger, lines } = capturingLogger();
  const erase = createPigeonRecipientEraser({ mail: mailConfig(dead.toString()), logger, ...FAST });
  assert.ok(erase);

  await erase({ email: ADDRESS });
  await until(() => lines.some((line) => line.level === 'error'), 'the failure line');

  const failure = lines.find((line) => line.level === 'error');
  assert.equal(failure?.fields?.attempts, 3);
  assert.equal(failure?.fields?.status, null);
  assert.equal(failure?.fields?.errorName, 'TypeError');
  assert.equal(failure?.fields?.errorCode, 'ECONNREFUSED');
  assert.equal(JSON.stringify(lines).toLowerCase().includes('forgotten'), false);
});

// ── The answer budget ──────────────────────────────────────────────────────

test('a Pigeon that never answers holds the caller to the budget, and the attempts go on after it', async () => {
  const pigeon = await startFakePigeon();
  pigeon.behave.hang = true;
  const { logger, lines } = capturingLogger();
  const erase = createPigeonRecipientEraser({
    mail: mailConfig(pigeon.mailUrl),
    logger,
    attemptTimeoutMs: 300,
    backoffMs: [5, 5],
    answerBudgetMs: 150,
  });
  assert.ok(erase);

  const startedAt = Date.now();
  await erase({ email: ADDRESS });
  const waited = Date.now() - startedAt;

  // The caller was released at the budget, and long before three 300 ms attempts could end.
  assert.ok(waited >= 100, `released too early: ${waited} ms`);
  assert.ok(waited < 280, `held past the budget: ${waited} ms`);
  assert.equal(
    lines.some((line) => line.level === 'error'),
    false,
    'it was still trying',
  );

  // AFTER THE RESPONSE the remaining attempts are made, and the failure is logged then.
  await until(() => lines.some((line) => line.level === 'error'), 'the failure line, after the budget');
  assert.equal(pigeon.received.length, MAX_ERASE_ATTEMPTS);
  assert.deepEqual(lines.find((line) => line.level === 'error')?.fields, {
    attempts: 3,
    status: null,
    errorName: 'TimeoutError',
    errorCode: lines.find((line) => line.level === 'error')?.fields?.errorCode ?? null,
  });
});

test('the defaults keep the answer inside about two seconds and the backoff short', () => {
  assert.ok(ANSWER_BUDGET_MS <= 2_000);
  assert.equal(ERASE_BACKOFF_MS.length, MAX_ERASE_ATTEMPTS - 1);
  assert.ok(ERASE_BACKOFF_MS.reduce((sum, wait) => sum + wait, 0) <= 1_000);
});
