/**
 * The addresses and the fixture account the Playwright tier runs against.
 *
 * THEY ARE CONSTANTS RATHER THAN EPHEMERAL PORTS because `playwright.config.ts`
 * is evaluated before anything is listening: the app server is started by
 * Playwright's own `webServer` with `SYNC_SERVER_URL` already baked into its
 * command line, so the sync address has to be decided first and the fake
 * service has to be told to take it. `tests/integration/fake-sync-service.ts`
 * grew its `port` option for exactly this caller and for no other.
 *
 * The two ports are in the 52xx range so a dev server on 3000 and a seeded
 * instance on 3007 can both keep running while this tier does.
 */

/** Where the production app server listens for this tier. */
export const E2E_APP_PORT = 5299;

/** Where the fake sync service listens for this tier. */
export const E2E_SYNC_PORT = 5298;

/** The app's base URL, also `use.baseURL` and the `webServer` readiness probe. */
export const E2E_APP_URL = `http://127.0.0.1:${E2E_APP_PORT}`;

/** The sync service's base URL, handed to the app as `SYNC_SERVER_URL`. */
export const E2E_SYNC_SERVER_URL = `http://127.0.0.1:${E2E_SYNC_PORT}`;

/**
 * The fixture account, created once in `global-setup.ts`.
 *
 * An address in a reserved, undeliverable TLD (RFC 2606), like
 * `scripts/seed-test-account.ts` uses, so it is obviously fake at a glance.
 */
export const E2E_ACCOUNT_EMAIL = 'e2e@example.invalid';

/** The fixture account's password. It exists only inside this test tier. */
export const E2E_ACCOUNT_PASSPHRASE = 'seventeen purple lanterns drifting';

/**
 * The environment variable that carries the minted invite to
 * `create-fixture-account.ts`.
 *
 * Named here rather than in either end of the handover, so the setter and the
 * reader cannot drift apart.
 */
export const E2E_INVITE_TOKEN_VAR = 'OPENPLATE_E2E_INVITE_TOKEN';
