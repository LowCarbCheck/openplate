/**
 * What has to exist before a single page is opened.
 *
 * TWO JOBS, in this order:
 *
 *  1. STAND UP THE FAKE SYNC SERVICE on the port `playwright.config.ts` has
 *     already handed the app as `SYNC_SERVER_URL`.
 *
 *  2. PUT ONE ACCOUNT ON IT. `push-activation` needs a device with a session,
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
import { holdFakeService } from './fake-service-handle';
import { E2E_ACCOUNT_EMAIL, E2E_INVITE_TOKEN_VAR, E2E_SYNC_PORT } from './env';

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
  const service = await startFakeSyncService({ port: E2E_SYNC_PORT });
  holdFakeService(service);

  await redeemInvite(service.createInvite({ email: E2E_ACCOUNT_EMAIL }));
}
