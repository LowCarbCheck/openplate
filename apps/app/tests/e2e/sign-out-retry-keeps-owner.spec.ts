/**
 * A managed sign-out whose erase failed, and the press that retries it
 * (ADR-0023, thread C's follow-up P8).
 *
 * ── The defect this file guards ──────────────────────────────────────────
 *
 * The device lock names the account whose diary it closes, and the erase names
 * the account whose baseline it takes. `defaultSignOutSteps` works that
 * account out from the open session when the steps are BUILT, and a sign-out
 * builds them on every press. After a failed erase the session is closed, so a
 * press that reads the session again finds nobody: its lock step then names
 * no one and its erase step is told no account. The dialog therefore reads the
 * account ONCE when it opens (`openedFor`) and hands it to every press as
 * `owner`.
 *
 * ── Honest scope: this may pass without the fix ──────────────────────────
 *
 * Two other guards cover for a null owner today. `lockDevice` never replaces a
 * named owner with nobody, and the erase takes EVERY baseline key it can list,
 * not only the owner's. So on a browser the retry is correct even when the
 * dialog passes nothing, and this check passes on the build before the fix.
 * It stays as a regression guard for the day either of those two changes, and
 * `account-switch.test.ts` / `sign-out-owner.test.ts` hold the unit side where
 * the null owner is observable (a storage that cannot list its keys).
 *
 * THE BREAK THAT SHOWS IT CAN FAIL: make the dialog capture a wrong account
 * (`accountId + 1000`) and the lock assertion below fails, because the owner
 * the dialog passes WINS over the session. That proves the lock this file
 * reads is the one the dialog's handoff wrote.
 *
 * ── What is real ─────────────────────────────────────────────────────────
 *
 * The production build as a managed instance, the tier's fake core server, the
 * fixture account's sign-in, the header menu, the dialog, the lock and the
 * erase. STUBBED: the account facts (`managed-core-stub.ts`), as in
 * `sign-out-managed.spec.ts`. The "second tab" is a second page that opens
 * `openplate-primary` and keeps the connection, as in
 * `sign-out-erase-blocked.spec.ts`.
 *
 * ── The controls ─────────────────────────────────────────────────────────
 *
 * - The baseline existed before the sign-out, so "no baseline after" is a
 *   reading and not a device that never wrote one.
 * - The lock is read after the FAILED attempt, while the erase has thrown, so
 *   "the lock stays when the erase fails" is a reading, and the same lock is
 *   gone after the retry that finished, so the two readings differ.
 * - After the finished retry the document's storage still holds the device id,
 *   so the empty answers for the lock and the baselines come from a storage
 *   the read can see into.
 *
 * @area sign-out
 */
import { expect, test, type Page } from '@playwright/test';
import { z } from 'zod';

import { E2E_ACCOUNT_EMAIL } from './env';
import { routeManagedCore, signInManaged, type ManagedCoreStub } from './managed-core-stub';
import { startManagedAppServer, type ManagedAppServer } from './managed-app-server';
import { NO_SUBSCRIPTION_VIEW } from './plans-stub';

test.use({ serviceWorkers: 'block' });

/** How long the managed server may take to boot. */
const BOOT_BUDGET_MS = 90_000;

/** One sign-in, two blocked erases (3 s each), a retry and the checks fit in this. */
const TEST_BUDGET_MS = 120_000;

/** How long the dialog may take to report a blocked erase: the erase's own 3 s bound, plus slack. */
const REPORT_TIMEOUT_MS = 8_000;

/** A document of this app's origin that is not the app, so nothing in it opens the diary but this spec. */
const HOLDER_PATH = '/robots.txt';

/** The name of the diary database, as `local-store/store.ts` names it. */
const PRIMARY_DB_NAME = 'openplate-primary';

/** The device lock's key, spelled here because the spec reads the browser's storage, not the app's modules. */
const DEVICE_LOCK_KEY = 'openplate.device-locked';

/** The prefix of the per-account baseline keys. */
const BASELINE_PREFIX = 'openplate.sync.state.v1:';

/** A key a sign-out and an erase leave alone, which is what makes the empty answers readings. */
const DEVICE_ID_KEY = 'openplate.sync.device-id';

/** The lock this build writes (ADR-0023): version 2, the account and its address. */
const ownedLockSchema = z.object({ v: z.literal(2), accountId: z.number().int(), email: z.string() });

/** A signed-in account on an instance that sells nothing, so no paywall stands in the way. */
const ACCOUNT_STUB: ManagedCoreStub = {
  trialScans: null,
  allowanceExpiresAt: null,
  dailyAiLimit: 20,
  invitesLeft: null,
  memberInvites: false,
  planView: NO_SUBSCRIPTION_VIEW,
  plans: false,
  displayName: null,
};

let server: ManagedAppServer;

test.beforeAll(async () => {
  test.setTimeout(BOOT_BUDGET_MS);
  server = await startManagedAppServer();
});

test.afterAll(async () => {
  await server.stop();
});

/** Opens the sign-out dialog through the header menu, the way a person on a phone does. */
async function openSignOutDialogFromTheMenu(page: Page): Promise<void> {
  await page.locator('header [data-slot="avatar-menu-trigger"]').click();
  await page
    .getByRole('menuitem')
    .filter({ has: page.locator('svg.lucide-log-out') })
    .click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
}

