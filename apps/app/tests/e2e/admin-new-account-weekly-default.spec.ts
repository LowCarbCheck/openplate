/**
 * A new account on a weekly free default reads its weekly usage in /admin, and
 * never "No photos" (2026-10-12).
 *
 * ── THE REPORT ───────────────────────────────────────────────────────────
 *
 * On app.openplate.de the people list printed "No photos" in the used-today
 * column for new accounts, although every new account may read ten photos a
 * week (`DEFAULT_FREE_WEEKLY_AI_LIMIT=10`). The row holds `free_daily_ai_limit
 * = 0`, because the instance default is never written to it, and the core sent
 * only that column. The core now adds `effectiveFreeAiLimit` and
 * `effectiveFreeAiLimitPeriod` (`PROTOCOL.md` §5.20), the pair the proxy
 * enforces, and the console reads them.
 *
 * ── WHAT THIS PROVES ─────────────────────────────────────────────────────
 *
 * Against a stubbed core that sends the resolved pair, the new account's row
 * and its own page read "4 of 10 this week" (the week's count against the
 * weekly default, not today's 1), and neither carries the "no photos" line.
 * THE CONTROL is the same account from a core built before the fields: its row
 * and page read exactly that "no photos" line, and no weekly line. Both
 * sentences are read from the shipped English bundle, so no wording is
 * transcribed here, and the two are different strings, so neither assertion
 * can match the other's text.
 *
 * ── WHAT IT DOES NOT PROVE ───────────────────────────────────────────────
 *
 * That a real openplate-core resolves the default. The admin reads are routed
 * (`admin-console-stub.ts`); `apps/core/tests/unit/admin-effective-free-limit
 * .test.ts` proves the service side over the real router.
 *
 * @area admin
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test, type Locator, type Page } from '@playwright/test';
import { z } from 'zod';

import {
  WEEKLY_DEFAULT_LIMIT,
  WEEKLY_DEFAULT_PERSON_EMAIL,
  WEEKLY_DEFAULT_PERSON_ID,
  WEEKLY_DEFAULT_USED_THIS_WEEK,
  adminConsoleStub,
  routeAdminConsole,
  type AdminConsoleStub,
} from './admin-console-stub';
import { completeOnboarding, signInFixtureAccount } from './helpers';

// A cross-origin read the service worker made would never reach `page.route`.
test.use({ serviceWorkers: 'block' });

/** The strings this file reads, from the shipped English bundle. No sentence is transcribed here. */
const COPY = z
  .object({
    admin: z.object({ usageWeek: z.string(), usageNone: z.string() }),
  })
  .parse(JSON.parse(readFileSync(resolve(process.cwd(), 'app/i18n/locales/en/common.json'), 'utf8')));

/** The line the weekly default reads as: the week's count against the default. */
const WEEKLY_LINE = COPY.admin.usageWeek
  .replace('{{used}}', String(WEEKLY_DEFAULT_USED_THIS_WEEK))
  .replace('{{limit}}', String(WEEKLY_DEFAULT_LIMIT));

/** The new account's row in the people list, the link to its page. */
function newAccountRow(page: Page): Locator {
  return page.locator(`main a[href="/admin/people/${WEEKLY_DEFAULT_PERSON_ID}"]`);
}

/** Signs the device in as an administrator, through the real sign-in, with every admin request routed. */
async function signInAsAdministrator(page: Page, stub: AdminConsoleStub): Promise<void> {
  await routeAdminConsole(page, stub);
  await completeOnboarding(page);
  await signInFixtureAccount(page);
  expect(stub.selfId, 'the sign-in answer must have named the account').not.toBeNull();
}

/** Opens the people list and waits until the new account's row is drawn. */
async function openPeople(page: Page): Promise<void> {
  await page.goto('/admin');
  await expect(newAccountRow(page)).toBeVisible({ timeout: 15_000 });
  await expect(newAccountRow(page)).toContainText(WEEKLY_DEFAULT_PERSON_EMAIL);
}

test('a new account on a weekly default reads its week in the list and on its page, not "no photos"', async ({
  page,
}) => {
  const stub = adminConsoleStub();
  stub.weeklyDefault = 'resolved';
  await signInAsAdministrator(page, stub);

  await openPeople(page);
  await expect(newAccountRow(page).getByText(WEEKLY_LINE, { exact: true })).toBeVisible();
  await expect(newAccountRow(page).getByText(COPY.admin.usageNone, { exact: true })).toHaveCount(0);

  await newAccountRow(page).click();
  await expect(page).toHaveURL(new RegExp(`/admin/people/${WEEKLY_DEFAULT_PERSON_ID}$`));
  await expect(page.locator('main').getByText(WEEKLY_LINE, { exact: true })).toBeVisible();
  await expect(page.locator('main').getByText(COPY.admin.usageNone, { exact: true })).toHaveCount(0);
  expect(stub.unanswered).toEqual([]);
});

test('the same account from a core without the resolved fields reads "no photos", the control', async ({ page }) => {
  const stub = adminConsoleStub();
  stub.weeklyDefault = 'own-column-only';
  await signInAsAdministrator(page, stub);

  await openPeople(page);
  await expect(newAccountRow(page).getByText(COPY.admin.usageNone, { exact: true })).toBeVisible();
  await expect(newAccountRow(page).getByText(WEEKLY_LINE, { exact: true })).toHaveCount(0);

  await newAccountRow(page).click();
  await expect(page).toHaveURL(new RegExp(`/admin/people/${WEEKLY_DEFAULT_PERSON_ID}$`));
  await expect(page.locator('main').getByText(COPY.admin.usageNone, { exact: true })).toBeVisible();
  await expect(page.locator('main').getByText(WEEKLY_LINE, { exact: true })).toHaveCount(0);
  expect(stub.unanswered).toEqual([]);
});
