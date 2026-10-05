/**
 * THE PHOTO PATH GUARD. The claim "our server does not save your photo" is
 * tested here by sending a photograph through the real service and then
 * looking for it everywhere a careless line of code could have put it.
 *
 * WHAT IT DOES. It starts the REAL core (`src/main.ts`, as a child process, so
 * a raw `process.stdout.write` is as visible as a logger call), points it at a
 * fake provider, and posts a photograph-shaped body to `/v1/chat/completions`
 * as a real signed-in account. The body is random bytes behind a JPEG header,
 * with a unique marker planted at three offsets (`jpegWithMarker`). It does
 * that once for each way the request can go wrong, and after each one it
 * searches the child's stdout and stderr, the HTTP response and every column of
 * every table in the database for the photograph in standard, URL-safe and
 * URL-encoded base64, hex, a `<Buffer ...>` dump, a JSON number array, the raw
 * marker, and every 12-byte window of the marker in base64 at all three
 * alignments (`leak-search.ts`).
 *
 * THE FAILURE MODES, because each reaches a different piece of code that
 * handles somebody else's string: the provider answers 200; answers 500 and
 * echoes the request (three ways: as it is, with JSON-escaped slashes, as
 * URL-safe base64); never answers; stalls in the middle of its body; answers
 * malformed JSON; answers 307 to another host; the body is over the limit; the
 * client goes away mid-upload and after the request has left; the body is not
 * valid JSON (garbage after the photograph, and cut off inside it).
 *
 * WHAT IT DOES NOT COVER, ON PURPOSE. `POST /v1/feedback` ("report a wrong
 * estimate") stores a photograph by design, the person's own choice and the
 * one documented exception, in `feedback_images`. It is not exercised here and
 * the search would rightly find the marker in it. That table is still read, so
 * a photograph arriving in any OTHER table fails this test.
 *
 * THE CONTROL. A guard that cannot fail is worse than none, and the only
 * switch that would make the service leak on purpose would be a switch in
 * production code, which is not acceptable. So the control is in two parts:
 *   1. `the searcher finds the marker in every dress it claims to` feeds the
 *      same searcher text that contains the marker, in each dress, and
 *      requires a hit for each (and none for clean text).
 *   2. A manual run, documented in apps/core/README.md under "The photo path
 *      guard": make `scrubPayloads` in `src/ai/scrub.ts` the identity function,
 *      run this file, and the three upstream-echo cases fail. Restore it.
 *
 * ANY NEW MEDIA PATH (the Max microphone included) JOINS THIS FILE BEFORE IT
 * SHIPS: add its failure modes to `MODES` below and its bytes to the searcher.
 *
 * The database is `TEST_DATABASE_URL` (the harness's default is the shared
 * `openplate_sync_test`). The core suite and the push gate use that one, so
 * a person who runs this by hand names their own database.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { inspect } from 'node:util';
import { setupTestDatabase, testDatabaseUrl, type TestDatabase } from './db-harness.js';
import { DEFAULT_TEST_SERVER_SECRET, startService } from './service-harness.js';
import {
  createLeakSearcher,
  readDatabaseHaystacks,
  WINDOW_BYTES,
  type Haystack,
  type LeakSearcher,
} from './leak-search.js';

const CORE_DIRECTORY = new URL('../../', import.meta.url).pathname;
const UPSTREAM_TIMEOUT_MS = 1500;
const MAX_REQUEST_BYTES = 200_000;
/** Under {@link MAX_REQUEST_BYTES} once base64 has inflated it by a third. */
const IMAGE_BYTES = 60_000;
/** Over it. */
const OVERSIZE_IMAGE_BYTES = 300_000;
/** How long after a response the child's output is given to arrive before it is read. */
const SETTLE_MS = 400;

// ── The photograph ─────────────────────────────────────────────────────────

/**
 * 24 bytes of ASCII, unique to this run. Planted three times in the image: at
 * the start (inside the 50 bytes `util.inspect` prints of a Buffer), in the
 * middle, and at the end (the tail a truncating leak keeps), at offsets that
 * differ modulo three so each base64 alignment occurs.
 */
