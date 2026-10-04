/**
 * `pnpm core-api canary` against the REAL core, as a child process, with a fake
 * upstream provider (M3 spec 06, 2026-10-05).
 *
 * The canary is a tool for production, so this runs the whole thing the way an
 * operator does: the CLI as its own process, `CORE_URL` and `ADMIN_TOKEN` in its
 * environment, a core that mints an invite, redeems it, proxies one photograph
 * and deletes the account. Three claims, each with a control:
 *
 *  1. THE SCAN REACHED THE PROVIDER. The fake upstream saw the marker the CLI
 *     printed, in the photograph's base64. A canary whose photograph never left
 *     would print forms nobody can find anywhere.
 *  2. THE ACCOUNT IS GONE. The database holds no row for the address afterwards,
 *     and the control, `--keep`, leaves exactly one.
 *  3. NO SECRET IS PRINTED. Neither the admin token nor an invite token is in
 *     standard output or standard error, and the same search is shown to find a
 *     token in a line that holds one. The account's access token is minted
 *     inside the child and never known here, so the unit test
 *     (`tests/unit/canary.test.ts`) checks it against a stub that names it.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { eq } from 'drizzle-orm';
import { accounts } from '../../src/db/schema.js';
import { asArray, asNumber, asObject, asString, type JsonValue } from '../../src/lib/json.js';
import { setupTestDatabase, testDatabaseUrl, type TestDatabase } from './db-harness.js';
import { DEFAULT_TEST_SERVER_SECRET } from './service-harness.js';

const CORE_DIRECTORY = new URL('../../', import.meta.url).pathname;
const ADMIN_TOKEN = 'admin-token-of-the-canary-test-long-enough-to-be-real';
const ADDRESS = 'canary.operator@example.org';
const CONSENT_VERSION = '2026-09-28';
const MODEL = 'google/gemini-3.7-flash';

let database: TestDatabase;
let upstream: FakeUpstream;
let core: CoreProcess;

interface FakeUpstream {
  baseUrl: string;
  status: number;
  /** The bodies the provider received. */
  received: string[];
  close(): Promise<void>;
}

interface CoreProcess {
  baseUrl: string;
  output(): string;
  stop(): Promise<void>;
}

async function listen(server: Server): Promise<number> {
  server.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  // SAFETY: `listen(0, host)` binds a TCP port; Node returns the string form only for a Unix socket.
  return (server.address() as AddressInfo).port;
}

async function readBody(request: IncomingMessage): Promise<string> {
  const pieces: Buffer[] = [];
  for await (const piece of request) pieces.push(Buffer.from(piece));
  return Buffer.concat(pieces).toString('utf8');
}

async function startUpstream(): Promise<FakeUpstream> {
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async (): Promise<void> => {
      fake.received.push(await readBody(request));
      response.writeHead(fake.status, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }));
    })();
  });
  const port = await listen(server);
  const fake: FakeUpstream = {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    status: 200,
    received: [],
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
  return fake;
}

function inheritedEnvironment(): NodeJS.ProcessEnv {
  const names = ['PATH', 'HOME', 'TMPDIR', 'LD_LIBRARY_PATH', 'NIX_LD', 'NIX_LD_LIBRARY_PATH'];
  const inherited: NodeJS.ProcessEnv = {};
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined) inherited[name] = value;
  }
  return inherited;
}

