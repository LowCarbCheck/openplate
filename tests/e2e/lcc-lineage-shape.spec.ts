/**
 * The shape ladder, measured on a real page (M243 spec 03).
 *
 * WHAT THE SOURCE GUARD CANNOT SEE. `tests/unit/radius-tiers.test.ts` proves no class string
 * under `app/` asks for 12 px or 16 px outside its allowlist. It cannot prove what a browser
 * DRAWS: a later rule, a `cn` merge that kept the wrong token, a caller override, or a Tailwind
 * class that was never emitted into the bundle all leave the source correct and the corner wrong.
 * So the four card-step surfaces and the dialog are read here as COMPUTED `border-radius`, on the
 * production build, at a phone width.
 *
 * FOUND BY THEIR SLOT, NEVER BY THEIR SHAPE. Every selector here is a `data-slot`. A spec that
 * found a card by `div.rounded-2xl.bg-card`, which three of them did until this pass, asks the
 * page to agree with a taste call and then quietly matches nothing the day the taste moves.
 *
 * ── THE READER IS SHOWN ABLE TO REPORT A NUMBER THAT IS NOT THE CARD'S ──
 * Every assertion below is "this equals 8". A reader that returned 8 for everything, or that
 * silently measured the wrong element, would pass all of them. Two things stop that: the dialog,
 * which is read by the SAME reader on the SAME page and must come back 16, and an injected probe
 * with a radius of its own, which must come back at exactly that. If either of those reads 8, the
 * reader is broken and the run fails.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

import { catalogFor } from './copy';
import { RADIUS_TIER_PX } from '../design-contract';
import { completeOnboarding, logFoodManually } from './helpers';

/** One food, so `/foods` has a saved row and `/add` has something to match. */
const SEEDED_FOOD = { name: 'Shape walk cheddar', grams: '40', carbs: '1.2' };

/** A radius no tier uses, so a probe drawn with it can never be mistaken for a real surface. */
const PROBE_RADIUS_PX = 7;

/**
 * The computed top-left radius of an element, in CSS pixels.
 *
 * COMPUTED, NOT A BOX. A rect read tells nothing about corners, and the dialog animates in with
 * `zoom-in-95`, so anything derived from its box mid-animation is 95 percent of the truth. The
 * used `border-radius` is the number the layout decided, before any transform.
 *
 * @param element - the element to measure.
 * @returns its top-left radius.
 */
async function radiusOf(element: Locator): Promise<number> {
  return element.evaluate((node) => Number.parseFloat(getComputedStyle(node).borderTopLeftRadius));
}

/**
 * Reads the first element carrying a slot, and fails with the slot's name if it is not drawn.
 *
 * @param page - the page to read.
 * @param slot - the `data-slot` value.
 * @returns its computed radius.
 */
async function radiusOfSlot(page: Page, slot: string): Promise<number> {
  const element = page.locator(`[data-slot="${slot}"]`).first();
  await expect(element, `${slot} must be on the page to be measured`).toBeVisible();
  return radiusOf(element);
}

/**
 * Every card on the page, by radius.
 *
 * NOT `.first()`. The first card on `/dashboard` is the screen's hero, which passes `rounded-2xl`
 * as an override and is allowed to: M243 spec 04 owns the hero surface. A check that read one card
 * would therefore read the one card that is deliberately different. Reading them all says
 * something better anyway: every card is on the card step except the single hero.
 *
 * @param page - the page to read.
 * @returns one radius per card, in document order.
 */
async function cardRadii(page: Page): Promise<number[]> {
  return page
    .locator('[data-slot="card"]')
    .evaluateAll((nodes) => nodes.map((node) => Number.parseFloat(getComputedStyle(node).borderTopLeftRadius)));
}

