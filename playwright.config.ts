/**
 * The smoke tier: five specs, one phone, one worker, against the PRODUCTION
 * server.
 *
 * ── Why production and not `pnpm dev` ────────────────────────────────────
 *
 * Two of this repo's recorded failures are invisible in dev. A `.server`
 * import only breaks the client build, and the service worker only registers
 * on a production origin. Driving `NODE_ENV=production tsx ./server.ts` over
 * the build the hook has just made is therefore the only configuration in
 * which these specs describe what a person will meet.
 *
 * It also means THIS TIER NEVER BUILDS. `globalSetup` refuses a run with no
 * `build/server/index.js` and names the step; `.githooks/pre-push` runs the
 * build immediately before it.
 *
 * ── Why it runs on the host ──────────────────────────────────────────────
 *
 * The `ts-dev` toolbox has no Chromium and cannot get one (eleven shared
 * libraries missing, no sudo inside it). So `pnpm test:e2e` is the one command
 * in this repo that must be run from the host shell. The pre-push hook says so
 * when the browser cannot be launched rather than skipping the stage.
 *
 * ── The viewport is the assertion ────────────────────────────────────────
 *
 * 390 x 844 is an iPhone-class phone and is the width every layout budget in
 * this app is written against (`the document is the scroll container`, the
 * header's fixed 64px). `expectPhoneLayout` in `helpers.ts` reads exactly
 * those two numbers back, so a regression that overflows the document shows up
 * as a failed spec rather than as a screenshot somebody has to look at.
 *
 * ── Two working trees can run this at the same time ──────────────────────
 *
 * The three ports below are not literals shared by every checkout any more.
 * `tests/e2e/env.ts` derives them from the real path of the checkout this file
 * belongs to, so a second worktree on the same host gets a different triple and
 * the two runs do not meet. `OPENPLATE_E2E_PORT_BASE` overrides the derivation
 * for the rare pair of paths that hash to the same slot. ADR-0017 records why a
 * hash beats a free-port scan here: this module is evaluated in the runner AND
 * in every worker, and a scan would answer differently in each one.
 *
 * ── The font configuration is stated, not inherited ──────────────────────
 *
 * Every budget above is a measurement in CSS pixels, and a measurement of
 * text is a measurement of a font. The browser carries its own fontconfig and
 * reads the HOST's `/etc/fonts/fonts.conf`, which is a file the host's package
 * manager changes without asking. `tests/e2e/fonts.conf` is the configuration
 * this tier uses instead, and that file records the breakage that made it
 * necessary.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

import { E2E_APP_PORT, E2E_APP_URL, E2E_FOOD_DB_URL, E2E_MATOMO_URL, E2E_SYNC_SERVER_URL } from './tests/e2e/env';

/** The build artefact the production server serves. */
const SERVER_BUNDLE = 'build/server/index.js';

/** The font configuration this tier renders in. See that file for why it exists. */
const FONTS_CONF = fileURLToPath(new URL('./tests/e2e/fonts.conf', import.meta.url));

// SET HERE, at module load, because this file is evaluated in the runner AND
// in every worker process, and a worker is what launches the browser. A
// `globalSetup` assignment would sit in the runner's environment only.
//
// It is skipped when the shell already names one, so a host with a working
// system configuration, or a person debugging one, keeps the last word.
process.env.FONTCONFIG_FILE ??= FONTS_CONF;

// REFUSED HERE, not in `globalSetup`. Playwright starts the `webServer` BEFORE
// the global setup runs, so a check down there arrives after the server has
// already died on the missing build, and what a reader gets is a module
// resolution stack instead of the one sentence that names the step.
if (!existsSync(SERVER_BUNDLE)) {
  throw new Error(`${SERVER_BUNDLE} is missing: run \`pnpm build\` before \`pnpm test:e2e\`.`);
}

/** How long one spec may take, end to end. */
const SPEC_TIMEOUT_MS = 30_000;

/** How long the production server has to answer its first request. */
const SERVER_BOOT_TIMEOUT_MS = 60_000;

export default defineConfig({
  testDir: './tests/e2e',
  // SERIAL, and it has to be: every spec drives one origin's IndexedDB and
  // localStorage, and the fixture account on the fake sync service is a single
  // shared row.
  fullyParallel: false,
  workers: 1,
  // NO RETRIES. A smoke tier that passes on the second attempt is a tier that
  // hides a race; this one is small enough to fix instead.
  retries: 0,
  reporter: 'list',
  timeout: SPEC_TIMEOUT_MS,
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  use: {
    baseURL: E2E_APP_URL,
  },
  projects: [
    {
      name: 'phone',
      use: {
        browserName: 'chromium',
        headless: true,
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command:
      `cross-env NODE_ENV=production PORT=${E2E_APP_PORT} HOST=127.0.0.1 ` +
      `APP_URL=${E2E_APP_URL} SYNC_SERVER_URL=${E2E_SYNC_SERVER_URL} ` +
      // THE FOOD DATABASE IS A FAKE IN THIS TIER (`tests/e2e/fake-food-db.ts`).
      // Left unset, the production server asks the real lowcarbcheck.org, so a
      // smoke tier would depend on somebody else's uptime and assert against
      // numbers this repository does not hold.
      `FOOD_DB_API_URL=${E2E_FOOD_DB_URL} ` +
      // ANALYTICS ARE ON IN THIS TIER, pointed at a loopback origin that
      // serves nothing (`E2E_MATOMO_URL`), so the plans funnel spec can read
      // the events off the wire. Every other spec loads no tracker, because
      // `matomo.js` 404s there. The consumer instance runs with analytics on,
      // so this is closer to production, not further from it.
      `MATOMO_URL=${E2E_MATOMO_URL} MATOMO_SITE_ID=1 tsx ./server.ts`,
    url: `${E2E_APP_URL}/`,
    // NEVER REUSE. A server left over from an earlier run is serving an earlier
    // build, which is the "you verified yesterday's build" failure.
    reuseExistingServer: false,
    timeout: SERVER_BOOT_TIMEOUT_MS,
  },
});
