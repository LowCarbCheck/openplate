/**
 * A SECOND PRODUCTION SERVER, run as a managed instance, for the specs that
 * need the managed chrome (M250/09).
 *
 * ── Why a second server and not a rewritten page ─────────────────────────
 *
 * The tier's own server is an OPEN instance (`playwright.config.ts` sets no
 * `INSTANCE_MODE`), and the managed header only exists on a managed one: two
 * controls instead of one, and the words "sign in". The mode reaches the page
 * twice, in the server-rendered markup and in the streamed loader data the
 * client hydrates from, so rewriting either one in a route handler would
 * test a page no server ever sends. This boots the same build with the one
 * variable changed, which is what app.openplate.de runs.
 *
 * ── Why its port is picked at run time ───────────────────────────────────
 *
 * ADR-0017 derives the tier's three ports from the checkout path because
 * `playwright.config.ts` is evaluated in the runner AND in every worker, and a
 * free-port scan would answer differently in each. This server is started
 * from a spec's `beforeAll`, in ONE worker process, and nothing else needs to
 * know its address beforehand. So the kernel picks a free port, the spec reads
 * it back, and the triple ADR-0017 guards stays exactly three ports.
 *
 * It talks to the tier's fake sync service, which `global-setup.ts` has
 * already started, so its `/health` answers like a real one.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import { E2E_FOOD_DB_URL, E2E_SYNC_SERVER_URL } from './env';

/** The checkout root, where `server.ts` and the build live. */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The fixture legal pages, the same folder the tier's own server mounts. */
const CONTENT_DIR = fileURLToPath(new URL('../fixtures/content', import.meta.url));

/** How long the server has to answer its first request. The tier's own server gets the same. */
const BOOT_TIMEOUT_MS = 60_000;

/** How often the readiness probe asks. */
const PROBE_INTERVAL_MS = 250;

/** A TCP listener's address. A pipe or an unbound socket has no port and fails the parse. */
const tcpAddressSchema = z.object({ port: z.number().int().positive() });

/** A running managed server, and the way to stop it. */
export interface ManagedAppServer {
  /** Its base URL, `http://127.0.0.1:<port>`. */
  readonly url: string;
  /** Stops the process and waits for it to exit. */
  readonly stop: () => Promise<void>;
}

/** A port nothing on this host listens on right now, chosen by the kernel. */
async function pickFreePort(): Promise<number> {
  return new Promise((settle, fail) => {
    const probe = createServer();
    probe.once('error', fail);
    probe.listen(0, '127.0.0.1', () => {
      const parsed = tcpAddressSchema.safeParse(probe.address());
      if (!parsed.success) {
        probe.close();
        fail(new Error('the kernel gave no TCP port'));
        return;
      }
      probe.close(() => settle(parsed.data.port));
    });
  });
}

/** Whether the server answers `/` with a 200 yet. A refused connection is "not yet". */
async function isAnswering(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/`);
    return response.ok;
  } catch {
    return false;
  }
}

/** Waits for the first 200, or throws naming the deadline. */
async function waitUntilAnswering(options: { url: string; child: ChildProcess }): Promise<void> {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (options.child.exitCode !== null) {
      throw new Error(`the managed app server exited with code ${options.child.exitCode} before it answered`);
    }
    if (await isAnswering(options.url)) return;
    await new Promise((settle) => setTimeout(settle, PROBE_INTERVAL_MS));
  }
  throw new Error(`the managed app server did not answer ${options.url} within ${BOOT_TIMEOUT_MS} ms`);
}

/** Sends SIGTERM and waits for the exit. */
async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  await new Promise<void>((settle) => {
    child.once('exit', () => settle());
    child.kill('SIGTERM');
  });
}

/**
 * Boots the production build as a managed instance.
 *
 * @returns its URL and a stop function. Call `stop` in `afterAll`.
 * @throws when the server exits or stays silent past the boot deadline.
 */
export async function startManagedAppServer(): Promise<ManagedAppServer> {
  const port = await pickFreePort();
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['--import', 'tsx', './server.ts'], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      HOST: '127.0.0.1',
      APP_URL: url,
      SYNC_SERVER_URL: E2E_SYNC_SERVER_URL,
      INSTANCE_MODE: 'managed',
      CONTENT_DIR,
      FOOD_DB_API_URL: E2E_FOOD_DB_URL,
    },
    stdio: 'ignore',
  });
  try {
    await waitUntilAnswering({ url, child });
  } catch (error) {
    await stopChild(child);
    throw error;
  }
  return { url, stop: async () => stopChild(child) };
}
