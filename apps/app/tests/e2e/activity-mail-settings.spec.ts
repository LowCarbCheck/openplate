/**
 * The reminder-email switch in Settings, Notifications (2026-11).
 *
 * WHAT THE PRODUCT RULE IS. A signed-in person can turn reminder emails on and
 * off from `/settings/notifications`. The switch is drawn where the instance
 * sends reminders (`instance.activityMail`) OR where the account already asked
 * for them, so a person can always withdraw even after the instance switched
 * the feature off. Each tap is one `PATCH /v1/auth/account` with the choice and
 * the UI language, and nothing else in the body. The language rides only with `true`: the core
 * answers a `language` beside `false` with a 400, so the off body is the choice alone.
 *
 * WHICH PAGE. Notifications, not Account: reminders are mail the person
 * chooses to receive, which is what that page is for, and Account holds the
 * things that identify and protect it (name, password, deletion).
 *
 * WHAT IS REAL: the production build booted as a managed instance, the sign-in,
 * the page and the PATCH the switch makes, against the tier's fake core
 * server. WHAT IS STUBBED (`managed-core-stub.ts`): the handshake flag, the
 * account's choice, and the recording of the PATCH bodies.
 *
 * THE CONTROLS. "No switch" is read through the slot that finds the switch on
 * the instance that offers one. The two PATCH cases tap the same switch both
 * ways, so a page that always sent one value fails the other tap. The layout
 * case compares the tops of everything on the page before and after a tap.
 *
 * @area settings
 */
import { expect, test, type Page } from '@playwright/test';

import type { LanguageCode } from '../../app/i18n/language-prefs';
import { EN } from './copy';
import { headerStatusText, useLanguage } from './helpers';
import {
  installShiftObserver,
  movedBetween,
  readShiftEntries,
  readTops,
  settleFrames,
  shiftScoreAfter,
} from './layout-shift';
import { startManagedAppServer, type ManagedAppServer } from './managed-app-server';
import { routeManagedCore, signInManaged, type ManagedCoreStub } from './managed-core-stub';
import { NO_SUBSCRIPTION_VIEW } from './plans-stub';

test.use({ serviceWorkers: 'block' });

/** How long the managed server may take to boot. */
const BOOT_BUDGET_MS = 90_000;

/** A sign-in runs Argon2id at production cost. */
const SIGN_IN_BUDGET_MS = 90_000;

/** The slot the setting carries. */
const SETTING = '[data-slot="activity-mail-setting"]';

let server: ManagedAppServer;

test.beforeAll(async () => {
  test.setTimeout(BOOT_BUDGET_MS);
  server = await startManagedAppServer();
});

test.afterAll(async () => {
  await server.stop();
});

/** A signed-in account on a core whose reminder flag and account choice are the case's. */
function coreStub(options: { instanceOffers: boolean; accountOptedIn: boolean }): ManagedCoreStub {
  return {
    trialScans: null,
    allowanceExpiresAt: null,
    dailyAiLimit: 20,
    invitesLeft: 0,
    memberInvites: false,
    planView: NO_SUBSCRIPTION_VIEW,
    plans: false,
    activityMail: options.instanceOffers,
    accountActivityMail: options.accountOptedIn,
    activityMailWrites: [],
  };
}

/**
 * Signs in and opens the page. A language is set AFTER the sign-in, because the sign-in steps read
 * English words, and takes effect on the page load that follows.
 */
async function openNotifications(page: Page, options: { language?: LanguageCode } = {}): Promise<void> {
  await signInManaged(page, server.url);
  if (options.language !== undefined) await useLanguage(page, options.language);
  await loadNotifications(page);
}

/**
 * Loads the page and waits until the session has read the account again, which is what the switch's
 * rule waits for. WITHOUT THIS an "no switch" reading is taken before the account exists and passes
 * for any rule at all: the first version of the control case still passed with the rule replaced by
 * `return true`.
 */
async function loadNotifications(page: Page): Promise<void> {
  const accountRead = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/v1/auth/account' && response.request().method() === 'GET',
  );
  await page.goto(`${server.url}/settings/notifications`);
  await accountRead;
  await settleFrames(page);
}

/** The switch, found inside the setting's slot, so a case in another language finds it too. */
function reminderSwitch(page: Page) {
  return page.locator(SETTING).getByRole('switch');
}

test('an instance that offers reminders draws the switch, off, with its description', async ({ page }) => {
  test.setTimeout(SIGN_IN_BUDGET_MS);
  await routeManagedCore(page, coreStub({ instanceOffers: true, accountOptedIn: false }));
  await openNotifications(page);

  await expect(page.locator(SETTING)).toBeVisible();
  await expect(reminderSwitch(page)).not.toBeChecked();
  await expect(page.getByText(EN.activityMail.settings.description)).toBeVisible();
});