function makeMarker(): Buffer {
  return Buffer.from(`OPENPLATE-GUARD-${randomBytes(4).toString('hex')}`, 'latin1');
}

function jpegWithMarker(input: { bytes: number; marker: Buffer; firstOffset?: number }): Buffer {
  const header = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
  const image = Buffer.concat([header, randomBytes(input.bytes), Buffer.from([0xff, 0xd9])]);
  const first = input.firstOffset ?? 12;
  const middle = Math.floor(image.length / 2 / 3) * 3 + 1;
  const last = image.length - input.marker.length - 3 - ((image.length - input.marker.length - 3 - 2) % 3);
  for (const offset of [first, middle, last]) input.marker.copy(image, offset);
  return image;
}

function chatBody(image: Buffer): string {
  return JSON.stringify({
    model: 'm',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What is on this plate?' },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image.toString('base64')}` } },
        ],
      },
    ],
  });
}

// ── The searcher's own control ─────────────────────────────────────────────

test('the image fixture holds the marker at offsets of all three alignments', () => {
  const marker = makeMarker();
  const image = jpegWithMarker({ bytes: IMAGE_BYTES, marker });
  const offsets: number[] = [];
  for (let at = image.indexOf(marker); at !== -1; at = image.indexOf(marker, at + 1)) offsets.push(at);
  assert.equal(offsets.length, 3);
  assert.deepEqual(new Set(offsets.map((offset) => offset % 3)).size, 3);
  assert.ok((offsets[0] ?? 99) + marker.length <= 50, 'the first copy is inside what util.inspect prints of a Buffer');
});

test('the searcher finds the marker in every dress it claims to, and nothing in clean text', () => {
  const marker = makeMarker();
  const image = jpegWithMarker({ bytes: IMAGE_BYTES, marker });
  const searcher = createLeakSearcher({ image, marker });
  assert.ok(searcher.needleCount > 100, 'a searcher with a handful of needles is not this one');

  const dresses = {
    'the image as base64 in a log line': `{"error":"data:image/jpeg;base64,${image.toString('base64')}"}`,
    'the image as URL-safe base64': `error=${image.toString('base64url')}`,
    'the image as URL-encoded base64': `body=${encodeURIComponent(image.toString('base64'))}`,
    'the image as hex': `dump ${image.toString('hex')}`,
    'a Buffer interpolated by util.inspect': `got ${inspect(image)}`,
    'a Buffer serialised by JSON.stringify': JSON.stringify(image),
    'an array printed by util.inspect, wrapped over lines': inspect([...image.subarray(0, 120)], { breakLength: 40 }),
    'the raw marker': `failed near ${marker.toString('latin1')}`,
    'the raw image written as latin1': image.toString('latin1'),
    'a JSON-escaped slash payload': JSON.stringify(image.toString('base64')).replaceAll('/', String.raw`\/`),
  } satisfies Record<string, string>;
  for (const [label, text] of Object.entries(dresses)) {
    const found = searcher.find([{ source: label, text }]);
    assert.ok(found.length > 0, `the searcher missed: ${label}`);
  }

  assert.deepEqual(searcher.find([{ source: 'clean', text: 'Proxied a completion accountId=1 status=200' }]), []);
  assert.deepEqual(searcher.find([{ source: 'other photo', text: randomBytes(5000).toString('base64') }]), []);
});

test('a window of the marker is found in base64 at each of the three alignments', () => {
  for (let alignment = 0; alignment < 3; alignment += 1) {
    const marker = makeMarker();
    const image = Buffer.concat([Buffer.alloc(30 + alignment, 0x55), marker, Buffer.alloc(30, 0x66)]);
    // The text around the marker only, as a leak that cut the photograph would keep it.
    const encoded = image.toString('base64');
    const from = Math.floor((30 + alignment) / 3) * 4 - 4;
    const cut = encoded.slice(from, from + 8 + Math.ceil((marker.length * 4) / 3));
    const searcher = createLeakSearcher({ image: randomBytes(1000), marker });
    const found = searcher.find([{ source: `cut at alignment ${alignment}`, text: `error: ${cut}` }]);
    assert.ok(
      found.some((entry) => entry.includes(`base64 at alignment ${alignment}`)),
      `no hit at alignment ${alignment}: ${found.join('; ')}`,
    );
  }
});

