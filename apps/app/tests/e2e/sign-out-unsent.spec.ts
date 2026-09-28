/**
 * The sign-out dialog on a device whose last push did not go out.
 *
 * ── The defect this file encodes ─────────────────────────────────────────
 *
 * The dialog counted the retired log outbox, which nothing has written since
 * M117/03, so every device read as empty and the dialog said everything had
 * reached the server, directly above "Also erase the diary from this device".
 * A person on a train, whose push had just failed, was told the erase was safe.
 *
 * ── What is real here and what is stubbed ────────────────────────────────
 *
 * REAL: the device, onboarding, the fixture account, the sign-in, the diary
 * write through `/add`, the sync cycles against the fake service, the resume
 * after a reload, and the dialog on `/settings/account`.
 *
 * STUBBED: nothing. The only interference is `page.route` refusing the PUSH
 * (`POST .../blob`) for a while, which is what a dropped connection does to
 * the one request that matters. Pulls still go through, so the cycle fails at
 * exactly the step the defect is about.
 *
 * ── Why it reads data attributes and not sentences ───────────────────────
 *
 * The copy belongs to the wordsmith pass, and `copy.ts` belongs to another
 * session. The dialog marks each sentence it says with `data-erase-line`, so
 * this file asserts WHICH sentence was said. The controls are found by their
 * icons for the same reason.
 */
import { expect, test, type Page } from '@playwright/test';

import { SYNC_API_PREFIX } from '../../app/lib/sync/engine/protocol';
import { E2E_ACCOUNT_EMAIL, E2E_SYNC_SERVER_URL } from './env';
import { completeOnboarding, logFoodManually, signInFixtureAccount } from './helpers';

/** The entry the failed push leaves behind. */
const FOOD_NAME = 'Unsent smoke tier soup';

/** Where a push goes. A pull is a GET on the same path and is left alone. */
const BLOB_URL = `${E2E_SYNC_SERVER_URL}${SYNC_API_PREFIX}/blob`;

/**
 * How long the dialog may take to settle on an answer after the pushes are let
 * through: one resume, one boot cycle, and the debounced cycle the award
 * writes after it can schedule (3 s). A safety net, not a latency claim.
 */
const SETTLE_TIMEOUT_MS = 20_000;

/** Refuses every push until {@link allowPushes}, the way a dropped connection would. */
async function refusePushes(page: Page): Promise<void> {
  await page.route(BLOB_URL, (route) => (route.request().method() === 'POST' ? route.abort() : route.continue()));
}

async function allowPushes(page: Page): Promise<void> {
  await page.unroute(BLOB_URL);
}

/**
 * `/settings/account` on a document load, once the session has been restored
 * from the device. The account's address is printed only once it has, which
 * is how this knows (`push-activation.spec.ts` waits the same way).
 */
async function openAccountSettings(page: Page): Promise<void> {
  await page.goto('/settings/account');
  await expect(page.getByText(E2E_ACCOUNT_EMAIL).first()).toBeVisible();
}

/** Opens the sign-out dialog through the settings page's own trigger, the button with the sign-out icon. */
async function openSignOutDialog(page: Page): Promise<void> {
  await page.locator('button:has(svg.lucide-log-out)').first().click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
}

/** One named sentence of the dialog's erase notice. */
function noticeLine(page: Page, kind: string) {
  return page.locator(`[data-slot="erase-notice"] [data-erase-line="${kind}"]`);
}

test('a change the push did not carry is named before the erase box, and the all-clear waits for the push', async ({
  page,
}) => {
  await completeOnboarding(page);
  await signInFixtureAccount(page);

  await refusePushes(page);
  await logFoodManually(page, { name: FOOD_NAME, grams: '250' });

  // A document load while the pushes are still refused: the boot cycle runs,
  // pulls, and fails at the push, which is the device the defect is about.
  await openAccountSettings(page);
  await openSignOutDialog(page);

  const unsent = noticeLine(page, 'unsent-changes');
  await expect(unsent).toBeVisible();
  expect(Number(await unsent.getAttribute('data-count')), 'at least the entry itself').toBeGreaterThanOrEqual(1);
  // THE DEFECT, stated as state: no all-clear above the erase box.
  await expect(noticeLine(page, 'all-sent')).toHaveCount(0);

  // CONTROL: once a push goes through, the same dialog gives the all-clear.
  // Without it, a dialog that never gave one would pass everything above.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await allowPushes(page);
  await openAccountSettings(page);
  await openSignOutDialog(page);

  await expect(noticeLine(page, 'all-sent')).toBeVisible({ timeout: SETTLE_TIMEOUT_MS });
  await expect(noticeLine(page, 'unsent-changes')).toHaveCount(0);
});