test('the switch PATCHes the choice and the language both ways, and follows what the service holds', async ({
  page,
}) => {
  test.setTimeout(SIGN_IN_BUDGET_MS);
  const stub = coreStub({ instanceOffers: true, accountOptedIn: false });
  await routeManagedCore(page, stub);
  await openNotifications(page, { language: 'fr' });

  const toggle = reminderSwitch(page);
  await expect(toggle).not.toBeChecked();

  await toggle.click();
  await expect(toggle).toBeChecked();
  expect(stub.activityMailWrites).toEqual([
    { route: 'patch', activityMail: true, language: 'fr', hasDisplayName: false },
  ]);

  // THE OFF TAP. The stub refuses a `language` beside `activityMail: false` with the core's 400, so
  // a switch that shows off here was answered 200, and the body is the choice alone. The response
  // is awaited, because the switch follows what the service holds and not what the tap asked for.
  const offResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/v1/auth/account' && response.request().method() === 'PATCH',
  );
  await toggle.click();
  expect((await offResponse).status()).toBe(200);
  await expect(toggle).not.toBeChecked();
  expect(stub.activityMailWrites).toEqual([
    { route: 'patch', activityMail: true, language: 'fr', hasDisplayName: false },
    { route: 'patch', activityMail: false, language: undefined, hasDisplayName: false },
  ]);
  expect(stub.accountActivityMail).toBe(false);
});

test('a tap says what happened in the header status', async ({ page }) => {
  test.setTimeout(SIGN_IN_BUDGET_MS);
  await routeManagedCore(page, coreStub({ instanceOffers: true, accountOptedIn: false }));
  await openNotifications(page);

  await reminderSwitch(page).click();
  await expect.poll(() => headerStatusText(page)).toContain(EN.activityMail.settings.toast.on);
});

test('control: an instance that offers nothing and an account that never asked draw no switch', async ({ page }) => {
  test.setTimeout(SIGN_IN_BUDGET_MS);
  await routeManagedCore(page, coreStub({ instanceOffers: false, accountOptedIn: false }));
  await openNotifications(page);

  // The page is drawn, so an absent switch is a reading and not a page that never loaded.
  await expect(page.locator('[data-slot="notifications-page"]')).toBeVisible();
  await expect(page.locator(SETTING)).toHaveCount(0);
  await expect(reminderSwitch(page)).toHaveCount(0);
});

test('an account that already asked keeps the switch when the instance switched the feature off, and can turn it off', async ({
  page,
}) => {
  test.setTimeout(SIGN_IN_BUDGET_MS);
  const stub = coreStub({ instanceOffers: false, accountOptedIn: true });
  await routeManagedCore(page, stub);
  await openNotifications(page);

  const toggle = reminderSwitch(page);
  await expect(toggle).toBeVisible();
  await expect(toggle).toBeChecked();

  await toggle.click();
  // STILL THERE, and off: the rule that drew it said yes, and the person's own no must not take it away.
  await expect(toggle).toBeVisible();
  await expect(toggle).not.toBeChecked();
  expect(stub.activityMailWrites?.map((write) => write.activityMail)).toEqual([false]);

  // The latch is the visit's, not the account's: a fresh load asks the rule again and draws nothing.
  await loadNotifications(page);
  await expect(page.locator('[data-slot="notifications-page"]')).toBeVisible();
  await expect(page.locator(SETTING)).toHaveCount(0);
});

test('tapping the switch moves nothing on the page', async ({ page }) => {
  test.setTimeout(SIGN_IN_BUDGET_MS);
  await installShiftObserver(page);
  await routeManagedCore(page, coreStub({ instanceOffers: true, accountOptedIn: false }));
  await openNotifications(page);
  await expect(reminderSwitch(page)).toBeVisible();
  await settleFrames(page);

  const topsBefore = await readTops(page);
  const shiftsBefore = (await readShiftEntries(page)).length;
  expect(Object.keys(topsBefore).length, 'the reading found nothing to compare').toBeGreaterThan(2);

  await reminderSwitch(page).click();
  await expect(reminderSwitch(page)).toBeChecked();
  await expect.poll(() => headerStatusText(page)).not.toBe('');
  await settleFrames(page);

  expect(movedBetween(topsBefore, await readTops(page))).toEqual([]);
  expect(shiftScoreAfter(await readShiftEntries(page), shiftsBefore)).toBe(0);
});
