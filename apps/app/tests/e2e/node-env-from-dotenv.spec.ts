/**
 * A server whose `NODE_ENV=production` lives only in `.env` serves its pages
 * (pre-release install rehearsal, wave 3).
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * A novice followed `docs/self-hosting.md`, "Without Docker", word for word:
 * `NODE_ENV=production` in `.env`, and a systemd unit that runs
 * `node --import tsx ./server.ts`. Every page answered 500 with
 * `TypeError: dispatcher.getOwner is not a function`. `server.ts` imported
 * `dotenv/config` SECOND, after `@react-router/express`, and modules run in
 * import order. So `react` had already picked its development build from an
 * unset `NODE_ENV` when `.env` arrived, and the server bundle, loaded later,
 * took the production `react-dom`. `pnpm start`, the Docker image and this
 * tier's own server all set `NODE_ENV` in the process itself, which is why
 * nothing here saw it.
 *
 * ── What this boots ──────────────────────────────────────────────────────
 *
 * The unit's own command, `node --import tsx ./server.ts`, from the checkout,
 * over the build the hook has just made, with `NODE_ENV` REMOVED from the
 * process environment and written only into a `.env` file. dotenv is pointed
 * at a temporary one through `DOTENV_CONFIG_PATH`, so a developer's own `.env`
 * in the checkout is neither read nor touched.
 *
 * ── Why `/` and not `/healthcheck` ───────────────────────────────────────
 *
 * `/healthcheck` is a resource route that renders no React, so it answered 200
 * in the broken state too. That is how the documented `curl` check passed on
 * a server that could not show a single page. It is only the readiness probe
 * here.
 *
 * ── Why the second test ──────────────────────────────────────────────────
 *
 * A `.env` that was never read would leave the server in development, where
 * `/` also answers 200, and the first test would pass while testing nothing.
 * The Content-Security-Policy header is set only when `CONFIG.app.isProduction`,
 * so its presence proves the file's `NODE_ENV` reached the process.
 *
 * ── The control ──────────────────────────────────────────────────────────
 *
 * With `import 'dotenv/config'` moved back below `@react-router/express` in
 * `server.ts`, the first test fails: `/` answers 500 and the server output it
 * prints carries `dispatcher.getOwner is not a function`.
 *
 * @area shell
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

import { E2E_FOOD_DB_URL } from './env';
import { pickFreePort, stopChild } from './managed-app-server';
import { buildManagedServerEnv } from './server-env';

/** The checkout root, where `server.ts` and the build live. The unit's `WorkingDirectory`. */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** How long the `beforeAll` may take, boot included. */
const BOOT_BUDGET_MS = 90_000;

/** How long the server has to answer its readiness probe. */
const BOOT_TIMEOUT_MS = 60_000;

/** How often the readiness probe asks. */
const PROBE_INTERVAL_MS = 250;

/** How much of the server's output a failure message quotes, from the end. */
const OUTPUT_TAIL_CHARS = 4_000;

/** The one line the `.env` file holds. Everything else reaches the server through its process environment. */
const DOTENV_CONTENT = 'NODE_ENV=production\n';

let child: ChildProcess | undefined;
let appUrl = '';
let dotenvDir = '';
let serverOutput = '';

/** The end of what the server has printed, for a failure message. */
function outputTail(): string {
  return serverOutput.slice(-OUTPUT_TAIL_CHARS);
}

/** The inherited environment with `NODE_ENV` taken out, so only the `.env` file can set it. */
function withoutNodeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const copy = { ...env };
  delete copy.NODE_ENV;
  return copy;
}

/** Whether `/healthcheck` answers 200 yet. A refused connection is "not yet". */
async function isHealthy(): Promise<boolean> {
  try {
    const response = await fetch(`${appUrl}/healthcheck`);
    return response.ok;
  } catch {
    return false;
  }
}

/** Waits for the readiness probe, or throws with the server's output. */
async function waitUntilHealthy(server: ChildProcess): Promise<void> {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`the server exited with code ${server.exitCode} before it answered:\n${outputTail()}`);
    }
    if (await isHealthy()) return;
    await new Promise((settle) => setTimeout(settle, PROBE_INTERVAL_MS));
  }
  throw new Error(`the server did not answer ${appUrl}/healthcheck within ${BOOT_TIMEOUT_MS} ms:\n${outputTail()}`);
}

test.beforeAll(async () => {
  test.setTimeout(BOOT_BUDGET_MS);
  dotenvDir = await mkdtemp(join(tmpdir(), 'openplate-dotenv-'));
  const dotenvPath = join(dotenvDir, '.env');
  await writeFile(dotenvPath, DOTENV_CONTENT);

  const port = await pickFreePort();
  appUrl = `http://127.0.0.1:${port}`;
  const env = buildManagedServerEnv({
    inherited: withoutNodeEnv(process.env),
    values: {
      PORT: String(port),
      HOST: '127.0.0.1',
      APP_URL: appUrl,
      DOTENV_CONFIG_PATH: dotenvPath,
      FOOD_DB_API_URL: E2E_FOOD_DB_URL,
    },
  });
  // The premise of the whole spec. If a later edit passes NODE_ENV in again,
  // this fails rather than letting the process mask the import order.
  expect(env.NODE_ENV, 'NODE_ENV must reach the server only through .env').toBeUndefined();

  const server = spawn(process.execPath, ['--import', 'tsx', './server.ts'], {
    cwd: REPO_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child = server;
  const collect = (chunk: Buffer): void => {
    serverOutput = (serverOutput + chunk.toString('utf8')).slice(-OUTPUT_TAIL_CHARS * 2);
  };
  server.stdout.on('data', collect);
  server.stderr.on('data', collect);

  try {
    await waitUntilHealthy(server);
  } catch (error) {
    await stopChild(server);
    throw error;
  }
});

test.afterAll(async () => {
  if (child !== undefined) await stopChild(child);
  if (dotenvDir !== '') await rm(dotenvDir, { recursive: true, force: true });
});

test('a page answers 200 when NODE_ENV=production comes only from .env', async () => {
  const response = await fetch(`${appUrl}/`);

  expect(response.status, `GET / answered ${response.status}. The server printed:\n${outputTail()}`).toBe(200);
});

test('the server runs in production, so a 200 above is not a development server', async () => {
  const response = await fetch(`${appUrl}/healthcheck`);

  expect(
    response.headers.get('content-security-policy'),
    'no CSP header: the .env NODE_ENV never arrived',
  ).not.toBeNull();
});