test('a marker window shorter than twelve bytes is not what the searcher uses', () => {
  assert.equal(WINDOW_BYTES, 12);
});

// ── The fake provider ──────────────────────────────────────────────────────

type UpstreamBehavior =
  | 'ok'
  | 'error-echo'
  | 'error-echo-escaped'
  | 'error-echo-url-safe'
  | 'hang'
  | 'stall-body'
  | 'malformed-json'
  | 'slow-ok'
  | 'redirect';

interface FakeProvider {
  baseUrl: string;
  behavior: UpstreamBehavior;
  /** The bodies the provider received. */
  received: string[];
  /** The bodies the redirect target received. Must stay empty. */
  redirected: string[];
  close(): Promise<void>;
}

async function listen(server: Server): Promise<number> {
  server.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  // SAFETY: `listen(0, host)` binds a TCP port; Node returns the string form
  // only for a Unix domain socket, which this never opens.
  return (server.address() as AddressInfo).port;
}

async function readBody(request: IncomingMessage): Promise<string> {
  const pieces: Buffer[] = [];
  for await (const piece of request) pieces.push(Buffer.from(piece));
  return Buffer.concat(pieces).toString('utf8');
}

function toUrlSafeDataUri(body: string): string {
  return body.replace(
    /base64,([A-Za-z0-9+/=]+)/,
    (_whole, payload: string) => `base64,${payload.replaceAll('+', '-').replaceAll('/', '_')}`,
  );
}

async function startFakeProvider(): Promise<FakeProvider> {
  const redirectTarget = createServer((request, response) => {
    void (async (): Promise<void> => {
      provider.redirected.push(await readBody(request));
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}');
    })();
  });
  const targetPort = await listen(redirectTarget);

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async (): Promise<void> => {
      const body = await readBody(request);
      provider.received.push(body);
      switch (provider.behavior) {
        case 'ok':
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'a plate of rice' } }] }));
          return;
        case 'error-echo':
          response.writeHead(500, { 'content-type': 'text/plain' });
          response.end(`upstream failed on this request: ${body}`);
          return;
        case 'error-echo-escaped':
          response.writeHead(500, { 'content-type': 'application/json' });
          response.end(
            JSON.stringify({ error: { message: 'bad request', input: body } }).replaceAll('/', String.raw`\/`),
          );
          return;
        case 'error-echo-url-safe':
          response.writeHead(500, { 'content-type': 'text/plain' });
          response.end(`upstream failed on this request: ${toUrlSafeDataUri(body)}`);
          return;
        case 'hang':
          // Never answered. The proxy's own timeout ends it.
          return;
        case 'stall-body':
          response.writeHead(200, { 'content-type': 'application/json' });
          response.write('{"choices":[{"message":');
          return;
        case 'malformed-json':
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end('{"choices":[{"message":{"role":"assistant","content":"a pla');
          return;
        case 'slow-ok':
          await sleep(900);
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'late' } }] }));
          return;
        case 'redirect':
          response.writeHead(307, { location: `http://127.0.0.1:${targetPort}/v1/chat/completions` });
          response.end();
          return;
      }
    })();
  });
  const port = await listen(server);

  const provider: FakeProvider = {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    behavior: 'ok',
    received: [],
    redirected: [],
    async close() {
      for (const one of [server, redirectTarget]) {
        one.closeAllConnections();
        await new Promise<void>((resolve) => one.close(() => resolve()));
      }
    },
  };
  return provider;
}

// ── The real core, as a child process ──────────────────────────────────────

interface CoreProcess {
  baseUrl: string;
  child: ChildProcess;
  stdout(): string;
  stderr(): string;
  stop(): Promise<void>;
}

