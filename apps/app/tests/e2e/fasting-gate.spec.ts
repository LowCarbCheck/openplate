/**
 * A plan without fasting closes the start of a fast, and nothing else (M2/05).
 *
 * THE WALK. A device that has been through onboarding records one fast, signs
 * in to an account whose plan does NOT include fasting, and opens `/fasting`
 * from inside the app. The start card is replaced by the closed-feature note
 * (the lock mark, the feature's name and the way to the plan page), and the
 * fast the device already recorded is still in the history. Nothing on the
 * page moves while it settles.
 *
 * WHAT IS REAL: the production build, the sign-in against the tier's fake core
 * server, the fasting screen and its store. WHAT IS STUBBED: the handshake's
 * `plans: true`, the plan reads, and the account's effective feature list on
 * every auth answer (`plans-stub.ts`).
 *
 * WHY THE FAST IS RECORDED BEFORE SIGN-IN. With no account there is no plan to
 * lack a feature, so the first fast is started on an open screen, exactly as a
 * person who signed up later would have done. That is also the history the
 * closed screen must keep.
 *
 * THE CONTROLS, one input each, against the same walk:
 *  - `capabilities: null` (everything allowed): the start button is there;
 *  - a list that names fasting: the start button is there;
 *  - the plans door off, with the list that closes it: the start button is there.
 * Each asserts the button, so each fails if the gate ever closes it.
 *
 * @area diary-and-add
 */
import { expect, test, type Page } from '@playwright/test';

import { EN } from './copy';
import { completeOnboarding, openFromMoreSheet, signInFixtureAccount } from './helpers';
import { installShiftObserver, readShiftEntries, settleFrames, shiftScoreAfter } from './layout-shift';
import { NO_SUBSCRIPTION_VIEW, routeAccountAllowance, routePlansCore, FIXTURE_OFFER_BODY } from './plans-stub';

test.use({ serviceWorkers: 'block' });

/** The closed-feature note for fasting. */
function closedNote(page: Page) {
  return page.locator('[data-slot="closed-feature"][data-feature="fasting"]');
}

/** The button that starts a fast. */
function startButton(page: Page) {
  return page.getByRole('button', { name: EN.fasting.plan.submitNow, exact: true });
}

/** One row of the history. */
function historyRows(page: Page) {
  return page.locator('[data-slot="fast-history-row"]');
}

/** What the stubbed account says about its plan and what the instance says about selling one. */
interface Setup {
  capabilities: readonly string[] | null | undefined;
  hasPlansDoor: boolean;
}

/** Routes the instance and the account the way a spec names them. */
async function routeInstance(page: Page, { capabilities, hasPlansDoor }: Setup): Promise<void> {
  await routePlansCore(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody: FIXTURE_OFFER_BODY, plans: hasPlansDoor });
  await routeAccountAllowance(page, { dailyAiLimit: 20, allowanceExpiresAt: null, capabilities });
}

/**
 * Records one finished fast on a device with no account, through the real
 * screen, and leaves it in the history.
 */
async function recordOneFinishedFast(page: Page): Promise<void> {
  await page.goto('/fasting');
  await startButton(page).click();
  await page.getByRole('button', { name: EN.fasting.active.end, exact: true }).click();
  await page.getByRole('button', { name: EN.fasting.end.confirm, exact: true }).click();
  await expect(historyRows(page).first()).toBeVisible();
}

/**
 * Waits until the history holds at least one fast. The fixture account is
 * shared by every spec in a run and its diary is synced, so an earlier spec's
 * fasts may be in the list too: the claim is "the fast recorded here is not
 * lost", never "it is the only one".
 */
async function expectHistoryKept(page: Page): Promise<void> {
  await expect(historyRows(page).first()).toBeVisible();
}

/** Signs in and opens the fasting screen from inside the app. */
async function signInAndOpenFasting(page: Page): Promise<void> {
  await signInFixtureAccount(page);
  await openFromMoreSheet(page, EN.nav.fasting);
  await page.waitForURL('**/fasting');
}

test.beforeEach(async ({ page }) => {
  await installShiftObserver(page);
});