async function freePort(): Promise<number> {
  const server = createServer();
  const port = await listen(server);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function startCore(upstreamBaseUrl: string): Promise<CoreProcess> {
  const port = await freePort();
  const out: Buffer[] = [];
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    cwd: CORE_DIRECTORY,
    env: {
      ...inheritedEnvironment(),
      DOTENV_CONFIG_PATH: '/dev/null',
      DATABASE_URL: testDatabaseUrl(),
      SERVER_SECRET: DEFAULT_TEST_SERVER_SECRET,
      HOST: '127.0.0.1',
      PORT: String(port),
      LOG_LEVEL: 'debug',
      ADMIN_TOKEN,
      // Link bases make the mint response carry the join link, which holds the invite token.
      SERVER_PUBLIC_URL: `http://127.0.0.1:${port}`,
      CLIENT_BASE_URL: 'http://127.0.0.1:5173',
      HEALTH_CONSENT_VERSION: CONSENT_VERSION,
      AI_ADVERTISED_MODEL: MODEL,
      UPSTREAM_BASE_URL: upstreamBaseUrl,
      UPSTREAM_API_KEY: 'sk-the-operators-own-provider-key',
      UPSTREAM_TIMEOUT_MS: '5000',
      AI_RATE_LIMIT_PER_MINUTE: '1000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (piece: Buffer) => out.push(piece));
  child.stderr?.on('data', (piece: Buffer) => out.push(piece));
  const handle: CoreProcess = {
    baseUrl: `http://127.0.0.1:${port}`,
    output: () => Buffer.concat(out).toString('latin1'),
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
    if (child.exitCode !== null)
      throw new Error(`core exited with ${child.exitCode} before it was ready:\n${handle.output()}`);
    try {
      if ((await fetch(`${handle.baseUrl}/health`)).ok) return handle;
    } catch {
      // Not listening yet.
    }
    await sleep(250);
  }
  await handle.stop();
  throw new Error(`core was not ready after ${maxPolls} polls:\n${handle.output()}`);
}

interface CliRun {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/** Runs `pnpm core-api canary ...` the way an operator does, as its own process. */
async function runCli(args: string[]): Promise<CliRun> {
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/sync-api/main.ts', 'canary', ...args], {
    cwd: CORE_DIRECTORY,
    env: { ...inheritedEnvironment(), ADMIN_TOKEN, CORE_URL: core.baseUrl },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (piece: Buffer) => out.push(piece));
  child.stderr.on('data', (piece: Buffer) => err.push(piece));
  const exitCode = await new Promise<number | null>((resolve) => child.once('close', (code) => resolve(code)));
  return {
    exitCode,
    stdout: Buffer.concat(out).toString('utf8'),
    stderr: Buffer.concat(err).toString('utf8'),
  };
}

function parseJson(text: string): JsonValue {
  // SAFETY: `JSON.parse` yields a JSON value, which is what `JsonValue` names; callers narrow it with `asObject` and friends.
  return JSON.parse(text) as JsonValue;
}

async function accountCount(): Promise<number> {
  const rows = await database.db.select({ id: accounts.id }).from(accounts).where(eq(accounts.email, ADDRESS));
  return rows.length;
}

/** The marker the CLI printed, as the hex of its first forms entry. */
function printedMarkerHex(report: JsonValue): string {
  const hex = asString(asObject(asObject(report)?.marker)?.hex);
  assert.ok(hex !== null && /^[0-9a-f]{32}$/.test(hex), 'the report holds a 16 byte hex marker');
  return hex;
}

before(async () => {
  database = await setupTestDatabase();
  upstream = await startUpstream();
  core = await startCore(upstream.baseUrl);
});

after(async () => {
  await core?.stop();
  await upstream?.close();
  await database?.close();
});

beforeEach(async () => {
  upstream.status = 200;
  upstream.received.length = 0;
  await database.reset();
});

test('the canary mints, signs up, sends one marked photograph, prints the marker forms and deletes the account', async () => {
  const run = await runCli(['--email', ADDRESS]);
  assert.equal(run.exitCode, 0, `stderr: ${run.stderr}\nstdout: ${run.stdout}`);

  // JSON on stdout, whole.
  const report = parseJson(run.stdout);
  const scan = asObject(asObject(report)?.scan);
  assert.equal(asNumber(scan?.status), 200);
  const account = asObject(asObject(report)?.account);
  assert.equal(account?.deleted, true);
  assert.equal(account?.kept, false);
  assert.equal(asArray(asObject(asObject(report)?.marker)?.windows)?.length, 5);

  // 1. THE SCAN REACHED THE PROVIDER, with the printed marker inside the photograph.
  assert.equal(upstream.received.length, 1);
  const hex = printedMarkerHex(report);
  const body = parseJson(upstream.received[0] ?? '{}');
  const dataUri = /data:image\/png;base64,([A-Za-z0-9+/=]+)/.exec(JSON.stringify(body))?.[1] ?? '';
  const png = Buffer.from(dataUri, 'base64');
  assert.ok(png.includes(Buffer.from(hex, 'hex')), 'the photograph the provider received holds the printed marker');
  assert.equal(
    JSON.stringify(body).includes(hex),
    false,
    'the control: the hex is not in the JSON, only the bytes are in the PNG',
  );

  // 2. THE ACCOUNT IS GONE.
  assert.equal(await accountCount(), 0);

  // 3. NO SECRET IS PRINTED.
  const printed = `${run.stdout}\n${run.stderr}`;
  assert.equal(printed.includes(ADMIN_TOKEN), false);
  assert.equal(/\bsi_[A-Za-z0-9_-]{8,}/.test(printed), false, 'an invite token is in the output');
  // The control: the same search finds a token in a line that holds one.
  assert.equal(/\bsi_[A-Za-z0-9_-]{8,}/.test('invite si_abcdefghijklmnop'), true);
});

test('--keep leaves exactly one account, and says so', async () => {
  const run = await runCli(['--email', ADDRESS, '--keep']);
  assert.equal(run.exitCode, 0, run.stderr);
  const account = asObject(asObject(parseJson(run.stdout))?.account);
  assert.equal(account?.deleted, false);
  assert.equal(account?.kept, true);
  assert.equal(await accountCount(), 1);
});

test('a provider that fails makes the canary exit 1, still deletes the account and still prints the marker', async () => {
  upstream.status = 500;
  const run = await runCli(['--email', ADDRESS]);
  assert.equal(run.exitCode, 1);
  const report = parseJson(run.stdout);
  assert.notEqual(asNumber(asObject(asObject(report)?.scan)?.status), 200);
  assert.equal(await accountCount(), 0);
  assert.match(printedMarkerHex(report), /^[0-9a-f]{32}$/);
  assert.match(run.stderr, /did not answer 2xx/);
});

test('two runs print two different markers', async () => {
  const first = printedMarkerHex(parseJson((await runCli(['--email', ADDRESS])).stdout));
  const second = printedMarkerHex(parseJson((await runCli(['--email', ADDRESS])).stdout));
  assert.notEqual(first, second);
});

test('no --email is refused before anything is minted', async () => {
  const run = await runCli([]);
  assert.equal(run.exitCode, 1);
  assert.match(run.stderr, /--email/);
  assert.equal(upstream.received.length, 0);
  assert.equal(await accountCount(), 0);
});
