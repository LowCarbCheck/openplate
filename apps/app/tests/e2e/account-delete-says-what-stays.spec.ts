/**
 * The delete-account dialog says what stays and what happens to a plan (M3/01).
 *
 * THE DEFECT. The dialog said "Everything stored for you is removed and cannot be brought back."
 * For a person who pays on the hosted instance that is not true: a backup lives on for days, a
 * mail already sent stays where it went, the operator keeps what the law makes it keep, and a
 * paid subscription is ended at once with no refund. A person deciding to delete reads this one
 * dialog, so it says all of it.
 *
 * WHAT IS REAL: the production build on a managed instance with legal pages, the account page,
 * the dialog. WHAT IS STUBBED (`managed-core-stub.ts`): the handshake and the account facts. The
 * only fact that differs between the cases is `instance.plans`, the one signal the app reads for
 * "this instance sells a plan" (`hasPlansDoor`).
 *
 * NO WORDING IS PINNED. Every sentence is read from the shipped English catalog, and the old
 * sentence is the one thing asserted ABSENT. Non-English catalogs are not read here: the
 * translation pass owns them.
 *
 * THE CONTROLS. With the plan door off the subscription line is absent and the stays line is
 * still there, so "absent" is a reading and not a dialog that drew nothing. With the door on, the
 * line is present, which is the control for the case without it.
 *
 * NOTHING MOVES. The dialog is drawn once the handshake has answered, so the subscription line is
 * in the first paint when it applies. The distance from the title to the password field (below
 * both notes) is read right after the dialog opens and again after it settles, and it is the
 * same.
 *
 * @area settings
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { z } from 'zod';

import { E2E_ACCOUNT_EMAIL } from './env';
import { routeManagedCore, signInManaged, trialAccountStub, type ManagedCoreStub } from './managed-core-stub';
import { startManagedAppServer, type ManagedAppServer } from './managed-app-server';
import { settleAnimations, settleFrames } from './layout-shift';
import { MONTHLY_SUBSCRIBER_VIEW } from './plans-stub';

test.use({ serviceWorkers: 'block' });

/** How long the managed server may take to boot. */
const BOOT_BUDGET_MS = 90_000;

/** The strings this file reads, from the shipped English bundle. */
const COPY = z
  .object({
    account: z.object({
      delete: z.object({
        cta: z.string(),
        confirmTitle: z.string(),
        confirmBody: z.string(),
        stays: z.string(),
        staysWithNotice: z.string(),
        subscription: z.string(),
        passwordLabel: z.string(),
      }),
    }),
  })
  .parse(JSON.parse(readFileSync(resolve(process.cwd(), 'app/i18n/locales/en/common.json'), 'utf8')));

const DELETE = COPY.account.delete;

/** The words the privacy link must carry, read from the `<privacy>` run of the catalog line. */
const PRIVACY_LINK_TEXT = /<privacy>(.*?)<\/privacy>/.exec(DELETE.staysWithNotice)?.[1] ?? '';

/** The sentence the dialog used to open with. It must never come back. */
const OLD_CLAIM = 'Everything stored for';

let server: ManagedAppServer;

test.beforeAll(async () => {
  test.setTimeout(BOOT_BUDGET_MS);
  server = await startManagedAppServer();
});

test.afterAll(async () => {
  await server.stop();
});

/** A paid member, on an instance that does or does not sell a plan. */
function core({ plans }: { plans: boolean }): ManagedCoreStub {
  return {
    ...trialAccountStub(4),
    allowanceExpiresAt: '2030-01-01T00:00:00.000Z',
    invitesLeft: 2,
    invitesNeedAPlan: false,
    planView: MONTHLY_SUBSCRIBER_VIEW,
    plans,
  };
}

/** Signs in with the stub, opens the account page and opens the delete dialog. */
async function openDeleteDialog(page: Page, stub: ManagedCoreStub) {
  await routeManagedCore(page, stub);
  await signInManaged(page, server.url);
  await page.goto(`${server.url}/settings/account`);
  await expect(page.getByText(E2E_ACCOUNT_EMAIL).first()).toBeVisible();
  await page.getByRole('button', { name: DELETE.cta, exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Title to password field: the two boxes with both notes between them. */
async function readSpan(page: Page): Promise<number> {
  return page.evaluate(() => {
    const title = document.querySelector('[data-slot="alert-dialog-title"]');
    const field = document.querySelector('#account-delete-password');
    if (title === null || field === null) throw new Error('the dialog is missing its title or its field');
    return field.getBoundingClientRect().top - title.getBoundingClientRect().top;
  });
}

test('the dialog says some records can stay, links the privacy notice, and no longer says everything is removed', async ({
  page,
}) => {
  const dialog = await openDeleteDialog(page, core({ plans: true }));

  await expect(dialog.getByText(DELETE.confirmTitle)).toBeVisible();
  await expect(dialog.locator('[data-slot="delete-account-stays"]')).toContainText(DELETE.stays);
  const link = dialog.getByRole('link', { name: PRIVACY_LINK_TEXT, exact: true });
  await expect(link).toHaveAttribute('href', '/privacy');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(dialog).not.toContainText(OLD_CLAIM);
});

test('the dialog says a paid subscription ends now when the instance sells plans', async ({ page }) => {
  const dialog = await openDeleteDialog(page, core({ plans: true }));

  await expect(dialog.locator('[data-slot="delete-account-subscription"]')).toHaveText(DELETE.subscription);
});

test('control: with no plan door the subscription line is absent and the stays line is still there', async ({
  page,
}) => {
  const dialog = await openDeleteDialog(page, core({ plans: false }));

  await expect(dialog.locator('[data-slot="delete-account-stays"]')).toContainText(DELETE.stays);
  await expect(dialog.locator('[data-slot="delete-account-subscription"]')).toHaveCount(0);
  await expect(dialog).not.toContainText(DELETE.subscription);
});

test('the dialog moves nothing after it opens, with the subscription line in its first paint', async ({ page }) => {
  const dialog = await openDeleteDialog(page, core({ plans: true }));

  // The line is in the dialog the moment it is visible, with no wait of its own.
  await expect(dialog.locator('[data-slot="delete-account-subscription"]')).toBeVisible({ timeout: 1_000 });
  await settleAnimations(page);
  const first = await readSpan(page);
  await settleFrames(page);
  await page.waitForTimeout(500);
  expect(await readSpan(page)).toBe(first);
});

test('control: the span grows when the subscription line is planted, so the reading can see a shift', async ({
  page,
}) => {
  const dialog = await openDeleteDialog(page, core({ plans: false }));
  await settleAnimations(page);

  const before = await readSpan(page);

  await dialog.locator('[data-slot="delete-account-notes"]').evaluate((notes) => {
    const planted = document.createElement('p');
    planted.textContent = 'a planted line';
    notes.append(planted);
  });
  expect(await readSpan(page)).toBeGreaterThan(before);
});