async function freePort(): Promise<number> {
  const server = createServer();
  const port = await listen(server);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

/** The variables a spawned core inherits: enough for node and tsx to run, and none of the developer's own configuration. */
function inheritedEnvironment(): NodeJS.ProcessEnv {
  const names = ['PATH', 'HOME', 'TMPDIR', 'LD_LIBRARY_PATH', 'NIX_LD', 'NIX_LD_LIBRARY_PATH'];
  const inherited: NodeJS.ProcessEnv = {};
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined) inherited[name] = value;
  }
  return inherited;
}

async function startCore(input: {
  upstreamBaseUrl: string;
  /** Extra settings for this core, on top of the ones every guard core gets. */
  extraEnv?: NodeJS.ProcessEnv;
}): Promise<CoreProcess> {
  const port = await freePort();
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    cwd: CORE_DIRECTORY,
    env: {
      ...inheritedEnvironment(),
      // No .env file may add configuration to this process.
      DOTENV_CONFIG_PATH: '/dev/null',
      DATABASE_URL: testDatabaseUrl(),
      SERVER_SECRET: DEFAULT_TEST_SERVER_SECRET,
      HOST: '127.0.0.1',
      PORT: String(port),
      LOG_LEVEL: 'debug',
      UPSTREAM_BASE_URL: input.upstreamBaseUrl,
      UPSTREAM_API_KEY: 'sk-the-operators-own-provider-key',
      UPSTREAM_TIMEOUT_MS: String(UPSTREAM_TIMEOUT_MS),
      AI_MAX_REQUEST_BYTES: String(MAX_REQUEST_BYTES),
      AI_RATE_LIMIT_PER_MINUTE: '1000',
      ...input.extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (piece: Buffer) => out.push(piece));
  child.stderr?.on('data', (piece: Buffer) => err.push(piece));

  const core: CoreProcess = {
    baseUrl: `http://127.0.0.1:${port}`,
    child,
    // `latin1` keeps every byte as one character, so a raw binary write is searched as it was written.
    stdout: () => Buffer.concat(out).toString('latin1'),
    stderr: () => Buffer.concat(err).toString('latin1'),
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      child.kill('SIGTERM');
      const outcome = await Promise.race([exited.then(() => 'exited'), sleep(10_000).then(() => 'timeout')]);
      if (outcome === 'timeout') {
        child.kill('SIGKILL');
        await exited;
      }
    },
  };

  const maxPolls = 120;
  for (let poll = 1; poll <= maxPolls; poll += 1) {
    if (child.exitCode !== null) {
      throw new Error(`core exited with ${child.exitCode} before it was ready:\n${core.stdout()}\n${core.stderr()}`);
    }
    try {
      const health = await fetch(`${core.baseUrl}/health`);
      if (health.ok) return core;
    } catch {
      // Not listening yet.
    }
    await sleep(250);
  }
  await core.stop();
  throw new Error(`core was not ready after ${maxPolls} polls:\n${core.stdout()}\n${core.stderr()}`);
}

// ── The client ─────────────────────────────────────────────────────────────

interface ClientOutcome {
  status: number | null;
  headers: string;
  body: string;
  /** What the client saw go wrong, if anything: a reset, a truncated body. */
  clientError: string | null;
}

async function describeResponse(response: Response): Promise<ClientOutcome> {
  const headers = JSON.stringify([...response.headers.entries()]);
  try {
    const body = Buffer.from(await response.arrayBuffer()).toString('latin1');
    return { status: response.status, headers, body, clientError: null };
  } catch (cause) {
    return { status: response.status, headers, body: '', clientError: inspect(cause, { depth: 4 }) };
  }
}

