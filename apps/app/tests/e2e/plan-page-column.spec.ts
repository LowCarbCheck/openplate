/**
 * The plan page of a cancelled monthly subscriber, as reported on a desktop
 * (operator report, 2026-09-23).
 *
 * THE REPORT. On a wide desktop, in German, a monthly subscriber who had
 * cancelled opened `/settings/plan` and found two things wrong:
 *
 * - The status card sat far to the right, x about 1100 to 1680, with empty
 *   space on its left, "unlike the other settings pages".
 * - "Dein Tarif ist bezahlt und aktiv." sat right above "Du hast gekündigt...",
 *   which reads as a contradiction.
 *
 * WHAT THIS TIER FOUND FOR THE FIRST. It does not reproduce as a difference
 * between pages. At 1960 px the plan page's column is 820 to 1396, the same as
 * `/settings/account`. At 2545 px it is 1113 to 1689, which is the reported
 * position, and every settings page is at exactly that position too: each one
 * centres a `max-w-xl` column in the main area. So the column is checked here,
 * at both widths, as a guard that the plan page stays in the column every
 * other settings page uses. The account page is the control: a reader that
 * could not see a column in the wrong place would read the two pages alike
 * whatever the plan page did, and the control run that moved the plan page's
 * column (`ml-auto` in place of `mx-auto`) failed this check.
 *
 * THE SECOND reproduced and is fixed: a plan set to stop now says it is paid
 * until the end date and does not renew.
 */
import { expect, test, type Page } from '@playwright/test';

import { catalogFor, fill } from './copy';
import { useLanguage } from './helpers';
import { FIXTURE_OFFER_BODY, MONTHLY_SUBSCRIBER_VIEW, openPlanPageSignedIn, routePlansCore } from './plans-stub';

/** The monthly subscriber of the report: paid up, and set to stop at the end of the month. */
const CANCELLED_MONTHLY_VIEW = { ...MONTHLY_SUBSCRIBER_VIEW, cancelAtPeriodEnd: true };

/** The German catalog, the language of the report. */
const DE = catalogFor('de');

/** A pixel of rounding either side still counts as the same edge. */
const EDGE_TOLERANCE_PX = 1;

/** The reported desktop, and the width at which the reported position was measured. */
const WIDTHS = [1960, 2545] as const;

/** The left edge and width of the first settings inset on the page. */
async function readColumn(page: Page): Promise<{ left: number; width: number }> {
  const inset = page.locator('main [data-slot="settings-inset"]').first();
  await expect(inset).toBeVisible();
  const box = await inset.boundingBox();
  if (box === null) throw new Error('the settings inset has no box');
  return { left: box.x, width: box.width };
}

/** The cancelled subscriber's plan page, in German. */
async function openCancelledPlanInGerman(page: Page): Promise<void> {
  await routePlansCore(page, { planView: CANCELLED_MONTHLY_VIEW, offerBody: FIXTURE_OFFER_BODY });
  await openPlanPageSignedIn(page);
  // The onboarding walk reads English, so the language changes on the plan
  // page itself, through a reload.
  await useLanguage(page, 'de');
  await page.reload();
  await expect(page.locator('[data-slot="plan-status-card"]')).toBeVisible();
}

for (const width of WIDTHS) {
  test.describe(`a ${width} px desktop`, () => {
    test.use({
      serviceWorkers: 'block',
      viewport: { width, height: 1000 },
      isMobile: false,
      hasTouch: false,
      deviceScaleFactor: 1,
    });

    test('draws the plan page in the same column as the account page', async ({ page }) => {
      await openCancelledPlanInGerman(page);
      const plan = await readColumn(page);

      await page.locator('main a[href="/settings"]').click();
      await page.locator('main a[href="/settings/account"]').click();
      await page.waitForURL('**/settings/account');
      const account = await readColumn(page);

      expect(Math.abs(plan.left - account.left), `plan ${plan.left} against account ${account.left}`).toBeLessThanOrEqual(
        EDGE_TOLERANCE_PX,
      );
      expect(Math.abs(plan.width - account.width)).toBeLessThanOrEqual(EDGE_TOLERANCE_PX);
    });
  });
}

test.describe('the status of a plan set to stop', () => {
  test.use({ serviceWorkers: 'block' });

  test('says it is paid until the end date and does not renew, never that it is running', async ({ page }) => {
    await openCancelledPlanInGerman(page);
    const card = page.locator('[data-slot="plan-status-card"]');
    const endDate = new Intl.DateTimeFormat('de', { dateStyle: 'long' }).format(
      new Date(CANCELLED_MONTHLY_VIEW.currentPeriodEnd),
    );

    await expect(card.getByText(fill(DE.plan.status.paidUntil, { date: endDate }))).toBeVisible();
    await expect(card.getByText(fill(DE.plan.endsOn, { date: endDate }))).toBeVisible();
    // THE REPORTED CONTRADICTION. The control is the same locator finding the
    // cancel notice above: the card is read, and this sentence is not in it.
    await expect(card.getByText(DE.plan.status.active, { exact: true })).toHaveCount(0);
  });
});
