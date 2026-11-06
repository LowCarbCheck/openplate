/**
 * The reminder emails in the administration console (2026-11).
 *
 * WHAT THE PAGE DOES. `/admin/settings` carries a "Reminder emails" section
 * beside the reference values: one line of numbers (how many people asked, and
 * per kind how many went out and how many came back), and per kind a switch, a
 * day count with the core's bounds, and a button that sends one to the
 * administrator's own address. A core older than the feature answers the
 * settings read with a `404` and the page draws no section.
 *
 * WHAT IS REAL: the production build, the console, its client and the three
 * requests it makes. WHAT IS ROUTED (`admin-console-stub.ts`): the role and
 * every admin answer, with the reminder block played by `activityMail` there.
 * This tier has no `openplate-core`, so the bounds and the rate limit are the
 * stub's reading of the contract, and the service end is `openplate-core`'s
 * own suite.
 *
 * THE CONTROLS. "No section" is read on a core that says `404`, beside the
 * case where the same selector finds it. A refused day count is read next to
 * accepted ones at both bounds, so a form that refused everything fails. A
 * save is read for the exact body, which a save of the old values would not
 * match. The layout case reads the tops of everything on the page before, during
 * and after a test, and a status line without a box of its own would move them.
 *
 * @area admin
 */
import { expect, test, type Page } from '@playwright/test';

import {
  adminConsoleStub,
  routeAdminConsole,
  type ActivityMailAdminStub,
  type AdminConsoleStub,
} from './admin-console-stub';
import { EN } from './copy';
import { completeOnboarding, signInFixtureAccount } from './helpers';
import { createGate } from './plans-stub';
import {
  installShiftObserver,
  movedBetween,
  readShiftEntries,
  readTops,
  settleFrames,
  shiftScoreAfter,
} from './layout-shift';

// A cross-origin read the service worker made would never reach `page.route`.
test.use({ serviceWorkers: 'block' });

/** The section, found by the slot it carries. */
const SECTION = '[data-slot="admin-activity-mail"]';

/** One kind's box inside it. */
function kindBox(page: Page, kind: 'firstScan' | 'quiet') {
  return page.locator(`${SECTION} [data-slot="activity-mail-kind"][data-kind="${kind}"]`);
}

/** The reminder block as a core holds it before a case changes it. */
function reminderCore(): ActivityMailAdminStub {
  return {
    settings: { firstScan: { enabled: true, days: 7 }, quiet: { enabled: false, days: 30 } },
    stats: { optedIn: 41, firstScan: { sent: 17, cameBack: 5 }, quiet: { sent: 23, cameBack: 8 } },
    patches: [],
    tests: [],
  };
}

/** A console on a core with the reminders, or without when `activityMail` is `undefined`. */
async function openSettings(page: Page, activityMail: ActivityMailAdminStub | undefined): Promise<AdminConsoleStub> {
  const stub = adminConsoleStub();
  stub.activityMail = activityMail;
  await routeAdminConsole(page, stub);
  await completeOnboarding(page);
  await signInFixtureAccount(page);
  // WAIT FOR THE SETTINGS READ, answered or refused: a "no section" reading taken before it lands
  // passes for any page at all.
  const settingsRead = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/v1/admin/settings' && response.request().method() === 'GET',
  );
  await page.goto('/admin/settings');
  await settingsRead;
  await settleFrames(page);
  return stub;
}

test('the section loads the core values, the numbers and both kinds', async ({ page }) => {
  const stub = await openSettings(page, reminderCore());

  await expect(page.locator(SECTION)).toBeVisible();
  await expect(page.locator(`${SECTION} [data-slot="activity-mail-opted-in"]`)).toHaveText(
    EN.admin.activityMail.stats.optedIn.replace('{{optedIn}}', '41'),
  );

  const first = kindBox(page, 'firstScan');
  await expect(first.getByRole('switch', { name: EN.admin.activityMail.firstScan.title })).toBeChecked();
  await expect(first.getByLabel(EN.admin.activityMail.daysLabel)).toHaveValue('7');
  await expect(first.locator('[data-slot="activity-mail-kind-stats"]')).toHaveText(
    EN.admin.activityMail.stats.kind.replace('{{sent}}', '17').replace('{{cameBack}}', '5'),
  );

  const quiet = kindBox(page, 'quiet');
  await expect(quiet.getByRole('switch', { name: EN.admin.activityMail.quiet.title })).not.toBeChecked();
  await expect(quiet.getByLabel(EN.admin.activityMail.daysLabel)).toHaveValue('30');
  await expect(quiet.locator('[data-slot="activity-mail-kind-stats"]')).toHaveText(
    EN.admin.activityMail.stats.kind.replace('{{sent}}', '23').replace('{{cameBack}}', '8'),
  );
  expect(stub.unanswered, 'the console called a route this tier does not answer').toEqual([]);
});

test('control: a core older than the feature draws no reminder section, and the page still works', async ({ page }) => {
  const stub = await openSettings(page, undefined);

  // The reference-values card is drawn, so an absent section is a reading and not a page that failed.
  await expect(page.getByText(EN.admin.settings.title, { exact: true })).toBeVisible();
  await expect(page.locator(SECTION)).toHaveCount(0);
  expect(stub.unanswered).toEqual([]);
});

