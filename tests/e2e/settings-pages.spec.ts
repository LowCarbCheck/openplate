/**
 * Every destination the settings hub offers, opened.
 *
 * THE HUB IS A LIST OF PROMISES. Each row is a link, and a row whose page
 * 404s, throws on mount or renders no title is a dead end a person only finds
 * by tapping it. The rows are read off the rendered markup rather than
 * transcribed, so a row added tomorrow is covered by this spec the day it
 * lands.
 *
 * THE SECOND ASSERTION IS THE M225 SHAPE. The hub is one inset list per
 * section (`rounded-2xl divide-y`), not a card per row, so the number of those
 * containers must equal the number of section headings. A regression to
 * per-row cards multiplies the first count and leaves the second alone.
 */
import { expect, test } from '@playwright/test';

import { completeOnboarding, expectPhoneLayout } from './helpers';

test('every settings row opens a titled page that still fits the phone', async ({ page }) => {
  await completeOnboarding(page);
  await page.goto('/settings');

  const eyebrows = page.locator('section > h2');
  const lists = page.locator('section > div.rounded-2xl');
  // The hub is a `clientLoader` over the device store, so the first paint is a
  // loading state. Counting without waiting counts that.
  await expect(lists.first()).toBeVisible();
  const eyebrowCount = await eyebrows.count();
  // NON-VACUITY: two counts of zero are equal, and would pass on a hub that
  // rendered nothing at all.
  expect(eyebrowCount, 'the hub must render several groups').toBeGreaterThan(1);
  expect(await lists.count(), 'one inset list per group, never one card per row').toBe(eyebrowCount);

  const destinations = await lists.locator('a[href]').evaluateAll((links) =>
    links.map((link) => link.getAttribute('href') ?? ''),
  );
  expect(destinations.length, 'the hub must offer several rows').toBeGreaterThan(3);

  for (const destination of destinations) {
    await page.goto(destination);
    const title = page.locator('h1').first();
    await expect(title, `${destination} must name itself`).toBeVisible();
    expect((await title.innerText()).trim(), `${destination} must name itself`).not.toBe('');
    await expectPhoneLayout(page);
  }
});

/**
 * The pages already converted to the hub's inset chrome (M225).
 *
 * FROZEN, and it grows. Each worker converting a page adds it here in the same
 * change, so this spec covers what has actually landed instead of asserting a
 * shape nobody built yet.
 */
const CONVERTED_PAGES = [
  '/settings/about',
  '/settings/account',
  '/settings/ai',
  '/settings/data',
  '/settings/fasting',
  '/settings/life-phase',
  '/settings/notifications',
  '/settings/nutrition',
  '/settings/preferences',
  '/settings/profile',
  '/settings/research',
  '/settings/sharing',
];

test('a converted settings page wears the hub chrome and no card', async ({ page }) => {
  await completeOnboarding(page);

  for (const destination of CONVERTED_PAGES) {
    await page.goto(destination);
    const headings = page.locator('section > h2');
    const insets = page.locator('section > div.rounded-2xl');
    await expect(headings.first(), `${destination} must label its sections`).toBeVisible();
    await expect(insets.first(), `${destination} must draw an inset container`).toBeVisible();
    // THE CARD SIGNATURE. `ui/card`'s Card is the only thing in the app that
    // pairs a shadow with this radius, so one of these is a page that went
    // back to the desktop chrome.
    expect(await page.locator('.shadow-sm.rounded-2xl').count(), `${destination} still draws a Card`).toBe(0);
  }
});