/** Raw HTTP, so a test can write half a body and then drop the connection. */
function rawPost(input: {
  url: string;
  accessToken: string;
  body: string;
  /** Write only this many bytes, wait, and destroy the socket. */
  abortAfterBytes?: number;
  /** Send everything, then destroy the socket once this resolves. */
  abortWhen?: () => Promise<void>;
}): Promise<ClientOutcome> {
  const url = new URL(input.url);
  const payload = Buffer.from(input.body, 'utf8');
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let status: number | null = null;
    let clientError: string | null = null;
    const finish = (): void => {
      resolve({ status, headers: '', body: Buffer.concat(chunks).toString('latin1'), clientError });
    };
    const req = httpRequest(
      {
        host: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': String(payload.length),
          authorization: `Bearer ${input.accessToken}`,
        },
      },
      (response) => {
        status = response.statusCode ?? null;
        response.on('data', (piece: Buffer) => chunks.push(piece));
        response.on('end', finish);
        response.on('error', (cause) => {
          clientError = inspect(cause);
          finish();
        });
      },
    );
    req.on('error', (cause) => {
      clientError = inspect(cause);
      finish();
    });
    req.on('close', finish);

    if (input.abortAfterBytes !== undefined) {
      req.write(payload.subarray(0, input.abortAfterBytes));
      void sleep(250).then(() => req.destroy());
      return;
    }
    req.end(payload);
    if (input.abortWhen !== undefined) void input.abortWhen().then(() => req.destroy());
  });
}

// ── The run ────────────────────────────────────────────────────────────────

let database: TestDatabase;
let provider: FakeProvider;
let core: CoreProcess;
let accessToken = '';
/** One searcher per photograph sent, for the whole-transcript search at the end. */
const searchers: LeakSearcher[] = [];
const modesRun: string[] = [];

before(async () => {
  database = await setupTestDatabase();
  await database.reset();

  // The account is made through the real signup in-process, against the same
  // database. The access token is a hash row, so the child accepts it.
  const service = await startService({ db: database.db });
  const session = await service.signupThroughInvite({ email: 'guard@example.org', dailyAiLimit: 10_000 });
  accessToken = session.tokens.accessToken;
  await service.close();

  provider = await startFakeProvider();
  core = await startCore({ upstreamBaseUrl: provider.baseUrl });
});

after(async () => {
  await core?.stop();
  await provider?.close();
  await database?.close();
});

interface ModeInput {
  name: string;
  behavior: UpstreamBehavior;
  imageBytes?: number;
  /** Sends the request. Absent is an ordinary post of the photograph. */
  send?: (context: { url: string; body: string; image: Buffer }) => Promise<ClientOutcome>;
  expectStatus?: number;
  /** A message the core must have logged, so a core that logged nothing cannot pass by silence. */
  expectLogged?: string;
  /** Whether the request must have reached the provider (it did not for an over-limit or malformed body). */
  expectReachesProvider: boolean;
  /** The response must show the scrubber's marker, not the photograph. */
  expectRedacted?: boolean;
  before?: () => void;
  /** The core to send to. Absent is the guard's main core. */
  target?: CoreProcess;
}

async function searchEverywhere(input: {
  searcher: LeakSearcher;
  outcome: ClientOutcome | null;
  stdout: string;
  stderr: string;
}): Promise<string[]> {
  const scan = await readDatabaseHaystacks(database.pool);
  assert.ok(scan.columns > 50, `the database scan read ${scan.columns} columns, expected the whole schema`);
  assert.ok(scan.byteaColumns > 3, 'the scan read no bytea columns');
  const haystacks: Haystack[] = [
    { source: 'core stdout', text: input.stdout },
    { source: 'core stderr', text: input.stderr },
    ...scan.haystacks,
  ];
  if (input.outcome !== null) {
    haystacks.push(
      { source: 'HTTP response body', text: input.outcome.body },
      { source: 'HTTP response headers', text: input.outcome.headers },
      { source: 'client error', text: input.outcome.clientError ?? '' },
    );
  }
  return input.searcher.find(haystacks);
}

