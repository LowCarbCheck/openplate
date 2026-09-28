/**
 * Two screens that moved with no input at all (M253/11 item 2).
 *
 * The live ten-scan test measured a `layout-shift` of 0.107 on `/join` at about
 * 312 ms, the invite card, and 0.107 on `/settings/account` at about 429 ms, a
 * `SECTION`. Both are answers arriving after the first paint:
 *
 *  - `/join` centred its card vertically, so when the invite lookup answered
 *    and the small "reading" body became the form, the card grew both ways and
 *    its top moved up by half the growth;
 *  - `/settings/account` drew its cards before the instance handshake
 *    (`/health`) answered, and the handshake decides whether the invite card
 *    exists, so the invite card arrived between two sections and pushed every
 *    section below it down.
 *
 * Each check HOLDS the answer that arrives late, reads the page in the state a
 * slow network shows, lets the answer through, and requires a layout-shift
 * total of 0 across the whole load. Holding the answer is what makes this
 * deterministic: on a quiet host the answer may beat the first paint.
 *
 * THE CONTROL is the state before the fix: both checks failed with a total of
 * about 0.03 and 0.107 against the old layouts.
 */
import { expect, test, type Page } from '@playwright/test';

import { EN, fill } from './copy';
import { E2E_ACCOUNT_EMAIL, E2E_SYNC_SERVER_URL } from './env';
import {
  installShiftObserver,
  readShiftEntries,
  settleAnimations,
  settleFrames,
  shiftScoreAfter,
} from './layout-shift';
import { routeManagedCore, signInManaged, type ManagedCoreStub } from './managed-core-stub';
import { startManagedAppServer, type ManagedAppServer } from './managed-app-server';
import { createGate, MONTHLY_SUBSCRIBER_VIEW } from './plans-stub';

test.use({ serviceWorkers: 'block' });

/** How long the managed server may take to boot. */
const BOOT_BUDGET_MS = 90_000;

/** A paying member with invitations left, so the invite card is drawn once the handshake says member invites exist. */
const PAID_MEMBER: ManagedCoreStub = {
  trialScans: null,
  allowanceExpiresAt: '2030-01-01T00:00:00.000Z',
  dailyAiLimit: 20,
  invitesLeft: 2,
  invitesNeedAPlan: false,
  memberInvites: true,
  planView: MONTHLY_SUBSCRIBER_VIEW,
};

let server: ManagedAppServer;

test.beforeAll(async () => {
  test.setTimeout(BOOT_BUDGET_MS);
  server = await startManagedAppServer();
});

test.afterAll(async () => {
  await server.stop();
});

/** Every shift this document recorded, as one readable failure message and a total. */
async function shiftReport(page: Page): Promise<{ total: number; detail: string }> {
  const entries = await readShiftEntries(page);
  return {
    total: entries.reduce((sum, entry) => sum + entry.value, 0),
    detail: entries.map((entry) => `${entry.value.toFixed(4)}: ${entry.sources.join('; ')}`).join('\n'),
  };
}

test('the invite card does not move when the invitation is read', async ({ page }) => {
  await installShiftObserver(page);
  await routeManagedCore(page, PAID_MEMBER);
  const lookup = createGate();
  await page.route(`${E2E_SYNC_SERVER_URL}/v1/auth/invite-lookup`, async (route) => {
    await lookup.promise;
    await route.fulfill({
      json: { email: 'invited@example.invalid', displayName: null, expiresAt: '2030-01-01T00:00:00.000Z' },
    });
  });

  await page.goto(`${server.url}/join#server=${encodeURIComponent(E2E_SYNC_SERVER_URL)}&invite=si_noshiftnoshift0001`);
  await expect(page.getByText(EN.join.working)).toBeVisible();
  await settleAnimations(page);
  lookup.open();
  await expect(page.getByText(fill(EN.join.invitedAs, { email: 'invited@example.invalid' }))).toBeVisible();
  await settleFrames(page);

  const report = await shiftReport(page);
  expect(report.total, report.detail).toBe(0);
});

test('the account page does not move when the instance handshake answers', async ({ page }) => {
  await routeManagedCore(page, PAID_MEMBER);
  await signInManaged(page, server.url);

  const health = createGate();
  const held: ManagedCoreStub = { ...PAID_MEMBER, healthGate: health.promise };
  await page.unrouteAll({ behavior: 'wait' });
  await routeManagedCore(page, held);
  await installShiftObserver(page);
  await page.goto(`${server.url}/settings/account`);
  await expect(page.getByText(E2E_ACCOUNT_EMAIL).first()).toBeVisible();
  // FROM HERE, not from the navigation: the header's brand word swaps from
  // the fallback face to the web font on every document load (a shift of about
  // 0.0004 that the browser marks as after input), which is not this screen's
  // doing and not what the live test measured.
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await settleAnimations(page);
  const since = (await readShiftEntries(page)).length;
  health.open();
  await expect(page.getByText(EN.account.invites.title)).toBeVisible();
  await settleFrames(page);

  const entries = await readShiftEntries(page);
  const detail = entries
    .slice(since)
    .map((entry) => `${entry.value.toFixed(4)}: ${entry.sources.join('; ')}`)
    .join('\n');
  expect(shiftScoreAfter(entries, since), detail).toBe(0);
});