test('every card-step surface draws the card radius, and the dialog draws the sheet one', async ({ page }) => {
  await completeOnboarding(page);
  await logFoodManually(page, SEEDED_FOOD);

  // 1. Every card on the screen made of them. All on the card step but the one hero, which keeps
  // 16 px until M243 spec 04 takes the hero surface apart.
  await page.goto('/dashboard');
  await expect(page.locator('[data-slot="card"]').first(), 'the dashboard must draw its cards').toBeVisible();
  const radii = await cardRadii(page);
  expect(radii.length, 'a claim about every card needs several cards').toBeGreaterThan(2);
  expect(
    radii.filter((radius) => radius !== RADIUS_TIER_PX.card),
    'exactly one card may leave the card step, the screen hero, and only until spec 04',
  ).toEqual([RADIUS_TIER_PX.hero]);

  // 2. The settings inset group, which is a card with rows in it.
  await page.goto('/settings');
  expect(await radiusOfSlot(page, 'settings-inset'), 'a settings inset must draw the card step').toBe(
    RADIUS_TIER_PX.card,
  );

  // 3. The two list rows that used to draw their own shape. The query is in the URL so the row is
  // drawn without the search box's debounce, and the food is one this device saved, so nothing
  // depends on the food database answering.
  await page.goto(`/add?q=${encodeURIComponent(SEEDED_FOOD.name)}`);
  expect(await radiusOfSlot(page, 'search-result-row'), 'an /add result row must draw the card step').toBe(
    RADIUS_TIER_PX.card,
  );

  await page.goto('/foods');
  expect(await radiusOfSlot(page, 'custom-food-row'), 'a saved food row must draw the card step').toBe(
    RADIUS_TIER_PX.card,
  );

  // 4. THE CONTROL THAT COSTS NOTHING: the confirm dialog, read by the same function on the same
  // page, is one step above a card. If this came back 8 the four claims above would be worthless.
  await page
    .getByRole('button', { name: catalogFor('en').add.custom.removeAria.replace('{{name}}', SEEDED_FOOD.name) })
    .click();
  const dialog = page.locator('[data-slot="alert-dialog-content"]');
  await expect(dialog, 'the confirm panel must open').toBeVisible();
  expect(await radiusOf(dialog), 'a dialog must draw the sheet step, not the card step').toBe(RADIUS_TIER_PX.hero);
  expect(RADIUS_TIER_PX.hero, 'the two steps must differ, or the control proves nothing').not.toBe(
    RADIUS_TIER_PX.card,
  );
});

test('CONTROL: the same reader reports a radius that belongs to no tier', async ({ page }) => {
  await completeOnboarding(page);
  await page.goto('/dashboard');
  await expect(page.locator('[data-slot="card"]').first(), 'the page must have drawn its cards').toBeVisible();

  // An element with a radius of its own, given the card's slot, and an inline style so nothing
  // depends on a Tailwind class having reached the bundle. If `radiusOf` were returning a
  // constant, or reading the wrong node, this would come back 8 like everything above.
  await page.evaluate((radius) => {
    const probe = document.createElement('div');
    probe.id = 'radius-probe';
    probe.setAttribute('data-slot', 'radius-probe');
    probe.style.cssText = `position:fixed;top:0;left:0;width:40px;height:40px;background:#888;border-radius:${radius}px;z-index:9999`;
    document.body.append(probe);
  }, PROBE_RADIUS_PX);

  expect(await radiusOfSlot(page, 'radius-probe'), 'the reader must report the radius it is given').toBe(
    PROBE_RADIUS_PX,
  );
  expect(PROBE_RADIUS_PX, 'the probe must not sit on a tier, or it could pass by accident').not.toBe(
    RADIUS_TIER_PX.card,
  );

  // And the real cards beside it are unchanged, so the probe did not simply repaint the page. The
  // probe carries its own slot, never the card's, so it cannot be one of these.
  const radii = await cardRadii(page);
  expect(radii.includes(RADIUS_TIER_PX.card), 'the real cards must still read the card step').toBe(true);
  expect(radii.includes(PROBE_RADIUS_PX), 'the probe must not be counted as a card').toBe(false);
});