async function runMode(input: ModeInput): Promise<void> {
  modesRun.push(input.name);
  provider.behavior = input.behavior;
  provider.received.length = 0;
  provider.redirected.length = 0;
  input.before?.();

  const marker = makeMarker();
  const image = jpegWithMarker({ bytes: input.imageBytes ?? IMAGE_BYTES, marker });
  const searcher = createLeakSearcher({ image, marker });
  searchers.push(searcher);
  const target = input.target ?? core;
  const url = `${target.baseUrl}/v1/chat/completions`;
  const body = chatBody(image);

  const stdoutFrom = target.stdout().length;
  const stderrFrom = target.stderr().length;
  const outcome =
    input.send !== undefined
      ? await input.send({ url, body, image })
      : await describeResponse(
          await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
            body,
          }),
        );
  await sleep(SETTLE_MS);
  const stdout = target.stdout().slice(stdoutFrom);
  const stderr = target.stderr().slice(stderrFrom);

  // The premises, so the search below is a result and not an accident.
  assert.equal(target.child.exitCode, null, `the core died during "${input.name}"`);
  if (input.expectStatus !== undefined) assert.equal(outcome.status, input.expectStatus, `status for "${input.name}"`);
  if (input.expectReachesProvider) {
    assert.ok(provider.received.length >= 1, 'the request never reached the provider');
    assert.ok(
      provider.received.join('').includes(image.toString('base64')),
      'the provider did not receive the photograph',
    );
  } else {
    assert.equal(provider.received.length, 0, 'the request reached the provider');
  }
  assert.deepEqual(provider.redirected, [], 'the redirect target received a request body');
  if (input.expectLogged !== undefined) {
    assert.ok((stdout + stderr).includes(input.expectLogged), `the core did not log "${input.expectLogged}"`);
  }

  const found = await searchEverywhere({ searcher, outcome, stdout, stderr });
  assert.deepEqual(found, [], `the photograph or its marker survived in "${input.name}"`);
  // After the search, so a scrubber that stopped scrubbing is reported as the
  // leak it is, and not as a missing marker.
  if (input.expectRedacted === true) {
    assert.ok(outcome.body.includes('[redacted]'), 'the echoed photograph was not visibly redacted in the response');
  }
}

const POST_OK = { expectReachesProvider: true } as const;

test('upstream answers 200', async () => {
  await runMode({
    name: 'upstream 200',
    behavior: 'ok',
    expectStatus: 200,
    expectLogged: 'Proxied a completion',
    ...POST_OK,
  });
});

test('upstream answers 500 and echoes the request body', async () => {
  await runMode({
    name: 'upstream 500 echoing the request',
    behavior: 'error-echo',
    expectStatus: 500,
    expectLogged: 'Upstream provider returned an error',
    expectRedacted: true,
    ...POST_OK,
  });
});

test('upstream answers 500 and echoes the request with JSON-escaped slashes', async () => {
  await runMode({
    name: 'upstream 500 echoing with escaped slashes',
    behavior: 'error-echo-escaped',
    expectStatus: 500,
    expectLogged: 'Upstream provider returned an error',
    expectRedacted: true,
    ...POST_OK,
  });
});

test('upstream answers 500 and echoes the photograph as URL-safe base64', async () => {
  await runMode({
    name: 'upstream 500 echoing URL-safe base64',
    behavior: 'error-echo-url-safe',
    expectStatus: 500,
    expectLogged: 'Upstream provider returned an error',
    expectRedacted: true,
    ...POST_OK,
  });
});

test('upstream never answers (headers timeout)', async () => {
  await runMode({
    name: 'upstream timeout',
    behavior: 'hang',
    expectStatus: 504,
    expectLogged: 'Upstream call failed before any response',
    ...POST_OK,
  });
});

test('upstream stalls in the middle of its body (body timeout)', async () => {
  await runMode({
    name: 'upstream stalls its body',
    behavior: 'stall-body',
    expectLogged: 'Relay of the upstream response failed',
    ...POST_OK,
  });
});

test('upstream answers malformed JSON', async () => {
  await runMode({ name: 'upstream malformed JSON', behavior: 'malformed-json', expectStatus: 200, ...POST_OK });
});

test('upstream answers 307 toward another host, which hears nothing', async () => {
  await runMode({
    name: 'upstream 307',
    behavior: 'redirect',
    expectStatus: 502,
    expectLogged: 'Upstream call failed before any response',
    ...POST_OK,
  });
});

test('the body is over the limit (413)', async () => {
  await runMode({
    name: 'body over the limit',
    behavior: 'ok',
    imageBytes: OVERSIZE_IMAGE_BYTES,
    expectStatus: 413,
    expectReachesProvider: false,
  });
});

