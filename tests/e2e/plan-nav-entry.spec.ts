/**
 * The plan page has an entry in the navigation (owner, 2026-09-23).
 *
 * THE REPORT. "I'd expect there to be a menu item in the sidebar, and on
 * mobile a more prominent one, like above Einstellungen." The plan page was
 * reachable from the settings hub and from the offers only.
 *
 * WHAT IS CHECKED, and what makes each check able to fail:
 *
 * - On a desktop the sidebar draws the entry directly above Settings, and
 *   Settings does not move when it arrives. The entry is known only after the
 *   session and a fresh handshake, so `/health` is HELD while the "before"
 *   reading is taken, then let through. The control injects a 32 px box under
 *   Settings and requires the same readers to report a move and a shift, so a
 *   reader that could not see one fails there.
 * - On a phone the drawer draws it directly above Settings. An entry that
 *   arrives while the drawer is open waits for the next open, so nothing in an
 *   open drawer is pushed under a finger.
 * - On an instance whose handshake says `plans: false` there is no entry, at
 *   either size. The present cases are its control: the same walk, the same
 *   selector, one fact changed.
 * - Square corners on the entry, read off the computed style.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

import { EN } from './copy';
import { E2E_ACCOUNT_EMAIL } from './env';
import { completeOnboarding, signInFixtureAccount } from './helpers';
import { installShiftObserver, readShiftEntries, settleAnimations, shiftScoreAfter } from './layout-shift';
import { FIXTURE_OFFER_BODY, NO_SUBSCRIPTION_VIEW, createGate, routePlansCore, type PlansStub } from './plans-stub';

test.use({ serviceWorkers: 'block' });

const DESKTOP = { width: 1440, height: 900 } as const;

/** The height the control's injected box takes, larger than any rounding. */
const CONTROL_BOX_PX = 32;

/** The desktop sidebar, never the drawer. */
function sidebar(page: Page): Locator {
  return page.locator('[data-slot="sidebar-container"]');
}

/** The mobile drawer, open. */
function drawer(page: Page): Locator {
  return page.getByRole('dialog');
}

/** The two entries of one navigation this spec reads. */
interface NavEntries {
  plan: Locator;
  settings: Locator;
}

/** The plan entry and the settings entry inside one navigation. */
function entries(scope: Locator): NavEntries {
  return {
    plan: scope.locator('a[href="/settings/plan"]'),
    settings: scope.locator('a[href="/settings"]'),
  };
}

/** A signed-in device on the settings hub, with the stubbed biller routed. */
async function signedInOnSettings(page: Page, stub: PlansStub): Promise<void> {
  await routePlansCore(page, stub);
  await completeOnboarding(page);
  await signInFixtureAccount(page);
  await page.goto('/settings');
  await expect(page.getByText(E2E_ACCOUNT_EMAIL)).toBeVisible();
}

/**
 * A fresh document whose handshake has ANSWERED, so an absent entry is an
 * answer and not a read still in flight.
 */
async function reloadUntilHandshakeAnswered(page: Page): Promise<void> {
  const answered = page.waitForResponse((response) => response.url().endsWith('/health'));
  await page.reload();
  await answered;
  await expect(page.getByText(E2E_ACCOUNT_EMAIL)).toBeVisible();
  await settleAnimations(page);
}

/** The top of an element's box, which is what a person aims at. */
async function topOf(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('the element has no box');
  return box.y;
}

/** The anchor's own computed corner radius, all four. */
async function cornerRadii(locator: Locator): Promise<string[]> {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return [
      style.borderTopLeftRadius,
      style.borderTopRightRadius,
      style.borderBottomRightRadius,
      style.borderBottomLeftRadius,
    ];
  });
}