/** The dialog's confirm button: the last one in its footer, after Cancel. */
function confirmButton(page: Page) {
  return page.getByRole('alertdialog').locator('[data-slot="alert-dialog-footer"] button').last();
}

/** The dialog's error node: the `role="alert"` one, EMPTY until a failure. */
function errorLayer(page: Page) {
  return page.getByRole('alertdialog').locator('[data-slot="sign-out-error"]');
}

/** Waits for the failure to be ANNOUNCED: the alert node has the sentence in it. */
async function expectTheErrorToBeAnnounced(page: Page): Promise<void> {
  await expect(errorLayer(page)).toHaveText(/\S/, { timeout: REPORT_TIMEOUT_MS });
}

/**
 * A second page of this origin that opens the diary database and holds it,
 * with no `versionchange` handler, so a delete of that database is blocked.
 */
async function holdTheDiaryInASecondTab(page: Page): Promise<Page> {
  const second = await page.context().newPage();
  await second.goto(`${server.url}${HOLDER_PATH}`);
  await second.evaluate(
    (name) =>
      new Promise<void>((resolveOpen, rejectOpen) => {
        const open = indexedDB.open(name);
        open.addEventListener('error', () => rejectOpen(open.error));
        open.addEventListener('success', () => {
          // Kept on `window` so nothing collects the connection.
          Reflect.set(window, '__heldDiary', open.result);
          resolveOpen();
        });
      }),
    PRIMARY_DB_NAME,
  );
  return second;
}

/** Every `openplate.sync.state.v1:*` key this document's storage holds. */
async function baselineKeys(page: Page): Promise<string[]> {
  return page.evaluate((prefix) => Object.keys(localStorage).filter((key) => key.startsWith(prefix)), BASELINE_PREFIX);
}

/** The lock's stored value, or `null` when the device is not locked. */
async function readLockValue(page: Page): Promise<string | null> {
  return page.evaluate((key) => localStorage.getItem(key), DEVICE_LOCK_KEY);
}

/** The lock, parsed as the version 2 value that names its owner. Throws on any other shape, which is the point. */
async function readOwnedLock(page: Page): Promise<z.infer<typeof ownedLockSchema>> {
  const raw = await readLockValue(page);
  expect(raw, 'the device is not locked').not.toBeNull();
  return ownedLockSchema.parse(JSON.parse(raw ?? 'null'));
}

test('a retried sign-out keeps naming the account that signed out, and the finished erase leaves no lock and no baseline', async ({
  page,
}) => {
  test.setTimeout(TEST_BUDGET_MS);
  await routeManagedCore(page, ACCOUNT_STUB);
  await signInManaged(page, server.url);
  await page.goto(`${server.url}/diary`);
  await expect(page.locator('header [data-slot="avatar-menu-trigger"]')).toBeVisible({ timeout: 10_000 });

  // CONTROL, BEFORE: the device holds this account's baseline, so its absence
  // at the end is something the sign-out did. The id in the key is the id the
  // lock must name, read from a place the lock does not come from.
  await expect.poll(() => baselineKeys(page), { timeout: 20_000 }).toHaveLength(1);
  const [baselineKey] = await baselineKeys(page);
  const accountId = Number((baselineKey ?? '').slice(BASELINE_PREFIX.length));
  expect(Number.isSafeInteger(accountId), `the baseline key ${baselineKey} names no account`).toBe(true);
  expect(await readLockValue(page), 'the device was locked before anybody signed out').toBeNull();

  const second = await holdTheDiaryInASecondTab(page);
  await page.bringToFront();
  await openSignOutDialogFromTheMenu(page);
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByRole('checkbox')).toBeEnabled();
  await dialog.getByRole('checkbox').check();
  await confirmButton(page).click();

  // THE FAILED ATTEMPT: the error is announced, and the lock stays (the erase
  // never lifts it when it throws) and names the account that signed out.
  await expectTheErrorToBeAnnounced(page);
  const afterTheFailure = await readOwnedLock(page);
  expect(afterTheFailure.accountId, 'the lock names the account that signed out').toBe(accountId);
  expect(afterTheFailure.email, 'the lock names its address').toBe(E2E_ACCOUNT_EMAIL);

  // THE RETRY THAT WORKS: close the other tab, press again. The page leaves,
  // and in the NEW document the lock and every baseline are gone.
  await second.close();
  await expect(confirmButton(page)).toBeEnabled();
  // A DOCUMENT LOAD, not a URL: the page may already show `/welcome` by a
  // router navigation, and the retry is finished only when it leaves the
  // document (`sign-out-flow.ts`, `leaveTheApp`).
  await Promise.all([page.waitForEvent('load', { timeout: REPORT_TIMEOUT_MS }), confirmButton(page).click()]);
  expect(new URL(page.url()).pathname, 'a managed sign-out ends on the welcome screen').toBe('/welcome');

  expect(await readLockValue(page), 'the lock outlived a finished erase').toBeNull();
  expect(await baselineKeys(page), 'a baseline outlived the erase').toEqual([]);
  // CONTROL, AFTER: this document's storage is readable and still holds a key
  // the erase does not take, so the two empty answers above came from a storage
  // the reads can see into.
  expect(await page.evaluate((key) => localStorage.getItem(key), DEVICE_ID_KEY)).not.toBeNull();
});