test('the client goes away halfway through the upload', async () => {
  await runMode({
    name: 'client abort mid-upload',
    behavior: 'ok',
    send: ({ url, body }) => rawPost({ url, accessToken, body, abortAfterBytes: Math.floor(body.length / 2) }),
    expectReachesProvider: false,
  });
});

test('the client goes away after the request reached the provider', async () => {
  await runMode({
    name: 'client abort after the request left',
    behavior: 'slow-ok',
    send: ({ url, body }) =>
      rawPost({
        url,
        accessToken,
        body,
        abortWhen: async () => {
          for (let poll = 1; poll <= 100 && provider.received.length === 0; poll += 1) await sleep(50);
          await sleep(100);
        },
      }),
    ...POST_OK,
  });
});

test('the body is not valid JSON, with garbage right after the photograph (parse error)', async () => {
  await runMode({
    name: 'malformed JSON body, garbage after the photograph',
    behavior: 'ok',
    send: ({ url, body }) => rawPost({ url, accessToken, body: body.replace(/"\}\}\]\}\]\}$/, '"x}}]}]}') }),
    expectStatus: 400,
    expectReachesProvider: false,
  });
});

test('the body is not valid JSON, cut off inside the photograph (parse error)', async () => {
  await runMode({
    name: 'malformed JSON body, cut inside the photograph',
    behavior: 'ok',
    send: ({ url, body }) => rawPost({ url, accessToken, body: body.slice(0, Math.floor(body.length * 0.9)) }),
    expectStatus: 400,
    expectReachesProvider: false,
  });
});

/**
 * ONE CORE WITH BOTH ROUTING SETTINGS ON (M3 spec 02, 2026-10-04). `UPSTREAM_ZDR` and
 * `UPSTREAM_PROVIDER_ONLY` change the `provider` object of a body bound for
 * OpenRouter, and the fake provider here is not an OpenRouter host, so the
 * settings are parsed and inert on this path. What this proves is narrower and
 * still worth a mode: a core booted with both settings proxies a photograph, and
 * echoes one back through the scrubber, without a trace of it in its own
 * transcript or the database. The provider object itself is asserted in
 * `tests/unit/chat-body-policy.test.ts`.
 */
test('a core with zero retention and a pinned provider set still keeps the photograph out', async () => {
  const flagged = await startCore({
    upstreamBaseUrl: provider.baseUrl,
    extraEnv: { UPSTREAM_ZDR: 'true', UPSTREAM_PROVIDER_ONLY: 'google-vertex' },
  });
  const firstSearcher = searchers.length;
  try {
    await runMode({
      name: 'routing settings on, upstream 200',
      behavior: 'ok',
      target: flagged,
      expectStatus: 200,
      expectLogged: 'Proxied a completion',
      ...POST_OK,
    });
    await runMode({
      name: 'routing settings on, upstream 500 echoing the request',
      behavior: 'error-echo',
      target: flagged,
      expectStatus: 500,
      expectLogged: 'Upstream provider returned an error',
      expectRedacted: true,
      ...POST_OK,
    });
  } finally {
    await flagged.stop();
  }
  const scan = await readDatabaseHaystacks(database.pool);
  const haystacks: Haystack[] = [
    { source: 'flagged core stdout, whole run', text: flagged.stdout() },
    { source: 'flagged core stderr, whole run', text: flagged.stderr() },
    ...scan.haystacks,
  ];
  assert.ok(flagged.stdout().includes('Proxied a completion'), 'the flagged core transcript lacks the 200 case');
  for (const searcher of searchers.slice(firstSearcher)) assert.deepEqual(searcher.find(haystacks), []);
});

/**
 * ONE CORE ON THE TIER FILE (`AI_TIERS_FILE=bundled`, 2026-10-05). A request now
 * resolves to a tier before the body policy runs, and the tier decides the model
 * and the routing. The tier path reads the caller's body, so this mode proves it
 * leaves no trace of a photograph in the core's transcript or the database, in
 * the 200 case and in the case where the provider echoes the request back. The
 * fake provider is not an OpenRouter host, so no routing block is sent here; what
 * is proved is the model the provider receives (the tier's, not the caller's),
 * that the boot line and the completion line name the tier, and that scrubbing
 * is unchanged. The routing itself is `tests/unit/model-tier-wiring.test.ts`.
 */
