/**
 * The terminal error handler logs a failure's NAME and CODE, and never its
 * words, its `body` or its `cause`.
 *
 * `body-parser` attaches the raw request body to `err.body` on a parse error,
 * and quotes a stretch of it in `err.message`. On the AI route that body is a
 * plate photograph. The handler sits behind every route, so what it logs is
 * the last thing that can keep one.
 *
 * Each case plants a MARKER in the places an error carries request content and
 * then reads what the handler logged. A control proves the planting worked: the
 * error the handler saw does hold the marker, so "no marker in the log" is a
 * result and not a fixture that never carried it.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type ErrorRequestHandler } from 'express';
import { createErrorMiddleware } from '../../src/server/error-middleware.js';
import { createRecordingLogger, type RecordedLine } from './pulse-harness.js';

const MARKER = 'PHOTO-MARKER-7f3a9c1e5b2d';
const servers: Server[] = [];

after(async () => {
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

interface ErrorHarness {
  baseUrl: string;
  lines: RecordedLine[];
  /** Every error the terminal handler was given, so a test can show the marker was on it. */
  seen: unknown[];
}

async function startHarness(options: { fail?: () => Error | string } = {}): Promise<ErrorHarness> {
  const lines: RecordedLine[] = [];
  const seen: unknown[] = [];
  const app = express();
  app.post('/echo', express.json({ limit: '1mb' }), () => {
    // Reached only for a body that parsed.
  });
  app.get('/fail', (_req, _res, next) => next(options.fail?.()));
  const recordSeen: ErrorRequestHandler = (cause, _req, _res, next) => {
    seen.push(cause);
    next(cause);
  };
  app.use(recordSeen);
  app.use(createErrorMiddleware(createRecordingLogger(lines)));

  const server = app.listen(0);
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  // SAFETY: `listen(0)` binds a TCP port, never a Unix domain socket.
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}`, lines, seen };
}

/** An error the way a body parser or a driver builds one: the request content is on the message, the body and the cause. */
function leakyError(): Error {
  const failure = Object.assign(new Error(`Unexpected token near "${MARKER}"`, { cause: new Error(MARKER) }), {
    name: 'SyntaxError',
    code: 'ERR_LEAKY',
    body: `{"image":"data:image/jpeg;base64,${MARKER}`,
  });
  return failure;
}

test('an unexpected error is logged by name and code, and the marker on its message, body and cause is not', async () => {
  const harness = await startHarness({ fail: leakyError });

  const response = await fetch(`${harness.baseUrl}/fail`);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'internal server error' });

  // The control: the error the handler was given DID carry the marker.
  const given = harness.seen[0];
  assert.ok(given instanceof Error);
  assert.ok(given.message.includes(MARKER));
  assert.ok(String(Object.entries(given)).includes(MARKER), 'the body property holds the marker');

  // The positive half, so a handler that logged nothing would not pass.
  const logged = harness.lines.find((line) => line.message === 'Unhandled request error');
  assert.ok(logged !== undefined, 'the failure must be recorded');
  assert.equal(logged.fields?.errorName, 'SyntaxError');
  assert.equal(logged.fields?.errorCode, 'ERR_LEAKY');
  assert.equal(logged.fields?.method, 'GET');
  assert.equal(logged.fields?.path, '/fail');

  assert.ok(!JSON.stringify(harness.lines).includes(MARKER), 'the marker reached a log line');
});

test('a thrown string is logged as a non-error, not as its text', async () => {
  const harness = await startHarness({ fail: () => `plain text with ${MARKER}` });

  const response = await fetch(`${harness.baseUrl}/fail`);
  assert.equal(response.status, 500);

  const logged = harness.lines.find((line) => line.message === 'Unhandled request error');
  assert.equal(logged?.fields?.errorName, 'NonError');
  assert.equal(logged?.fields?.errorCode, null);
  assert.ok(!JSON.stringify(harness.lines).includes(MARKER));
});

test('a body-parse error answers 400 and logs no part of the body', async () => {
  const harness = await startHarness();
  // Malformed JSON with the marker right where the parser stops. V8 quotes the
  // text around the break in the message, and body-parser keeps the whole body.
  const body = `{"image":"data:image/jpeg;base64,${MARKER}"x}`;

  const response = await fetch(`${harness.baseUrl}/echo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'request body is not valid JSON' });

  // The control: the parser's error carried the body, so this is a real test.
  const given = harness.seen[0];
  assert.ok(given instanceof Error);
  assert.ok(String(Object.entries(given)).includes(MARKER), 'body-parser attached the raw body');

  assert.ok(!JSON.stringify(harness.lines).includes(MARKER), 'the marker reached a log line');
});