test('a plan without fasting shows the note in place of the start card, keeps the history and moves nothing', async ({
  page,
}) => {
  await routeInstance(page, { capabilities: ['pantry'], hasPlansDoor: true });
  await completeOnboarding(page);
  await recordOneFinishedFast(page);
  await signInAndOpenFasting(page);

  const note = closedNote(page);
  await expect(note).toBeVisible();
  await expect(note).toContainText(EN.featureGate.names.fasting);
  await expect(note.getByRole('link', { name: EN.featureGate.closed.plans })).toHaveAttribute('href', '/settings/plan');
  await expect(startButton(page)).toHaveCount(0);
  // WHAT STAYS: the history, with the fast recorded before the plan was known.
  await expectHistoryKept(page);
  await expect(page.getByText(EN.fasting.history.title)).toBeVisible();

  // NOTHING MOVES, AND NOTHING FLIPS. The reading starts when the note is on
  // screen, so a note that later turned into the form, or a card that grew,
  // would show here as a shift and as a button that appeared.
  const shiftsBefore = (await readShiftEntries(page)).length;
  await settleFrames(page);
  await expect(note).toBeVisible();
  await expect(startButton(page)).toHaveCount(0);
  expect(shiftScoreAfter(await readShiftEntries(page), shiftsBefore), 'layout-shift on the gated fasting screen').toBe(0);
});

test('the control: an account with no feature list (everything allowed) still gets the start button', async ({ page }) => {
  await routeInstance(page, { capabilities: null, hasPlansDoor: true });
  await completeOnboarding(page);
  await recordOneFinishedFast(page);
  await signInAndOpenFasting(page);

  await expect(startButton(page)).toBeVisible();
  await expect(closedNote(page)).toHaveCount(0);
  await expectHistoryKept(page);
});

test('the control: a list that names fasting gets the start button', async ({ page }) => {
  await routeInstance(page, { capabilities: ['fasting', 'pantry'], hasPlansDoor: true });
  await completeOnboarding(page);
  await signInAndOpenFasting(page);

  await expect(startButton(page)).toBeVisible();
  await expect(closedNote(page)).toHaveCount(0);
});

test('the control: with the plans door off, the list that closes it changes nothing', async ({ page }) => {
  await routeInstance(page, { capabilities: ['pantry'], hasPlansDoor: false });
  await completeOnboarding(page);
  await signInAndOpenFasting(page);

  await expect(startButton(page)).toBeVisible();
  await expect(closedNote(page)).toHaveCount(0);
});

test('a fast already running stays on screen and can be ended, and the dashboard strip is not drawn', async ({ page }) => {
  await routeInstance(page, { capabilities: ['pantry'], hasPlansDoor: true });
  await completeOnboarding(page);
  await page.goto('/fasting');
  await startButton(page).click();
  const endButton = page.getByRole('button', { name: EN.fasting.active.end, exact: true });
  await expect(endButton).toBeVisible();
  await signInFixtureAccount(page);

  // THE STRIP: with the plan closed it is not drawn on the dashboard. The
  // anchor is the next test, where the same page draws it.
  await openFromMoreSheet(page, EN.nav.dashboard);
  await page.waitForURL('**/dashboard');
  await expect(page.getByRole('heading', { level: 1 }).or(page.locator('main'))).toBeVisible();
  await settleFrames(page);
  await expect(page.locator('main').getByText(EN.fasting.strip.fasting, { exact: true })).toHaveCount(0);

  // THE FAST ITSELF: still there to be ended, never lost.
  await openFromMoreSheet(page, EN.nav.fasting);
  await page.waitForURL('**/fasting');
  await expect(closedNote(page)).toHaveCount(0);
  await expect(endButton).toBeVisible();
  const rowsBefore = await historyRows(page).count();
  await endButton.click();
  await page.getByRole('button', { name: EN.fasting.end.confirm, exact: true }).click();
  await expect.poll(() => historyRows(page).count(), { message: 'the ended fast never reached the history' }).toBeGreaterThan(rowsBefore);
  // ENDED, THE START IS CLOSED: the same screen now shows the note.
  await expect(closedNote(page)).toBeVisible();
});

test('the control: with everything allowed, the same running fast draws the dashboard strip', async ({ page }) => {
  await routeInstance(page, { capabilities: null, hasPlansDoor: true });
  await completeOnboarding(page);
  await page.goto('/fasting');
  await startButton(page).click();
  await expect(page.getByRole('button', { name: EN.fasting.active.end, exact: true })).toBeVisible();
  await signInFixtureAccount(page);

  await openFromMoreSheet(page, EN.nav.dashboard);
  await page.waitForURL('**/dashboard');
  await expect(page.locator('main').getByText(EN.fasting.strip.fasting, { exact: true })).toBeVisible();
});