test('saving a change sends the reminder block and nothing about the reference values, then says so', async ({
  page,
}) => {
  const reminders = reminderCore();
  await openSettings(page, reminders);
  const first = kindBox(page, 'firstScan');
  const quiet = kindBox(page, 'quiet');
  await expect(first.getByLabel(EN.admin.activityMail.daysLabel)).toHaveValue('7');

  await first.getByLabel(EN.admin.activityMail.daysLabel).fill('14');
  await quiet.getByRole('switch', { name: EN.admin.activityMail.quiet.title }).click();
  await page.locator(SECTION).getByRole('button', { name: EN.admin.activityMail.save, exact: true }).click();

  await expect(page.locator(`${SECTION} [data-slot="activity-mail-save-status"]`)).toHaveText(
    EN.admin.activityMail.saved,
  );
  expect(reminders.patches).toEqual([
    { activityMail: { firstScan: { enabled: true, days: 14 }, quiet: { enabled: true, days: 30 } } },
  ]);
});

test('a day count outside the core bounds is refused in the page, at both ends of both kinds', async ({ page }) => {
  const reminders = reminderCore();
  await openSettings(page, reminders);
  const section = page.locator(SECTION);
  await expect(section).toBeVisible();

  const cases = [
    { kind: 'firstScan', tooLow: '2', tooHigh: '31', low: '3', high: '30' },
    { kind: 'quiet', tooLow: '6', tooHigh: '61', low: '7', high: '60' },
  ] as const;

  for (const { kind, tooLow, tooHigh, low, high } of cases) {
    const box = kindBox(page, kind);
    const days = box.getByLabel(EN.admin.activityMail.daysLabel);
    const error = box.locator('[data-slot="activity-mail-days-error"]');

    // THE CONTROLS FIRST: the bounds themselves are accepted, so the sentence is hidden.
    for (const accepted of [low, high]) {
      await days.fill(accepted);
      await expect(error, `${kind} ${accepted} must be accepted`).toBeHidden();
    }
    for (const refused of [tooLow, tooHigh, '', '7.5', 'abc']) {
      await days.fill(refused);
      await expect(error, `${kind} "${refused}" must be refused`).toBeVisible();
    }
    await days.fill(low);
  }

  // A refused count sends nothing, even with the other kind fine.
  await kindBox(page, 'quiet').getByLabel(EN.admin.activityMail.daysLabel).fill('61');
  await section.getByRole('button', { name: EN.admin.activityMail.save, exact: true }).click();
  await page.waitForTimeout(500);
  expect(reminders.patches, 'a save went out with a count the core would refuse').toEqual([]);

  // And the same click sends once the count is right.
  await kindBox(page, 'quiet').getByLabel(EN.admin.activityMail.daysLabel).fill('60');
  await section.getByRole('button', { name: EN.admin.activityMail.save, exact: true }).click();
  await expect.poll(() => reminders.patches.length).toBe(1);
});

test('the test button asks for the right kind and shows its status, then a rate limit', async ({ page }) => {
  const reminders = reminderCore();
  await openSettings(page, reminders);
  const first = kindBox(page, 'firstScan');
  const quiet = kindBox(page, 'quiet');
  const firstStatus = first.locator('[data-slot="activity-mail-test-status"]');
  const quietStatus = quiet.locator('[data-slot="activity-mail-test-status"]');
  await expect(firstStatus).toHaveText('');

  await first.getByRole('button', { name: EN.admin.activityMail.test.button }).click();
  await expect(firstStatus).toHaveText(EN.admin.activityMail.test.sent);
  await expect(quietStatus, 'one kind answered for the other').toHaveText('');
  expect(reminders.tests).toEqual(['first-scan']);

  reminders.testAnswer = 429;
  await quiet.getByRole('button', { name: EN.admin.activityMail.test.button }).click();
  await expect(quietStatus).toHaveText(EN.admin.activityMail.test.throttled);
  expect(reminders.tests).toEqual(['first-scan', 'quiet']);
});

test('the test status arrives into a box that was already there, and nothing moves', async ({ page }) => {
  const gate = createGate();
  const reminders = { ...reminderCore(), testGate: gate.promise };
  await installShiftObserver(page);
  await openSettings(page, reminders);
  const first = kindBox(page, 'firstScan');
  await expect(first.getByLabel(EN.admin.activityMail.daysLabel)).toBeVisible();
  await settleFrames(page);

  const before = await readTops(page);
  const shiftsBefore = (await readShiftEntries(page)).length;
  expect(Object.keys(before).length, 'the reading found nothing to compare').toBeGreaterThan(4);

  const status = first.locator('[data-slot="activity-mail-test-status"]');
  await first.getByRole('button', { name: EN.admin.activityMail.test.button }).click();
  // IN FLIGHT: the sending line is up and the answer is held.
  await expect(status).toHaveText(EN.admin.activityMail.test.sending);
  await settleFrames(page);
  const during = await readTops(page);
  expect(movedBetween(before, during), 'the sending line moved the page').toEqual([]);

  gate.open();
  await expect(status).toHaveText(EN.admin.activityMail.test.sent);
  await settleFrames(page);
  expect(movedBetween(before, await readTops(page)), 'the sent line moved the page').toEqual([]);
  expect(shiftScoreAfter(await readShiftEntries(page), shiftsBefore)).toBe(0);
});
