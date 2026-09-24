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
 * section, not a card per row, so the number of those containers must equal the
 * number of section headings. A regression to per-row cards multiplies the
 * first count and leaves the second alone. The container is found by
 * `data-slot="settings-inset"`, never by its radius: it was `rounded-2xl` until
 * M243 spec 03 moved it to the ladder's card step, and a selector on a taste
 * call is a selector that matches nothing the day the taste changes.
 *
 * THE THIRD WALK IS EVERY LANGUAGE (M230). A machine translation can be
 * correct and still overflow a row, and only a render at the phone width sees
 * that. The walk is measured, never photographed: the document's
 * `scrollWidth` on every page. It was shown red once before it was trusted: an
 * unbreakable 46-character row title pushed the document to 433px. A per-row
 * `scrollHeight` check was tried and dropped: a settings row has `min-h-13`
 * and no height cap, and its status line's `line-clamp-2` is overridden by
 * the `block` beside it (`settings-section.tsx`), so a long sentence grows
 * the row instead of clipping and the check could not be made to fail.
 *
 * THE DEVICE MENU'S LANGUAGE STRIP THIS WALK ALSO USED TO MEASURE IS GONE
 * (M257): the picker left the menu for `/settings/preferences` alone, which
 * this walk already visits as one of the hub's destinations, and
 * `tests/e2e/menu-has-no-language.spec.ts` is its control now.
 */
import { expect, test } from '@playwright/test';

import { SUPPORTED_LANGUAGES } from '../../app/i18n/language-prefs';
import { completeOnboarding, expectPhoneLayout, useLanguage } from './helpers';

test('every settings row opens a titled page that still fits the phone', async ({ page }) => {
  await completeOnboarding(page);
  await page.goto('/settings');

  const eyebrows = page.locator('section > h2');
  const lists = page.locator('section > div[data-slot="settings-inset"]');
  // The hub is a `clientLoader` over the device store, so the first paint is a
  // loading state. Counting without waiting counts that.
  await expect(lists.first()).toBeVisible();
  const eyebrowCount = await eyebrows.count();
  // NON-VACUITY: two counts of zero are equal, and would pass on a hub that
  // rendered nothing at all.
  expect(eyebrowCount, 'the hub must render several groups').toBeGreaterThan(1);
  expect(await lists.count(), 'one inset list per group, never one card per row').toBe(eyebrowCount);

  const destinations = await lists
    .locator('a[href]')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
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
    const insets = page.locator('section > div[data-slot="settings-inset"]');
    await expect(headings.first(), `${destination} must label its sections`).toBeVisible();
    await expect(insets.first(), `${destination} must draw an inset container`).toBeVisible();
    // THE CARD SIGNATURE, and it is the slot. This counted `.shadow-sm.rounded-2xl`
    // until M243 spec 03, which moved Card to 8 px and would have left this
    // line reading zero for ever, on a page drawing as many cards as it liked.
    // A count of zero needs a reader shown able to count, so the positive
    // control below runs once, against a page that IS made of cards.
    expect(await page.locator('[data-slot="card"]').count(), `${destination} still draws a Card`).toBe(0);
  }

  // POSITIVE CONTROL. `/dashboard` is built out of cards, so the same selector
  // on the same page object must come back non-zero. Without this the check
  // above passes on a typo in the attribute, on a renamed slot, and on a Card
  // that stopped carrying one.
  await page.goto('/dashboard');
  await expect(page.locator('[data-slot="card"]').first(), 'the dashboard must draw a card').toBeVisible();
  expect(
    await page.locator('[data-slot="card"]').count(),
    'the control: the same selector must find the cards a card-built page draws',
  ).toBeGreaterThan(0);
});

/**
 * `/settings/ai` is the densest page in the app, and the reference prose on it
 * is now closed until somebody asks for it.
 *
 * WHAT WOULD GO RED WITHOUT THE FIX: the page used to draw the "why would I
 * want this" explainer and the "what if a scan fails" troubleshooting list as
 * ordinary `SettingsSection`s, always open, under the save button. There was no
 * `settings-disclosure` section on the page at all, so the first count below
 * read zero.
 *
 * WHY THE HEIGHT IS MEASURED AND NOT THE COUNT ALONE: two disclosures that
 * opened onto nothing would satisfy every count here. The document has to get
 * MEASURABLY taller when they open, or the page was not carrying the weight
 * this change claims to have moved.
 */
test('the AI settings page keeps its reference prose behind a disclosure', async ({ page }) => {
  await completeOnboarding(page);
  await page.goto('/settings/ai');

  const disclosures = page.locator('section[data-slot="settings-disclosure"]');
  // ANCHOR FIRST. The connect card is an ordinary section and is always drawn,
  // so seeing it proves the page is up before anything is counted as absent.
  await expect(page.locator('[data-slot="settings-inset"]').first()).toBeVisible();

  const headings = disclosures.locator('h2 button');
  await expect(headings, 'the explainer and the troubleshooting list are both disclosures').toHaveCount(2);
  await expect(
    disclosures.locator('[data-slot="settings-inset"]'),
    'a closed disclosure draws no box at all',
  ).toHaveCount(0);
  for (const state of await headings.evaluateAll((buttons) => buttons.map((b) => b.getAttribute('aria-expanded')))) {
    expect(state, 'a disclosure starts closed').toBe('false');
  }

  const closedHeight = await page.evaluate(() => document.documentElement.scrollHeight);

  await headings.nth(0).click();
  await headings.nth(1).click();
  await expect(disclosures.locator('[data-slot="settings-inset"]'), 'both boxes open').toHaveCount(2);

  // THE CONTROL. Radix animates the panel open, so the height is polled rather
  // than read once; the threshold is what several paragraphs of prose actually
  // cost, not a token pixel.
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollHeight), {
      message: 'the prose behind the disclosures must be worth hiding',
    })
    .toBeGreaterThan(closedHeight + 200);

  await expectPhoneLayout(page);
});

/**
 * ONE TEST PER LOCALE, not one test looping all six.
 *
 * Six locales times the settings hub's rows used to run inside a single test
 * with the default 30 s timeout, and it timed out on the last locale
 * (Turkish) under a loaded machine. The fix is not a longer timeout, it is a
 * smaller test: each locale now gets its own 30 s budget. The body is the
 * loop's body unchanged, one locale at a time, so every assertion and every
 * message below is the one the loop already ran.
 */
for (const locale of SUPPORTED_LANGUAGES) {
  test(`every settings page fits the phone in ${locale}`, async ({ page }) => {
    await completeOnboarding(page);

    await useLanguage(page, locale);
    await page.goto('/settings');
    expect(await page.locator('html').getAttribute('lang'), `${locale}: the document is in that language`).toBe(locale);

    const lists = page.locator('section > div[data-slot="settings-inset"]');
    await expect(lists.first()).toBeVisible();
    const destinations = await lists
      .locator('a[href]')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
    expect(destinations.length, `${locale}: the hub must offer several rows`).toBeGreaterThan(3);

    for (const destination of destinations) {
      await page.goto(destination);
      const title = page.locator('h1').first();
      await expect(title, `${locale}: ${destination} must name itself`).toBeVisible();
      await expectPhoneLayout(page);
    }
  });
}