test.describe('on a desktop', () => {
  test.use({ viewport: DESKTOP, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });

  test('the sidebar draws the plan entry directly above Settings, and Settings does not move', async ({ page }) => {
    const stub: PlansStub = { planView: NO_SUBSCRIPTION_VIEW, offerBody: FIXTURE_OFFER_BODY };
    await installShiftObserver(page);
    await signedInOnSettings(page, stub);

    // THE BEFORE READING: a fresh document with the handshake held, so the
    // entry cannot be drawn yet. On the preferences page, which draws nothing
    // of its own from the handshake: the hub's own rows arrive with it, and
    // they are not what this reads.
    const health = createGate();
    stub.healthGate = health.promise;
    await page.goto('/settings/preferences');
    const { plan, settings } = entries(sidebar(page));
    await expect(settings).toBeVisible();
    await settleAnimations(page);
    await expect(plan).toHaveCount(0);
    const settingsTopBefore = await topOf(settings);
    const shiftsBefore = (await readShiftEntries(page)).length;

    health.open();
    await expect(plan).toBeVisible();
    await expect(plan).toHaveText(EN.nav.plan);
    await settleAnimations(page);

    expect(await topOf(settings), 'Settings moved when the plan entry arrived').toBe(settingsTopBefore);
    const shifts = await readShiftEntries(page);
    expect(shiftScoreAfter(shifts, shiftsBefore), JSON.stringify(shifts.slice(shiftsBefore))).toBe(0);

    // DIRECTLY ABOVE: the next link after the plan entry is Settings, and it
    // sits below it.
    const hrefs = await sidebar(page)
      .locator('a')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    expect(hrefs.indexOf('/settings')).toBe(hrefs.indexOf('/settings/plan') + 1);
    expect(await topOf(plan)).toBeLessThan(await topOf(settings));

    expect(await cornerRadii(plan)).toEqual(['0px', '0px', '0px', '0px']);

    // It is the plan page, and on it the plan entry is the one lit.
    await plan.click();
    await page.waitForURL('**/settings/plan');
    await expect(plan).toHaveAttribute('data-active', 'true');
    await expect(settings).not.toHaveAttribute('data-active', 'true');
  });

  test('CONTROL: a box pushed in under Settings is seen by both readers', async ({ page }) => {
    const stub: PlansStub = { planView: NO_SUBSCRIPTION_VIEW, offerBody: FIXTURE_OFFER_BODY };
    await installShiftObserver(page);
    await signedInOnSettings(page, stub);
    const { plan, settings } = entries(sidebar(page));
    await expect(plan).toBeVisible();
    await settleAnimations(page);
    const settingsTopBefore = await topOf(settings);
    const shiftsBefore = (await readShiftEntries(page)).length;

    // The footer is anchored to the bottom, so a box under Settings pushes it UP.
    await settings.evaluate((element, height) => {
      const box = document.createElement('div');
      box.style.height = `${height}px`;
      element.closest('ul')?.after(box);
    }, CONTROL_BOX_PX);
    await settleAnimations(page);

    expect(await topOf(settings)).toBeLessThan(settingsTopBefore - CONTROL_BOX_PX / 2);
    expect(shiftScoreAfter(await readShiftEntries(page), shiftsBefore)).toBeGreaterThan(0);
  });

  test('no entry on an instance that sells no plans', async ({ page }) => {
    await signedInOnSettings(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody: null, plans: false });
    await reloadUntilHandshakeAnswered(page);
    const { plan, settings } = entries(sidebar(page));
    await expect(settings).toBeVisible();
    await expect(plan).toHaveCount(0);
  });
});

test.describe('on a phone', () => {
  test('the drawer draws the plan entry directly above Settings', async ({ page }) => {
    await signedInOnSettings(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody: FIXTURE_OFFER_BODY });
    await expect(page.locator('main a[href="/settings/plan"]')).toBeVisible();

    await page.getByRole('button', { name: EN.chrome.logoMenuLabel }).click();
    const { plan, settings } = entries(drawer(page));
    await expect(plan).toBeVisible();
    await expect(plan).toHaveText(EN.nav.plan);
    // The very next link after the plan entry is Settings.
    const hrefs = await drawer(page)
      .locator('nav a')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    expect(hrefs.indexOf('/settings')).toBe(hrefs.indexOf('/settings/plan') + 1);
    expect(await topOf(plan)).toBeLessThan(await topOf(settings));
    expect(await cornerRadii(plan)).toEqual(['0px', '0px', '0px', '0px']);

    await plan.click();
    await page.waitForURL('**/settings/plan');
  });

  test('an entry that arrives while the drawer is open waits for the next open', async ({ page }) => {
    const stub: PlansStub = { planView: NO_SUBSCRIPTION_VIEW, offerBody: FIXTURE_OFFER_BODY };
    await signedInOnSettings(page, stub);
    const health = createGate();
    stub.healthGate = health.promise;
    await page.reload();

    await page.getByRole('button', { name: EN.chrome.logoMenuLabel }).click();
    const { plan, settings } = entries(drawer(page));
    await expect(settings).toBeVisible();
    await settleAnimations(page);
    await expect(plan).toHaveCount(0);
    const settingsTopBefore = await topOf(settings);

    health.open();
    // The hub's own row is the sign that the handshake has answered.
    await expect(page.locator('main a[href="/settings/plan"]')).toBeAttached();
    await settleAnimations(page);
    await expect(plan).toHaveCount(0);
    expect(await topOf(settings)).toBe(settingsTopBefore);

    // THE CONTROL: the next open draws it.
    await page.keyboard.press('Escape');
    await expect(drawer(page)).toHaveCount(0);
    await page.getByRole('button', { name: EN.chrome.logoMenuLabel }).click();
    await expect(plan).toBeVisible();
  });

  test('no entry on an instance that sells no plans', async ({ page }) => {
    await signedInOnSettings(page, { planView: NO_SUBSCRIPTION_VIEW, offerBody: null, plans: false });
    await reloadUntilHandshakeAnswered(page);
    await page.getByRole('button', { name: EN.chrome.logoMenuLabel }).click();
    const { plan, settings } = entries(drawer(page));
    await expect(settings).toBeVisible();
    await expect(plan).toHaveCount(0);
  });
});