test('a core on the bundled tier file still keeps the photograph out', async () => {
  const tiered = await startCore({ upstreamBaseUrl: provider.baseUrl, extraEnv: { AI_TIERS_FILE: 'bundled' } });
  const firstSearcher = searchers.length;
  try {
    await runMode({
      name: 'bundled tier file, upstream 200',
      behavior: 'ok',
      target: tiered,
      expectStatus: 200,
      expectLogged: 'Proxied a completion',
      ...POST_OK,
    });
    // THE PREMISE: the tier path ran. The caller's body names the model "m"
    // (`chatBody`), and the provider must have received the tier's instead.
    const forwardedModel = /"model":"([^"]*)"/.exec(provider.received[0] ?? '')?.[1];
    assert.ok(forwardedModel !== undefined && forwardedModel !== '', 'the provider received no model');
    assert.notEqual(forwardedModel, 'm', 'the caller model reached the provider: the tier path did not run');
    await runMode({
      name: 'bundled tier file, upstream 500 echoing the request',
      behavior: 'error-echo',
      target: tiered,
      expectStatus: 500,
      expectLogged: 'Upstream provider returned an error',
      expectRedacted: true,
      ...POST_OK,
    });
  } finally {
    await tiered.stop();
  }
  const scan = await readDatabaseHaystacks(database.pool);
  const haystacks: Haystack[] = [
    { source: 'tiered core stdout, whole run', text: tiered.stdout() },
    { source: 'tiered core stderr, whole run', text: tiered.stderr() },
    ...scan.haystacks,
  ];
  assert.ok(tiered.stdout().includes('AI tiers from bundled'), 'the tiered core did not log its tier line');
  assert.match(tiered.stdout(), /"tier":"standard"/, 'the completion line does not name the tier');
  for (const searcher of searchers.slice(firstSearcher)) assert.deepEqual(searcher.find(haystacks), []);
});

test('after every mode the core is alive, and its whole transcript holds no photograph', async () => {
  assert.ok(modesRun.length >= 12, `expected the whole table of failure modes, ran ${modesRun.length}`);
  assert.equal(core.child.exitCode, null, 'the core died');

  // Read after a clean shutdown, so every byte the core wrote is in the capture.
  await core.stop();
  const stdout = core.stdout();
  const stderr = core.stderr();
  assert.ok(stdout.includes('Proxied a completion'), 'the transcript is missing the 200 case');

  const scan = await readDatabaseHaystacks(database.pool);
  const haystacks: Haystack[] = [
    { source: 'core stdout, whole run', text: stdout },
    { source: 'core stderr, whole run', text: stderr },
    ...scan.haystacks,
  ];
  for (const searcher of searchers) {
    assert.deepEqual(searcher.find(haystacks), []);
  }
});

test('the database search sees a marker planted in a text column (control)', async () => {
  const marker = makeMarker();
  const image = jpegWithMarker({ bytes: 3000, marker });
  const searcher = createLeakSearcher({ image, marker });
  const original = await database.pool.query<{ id: number; display_name: string | null }>(
    'SELECT id, display_name FROM accounts LIMIT 1',
  );
  const account = original.rows[0];
  assert.ok(account !== undefined, 'the run left no account to plant the marker in');
  try {
    await database.pool.query('UPDATE accounts SET display_name = $1 WHERE id = $2', [
      `seen ${marker.toString('latin1')}`,
      account.id,
    ]);
    const scan = await readDatabaseHaystacks(database.pool);
    const found = searcher.find(scan.haystacks);
    assert.ok(
      found.some((entry) => entry.includes('database accounts.display_name')),
      `the scan missed it: ${found.join('; ')}`,
    );
  } finally {
    await database.pool.query('UPDATE accounts SET display_name = $1 WHERE id = $2', [
      account.display_name,
      account.id,
    ]);
  }
});
