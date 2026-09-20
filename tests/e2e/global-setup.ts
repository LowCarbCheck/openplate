/**
 * What has to exist before a single page is opened.
 *
 * FOUR JOBS, in this order:
 *
 *  0. SAY WHICH PORTS THIS RUN TOOK. They are derived from this checkout's
 *     path (`env.ts`, ADR-0017), so they differ per worktree and nobody can
 *     read them off the source. A run that later refuses a port, or an
 *     operator looking at `ss -ltnp`, needs the three numbers in the log.
 *
 *  1. RESET THIS TIER'S FONTCONFIG CACHE. A run the harness kills for low
 *     memory can leave a truncated cache file that crashes every later run
 *     before a single page opens; see `font-cache.ts` for why and how.
 *
 *  2. STAND UP THE TWO FAKE SERVICES on the ports `playwright.config.ts` has
 *     already handed the app as `SYNC_SERVER_URL` and `FOOD_DB_API_URL`.
 *
 *  3. PUT ONE ACCOUNT ON IT. `push-activation` needs a device with a session,
 *     because `enablePush` asks the vault for an account before it asks the
 *     browser for permission. The invite is minted here, through the service's
 *     own test seam, and redeemed by a child process; see
 *     `create-fixture-account.ts` for why the redemption cannot run here.
 *
 * THE MISSING-BUILD REFUSAL IS NOT HERE. Playwright starts the `webServer`
 * before this file runs, so a check here would arrive after the production
 * server had already died on it; `playwright.config.ts` makes it at load time
 * instead.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { startFakeSyncService } from '../integration/fake-sync-service';
import {
  E2E_ACCOUNT_EMAIL,
  E2E_APP_PORT,
  E2E_FOOD_DB_PORT,
  E2E_INVITE_TOKEN_VAR,
  E2E_PORT_BASE_VAR,
  E2E_SYNC_PORT,
} from './env';
import { holdFakeFoodDb, holdFakeService } from './fake-service-handle';
import { startFakeFoodDb } from './fake-food-db';
import { resetFontconfigCache } from './font-cache';

/** The ceremony that redeems the invite, run under `tsx`. */
const REDEEM_SCRIPT = fileURLToPath(new URL('./create-fixture-account.ts', import.meta.url));

/**
 * Runs the redemption and rejects with its output when it fails.
 *
 * Rejects rather than returning a flag, because a setup that could not create
 * the account has nothing to hand the specs and the run must stop here, with
 * the child's own words, rather than three specs later with a sign-in failure.
 *
 * @param inviteToken - the one-shot invite the parent minted.
 */
async function redeemInvite(inviteToken: string): Promise<void> {
  await new Promise<void>((settle, fail) => {
    const child = spawn(process.execPath, ['--import', 'tsx', REDEEM_SCRIPT], {
      env: { ...process.env, [E2E_INVITE_TOKEN_VAR]: inviteToken },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('error', fail);
    child.on('close', (code) => {
      if (code === 0) settle();
      else fail(new Error(`the fixture account could not be created (exit ${code}):\n${output}`));
    });
  });
}

export default async function globalSetup(): Promise<void> {
  console.log(
    `browser tier ports: food database ${E2E_FOOD_DB_PORT}, sync ${E2E_SYNC_PORT}, app ${E2E_APP_PORT} ` +
      `(derived from this checkout's path; ${E2E_PORT_BASE_VAR} overrides them)`,
  );

  await resetFontconfigCache();

  const service = await startFakeSyncService({ port: E2E_SYNC_PORT });
  holdFakeService(service);

  // The published food and reference data the app reads through its own
  // server. On the port `playwright.config.ts` already handed it as
  // `FOOD_DB_API_URL`, for the same reason the sync one is named.
  holdFakeFoodDb(await startFakeFoodDb({ port: E2E_FOOD_DB_PORT }));

  await redeemInvite(service.createInvite({ email: E2E_ACCOUNT_EMAIL }));
}
