/**
 * The section label, the card title and the wordmark, read off a real page (M243 spec 02).
 *
 * THREE CLAIMS, EACH ONE THE TEMPLATE TELL IT REPLACES.
 *
 * 1. NO UPPERCASE LABEL IS TEAL. A tracked teal micro-caps label over a serif card title, on
 *    every card, is the most reproduced generated-template signature there is. The label is
 *    grey now (`text-muted-foreground`), and teal is spent on the active nav item, the one
 *    primary action and links. The check reads the COMPUTED colour of every element whose
 *    class list mentions `uppercase` and compares it with the computed colour of a real
 *    `text-primary` probe, so it does not care how a label is built, only what colour it is.
 *
 * 2. A CARD TITLE IS 18 PX IN THE BODY FACE. It was Fraunces at 18 px, then Victor Mono at 16 px
 *    from M243 until 2026-09-21, when `lcc-lineage-hierarchy.spec.ts` began holding it on a device
 *    that has data.
 *
 * 3. THE WORDMARK IS THE ONE THIN THING. It is Victor Mono at weight 100 (2026-09-21, it was
 *    Fraunces before), the same face as the body, so the family can no longer tell it apart.
 *    Its weight can: nothing else in the app is that thin. A sweep of every outermost element on
 *    the screen whose computed weight is 100 must find only elements that read exactly
 *    "openplate", and a second sweep finds nothing at all that computes the retired serif.
 *    `tests/unit/wordmark-brand-role.test.ts` holds the same rule at the source; this is the read
 *    that sees a rule in a stylesheet or an inherited weight the source does not show.
 *
 * ── EVERY CHECK IS SHOWN ABLE TO FAIL ──
 * The colour check is not vacuous only if (a) the probe is really teal, (b) the screen really
 * has uppercase labels, and (c) the same reader, pointed at a deliberately teal uppercase
 * element it is handed, says so. All three are asserted. The diary needs a logged food first:
 * an empty diary draws no meal group and so no label at all, which would let the check pass on
 * nothing. The wordmark sweeps are likewise pointed at a forced-thin heading and a forced-serif
 * heading, which they must flag.
 *
 * A DIARY AND NOT AN EMPTY ONE. See above. The food is logged through the real manual form.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

import { CARD_TITLE_PX, RETIRED_SERIF, VICTOR_MONO, WORDMARK_WEIGHT, familyStartsWith } from '../design-contract';
import { completeOnboarding, logFoodManually } from './helpers';

/** The food the diary is given, so it draws a meal group and with it a section label. */
const DIARY_FOOD = { name: 'Smoke tier porridge', grams: '200', carbs: '10', mealType: 'breakfast' } as const;

/** Screens whose every uppercase label must be grey. */
const LABEL_ROUTES = ['/settings', '/diary'] as const;

/**
 * Screens that carry a default card title on a fresh device.
 *
 * A FRESH DEVICE ON PURPOSE, and the reason is worth knowing (M243 spec 05b). Walking these with
 * a logged food was tried and reaches `/trends`' three insights door cards, whose titles are a
 * deliberate `text-sm` override. `tests/design-contract.ts` allows a caller to override the size,
 * so those cards are not a violation and this claim is about the DEFAULT. The fresh device is
 * what keeps the two apart without this file having to guess which titles were overridden.
 */
const CARD_TITLE_ROUTES = ['/dashboard', '/trends', '/add/photo'] as const;

/**
 * Screens swept for the wordmark before onboarding: the landing page, where it is largest
 * and is the page's own heading, the welcome screen and a legal page, which both carry the
 * public header's logo. A device past onboarding is sent past the landing, so these run first.
 */
const PUBLIC_WORDMARK_ROUTES = ['/', '/welcome', '/terms'] as const;

/** Screens swept for the wordmark after onboarding. The header kicker is the wordmark on each. */
const PERSONAL_WORDMARK_ROUTES = ['/diary', '/dashboard', '/settings', '/trends'] as const;

/** What every thin element on a screen must read as. */
const WORDMARK_TEXT = 'openplate';

/** The lowest saturation and the hue band that make a colour "teal" for the probe control. */
const TEAL_HUE_MIN = 160;
const TEAL_HUE_MAX = 200;
const TEAL_SATURATION_FLOOR = 0.3;

/** What the page reported about its uppercase labels. */
interface LabelReading {
  /** The computed colour of a real `text-primary` element. */
  teal: string;
  /** The computed colour of a real `text-muted-foreground` element. */
  muted: string;
  /** Every element whose class mentions `uppercase`: its text and its computed colour. */
  labels: { text: string; color: string }[];
}

/**
 * The computed colour of a real element wearing `className`.
 *
 * @param page - a page on the production build.
 * @param className - the utility class to probe, such as `text-primary`.
 * @returns the computed `color`, as the browser writes it.
 */
async function colourOfClass(page: Page, className: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement('span');
    probe.className = name;
    probe.textContent = 'x';
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }, className);
}

/**
 * Reads the computed colour of every uppercase label, plus the two probes it is judged against.
 *
 * @param page - a page on the production build.
 * @returns the probes and the labels.
 */
async function readLabels(page: Page): Promise<LabelReading> {
  const labels = await page.evaluate(() =>
    [...document.querySelectorAll('[class*="uppercase"]')].map((element) => ({
      text: (element.textContent ?? '').trim().slice(0, 30),
      color: getComputedStyle(element).color,
    })),
  );
  return {
    teal: await colourOfClass(page, 'text-primary'),
    muted: await colourOfClass(page, 'text-muted-foreground'),
    labels,
  };
}

/**
 * Whether a computed `rgb(...)` colour is teal: hue 160 to 200 and clearly saturated.
 *
 * @param colour - a computed colour, `rgb(r, g, b)` or `rgba(r, g, b, a)`.
 * @returns true when the colour sits in the brand's hue band.
 */
function isTealColour(colour: string): boolean {
  const channels = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(colour);
  if (channels === null) return false;
  const [red, green, blue] = [channels[1], channels[2], channels[3]].map((value) => Number(value) / 255);
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const span = max - min;
  if (span === 0) return false;
  const lightness = (max + min) / 2;
  const saturation = span / (lightness > 0.5 ? 2 - max - min : max + min);
  const raw =
    max === red ? (green - blue) / span
    : max === green ? 2 + (blue - red) / span
    : 4 + (red - green) / span;
  const hue = (raw * 60 + 360) % 360;
  return saturation >= TEAL_SATURATION_FLOOR && hue >= TEAL_HUE_MIN && hue < TEAL_HUE_MAX;
}

/**
 * The labels whose colour is the probe's teal.
 *
 * @param reading - what the page reported.
 * @returns the offenders, by text.
 */
function tealLabels(reading: LabelReading): string[] {
  return reading.labels.filter((label) => label.color === reading.teal).map((label) => label.text);
}

for (const scheme of ['light', 'dark'] as const) {
  test(`no uppercase label is teal on /settings or on a diary with a meal in it, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await completeOnboarding(page);
    await logFoodManually(page, DIARY_FOOD);

    for (const route of LABEL_ROUTES) {
      await page.goto(route);
      await expect(page.locator('main').first(), `${route}: the screen is up`).toBeVisible();
      const where = `${route} ${scheme}`;

      // Poll until the screen has labels: they render after hydration.
      await expect
        .poll(async () => (await readLabels(page)).labels.length, { message: `${where}: the screen must draw at least one uppercase label` })
        .toBeGreaterThan(0);
      const reading = await readLabels(page);

      // CONTROL (a): the probe is really the brand teal, so "not equal to it" means something.
      expect(isTealColour(reading.teal), `${where}: the text-primary probe must be teal, got ${reading.teal}`).toBe(true);
      expect(isTealColour(reading.muted), `${where}: the muted probe must NOT be teal, got ${reading.muted}`).toBe(false);

      // CONTROL (b): the reader sees the real labels, and they are the grey ones.
      expect(
        reading.labels.some((label) => label.color === reading.muted),
        `${where}: at least one label must read as the muted grey, or the reader is not seeing the eyebrows`,
      ).toBe(true);

      // THE CLAIM.
      expect(tealLabels(reading), `${where}: an uppercase label is drawn in the brand teal`).toEqual([]);

      // CONTROL (c): the same reader catches a teal uppercase label when it is handed one.
      await page.evaluate(() => {
        const bad = document.createElement('p');
        bad.id = 'm243-teal-label-control';
        bad.className = 'text-xs font-semibold uppercase tracking-wide text-primary';
        bad.textContent = 'Injected teal label';
        document.body.append(bad);
      });
      const injected = tealLabels(await readLabels(page));
      expect(injected, `${where}: the reader must flag a teal uppercase label`).toContain('Injected teal label');
    }
  });
}

test(`a card title is ${CARD_TITLE_PX}px in Victor Mono, and the reader can say no`, async ({ page }) => {
  await completeOnboarding(page);

  let seen = 0;
  for (const route of CARD_TITLE_ROUTES) {
    await page.goto(route);
    await expect(page.locator('main').first(), `${route}: the screen is up`).toBeVisible();
    const titles = page.locator('[data-slot="card-title"]');
    await expect
      .poll(() => titles.count(), { message: `${route}: the screen must draw a card title` })
      .toBeGreaterThan(0);

    const read = await titles.evaluateAll((elements) =>
      elements.map((element) => ({
        text: (element.textContent ?? '').trim().slice(0, 24),
        family: getComputedStyle(element).fontFamily,
        size: getComputedStyle(element).fontSize,
      })),
    );
    seen += read.length;
    for (const title of read) {
      expect(title.family, `${route}: "${title.text}" must be in the body face`).toMatch(familyStartsWith(VICTOR_MONO));
      expect(title.size, `${route}: "${title.text}" must be ${CARD_TITLE_PX}px`).toBe(`${CARD_TITLE_PX}px`);
    }
  }
  expect(seen, 'the walk must have read at least one card title').toBeGreaterThan(0);

  // CONTROL: the same read, pointed at a title forced into the retired serif at the M243 size (16 px),
  // says no on both counts. A read that returned the body face for everything would pass
  // the walk above and prove nothing.
  await page.evaluate(
    ({ family }) => {
      const old = document.createElement('div');
      old.id = 'm243-old-card-title';
      old.dataset.slot = 'card-title';
      old.style.cssText = `font-family:${family};font-size:16px;`;
      old.textContent = 'Old card title';
      document.body.append(old);
    },
    { family: `"${RETIRED_SERIF}", serif` },
  );
  const forced = await page
    .locator('#m243-old-card-title')
    .evaluate((element) => ({ family: getComputedStyle(element).fontFamily, size: getComputedStyle(element).fontSize }));
  expect(forced.family, 'the control must be in the retired serif').not.toMatch(familyStartsWith(VICTOR_MONO));
  expect(forced.size, 'the control must be at the old size').not.toBe(`${CARD_TITLE_PX}px`);
});

/**
 * The text of every OUTERMOST element on the page whose computed weight is the wordmark's.
 *
 * Outermost, because the wordmark's own "open" span inherits the weight and reads "open", and it
 * is the whole word that must read as "openplate".
 *
 * @param page - a page on the production build.
 * @returns each thin element's trimmed text.
 */
async function thinTexts(page: Page): Promise<string[]> {
  return page.evaluate((weight) => {
    const isThin = (element: Element): boolean => getComputedStyle(element).fontWeight === weight;
    return [...document.body.querySelectorAll('*')]
      .filter((element) => isThin(element) && !(element.parentElement !== null && isThin(element.parentElement)))
      .map((element) => (element.textContent ?? '').trim());
  }, WORDMARK_WEIGHT);
}

/**
 * The text of every element on the page whose computed family is the retired serif.
 *
 * @param page - a page on the production build.
 * @returns each such element's trimmed text.
 */
async function retiredSerifTexts(page: Page): Promise<string[]> {
  return page.evaluate((family) => {
    // The browser quotes a family with a space and leaves a one-word family bare, so the
    // quotes are optional: `Fraunces, serif` is what it writes for this face.
    const opening = new RegExp(`^"?${family}"?(?:,|$)`, 'u');
    return [...document.body.querySelectorAll('*')]
      .filter((element) => opening.test(getComputedStyle(element).fontFamily))
      .map((element) => (element.textContent ?? '').trim());
  }, RETIRED_SERIF);
}

test('the wordmark is the one thin thing, the retired serif is nowhere, and the sweeps can say no', async ({ page }) => {
  // Before onboarding: the public screens.
  for (const route of PUBLIC_WORDMARK_ROUTES) {
    await page.goto(route);
    await expect(page.locator('a, button').first(), `${route}: the screen is up`).toBeVisible();
    expect(
      (await thinTexts(page)).filter((text) => text !== WORDMARK_TEXT),
      `${route}: something other than the word "${WORDMARK_TEXT}" is drawn in the wordmark's weight`,
    ).toEqual([]);
    expect(await retiredSerifTexts(page), `${route}: the retired serif is drawn`).toEqual([]);
  }

  // CONTROL (a): the sweep is not blind. On the landing page the wordmark is the page's own
  // heading, so the sweep must find it there.
  await page.goto('/');
  await expect(page.locator('h1').first()).toBeVisible();
  expect(await thinTexts(page), 'the landing heading is the wordmark').toContain(WORDMARK_TEXT);

  // After onboarding: the personal screens, each of which draws the header kicker.
  await completeOnboarding(page);
  for (const route of PERSONAL_WORDMARK_ROUTES) {
    await page.goto(route);
    await expect(page.locator('header h1').first(), `${route}: the screen is up`).toBeVisible();
    const texts = await thinTexts(page);
    expect(texts, `${route}: the header kicker is the wordmark, so the sweep must see it`).toContain(WORDMARK_TEXT);
    expect(
      texts.filter((text) => text !== WORDMARK_TEXT),
      `${route}: something other than the word "${WORDMARK_TEXT}" is drawn in the wordmark's weight`,
    ).toEqual([]);
    expect(await retiredSerifTexts(page), `${route}: the retired serif is drawn`).toEqual([]);
  }

  // CONTROL (b): each sweep flags a heading forced into what it hunts.
  await page.evaluate(
    ({ family }) => {
      const thin = document.createElement('h2');
      thin.textContent = 'A card title in the thin weight';
      thin.style.fontWeight = '100';
      document.body.append(thin);
      const serif = document.createElement('h2');
      serif.textContent = 'A card title in the retired serif';
      serif.style.fontFamily = `"${family}", serif`;
      document.body.append(serif);
    },
    { family: RETIRED_SERIF },
  );
  expect(await thinTexts(page), 'the weight sweep must flag a thin heading that is not the wordmark').toContain(
    'A card title in the thin weight',
  );
  expect(await retiredSerifTexts(page), 'the serif sweep must flag a heading in the retired serif').toContain(
    'A card title in the retired serif',
  );
});

/** The two computed properties the wordmark is told apart by, as an element reports them. */
interface ComputedFace {
  family: string;
  weight: string;
}

/** What `locator` computes for its family and its weight. */
function readFace(locator: Locator): Promise<ComputedFace> {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return { family: style.fontFamily, weight: style.fontWeight };
  });
}

test('the header page title is in the body face at a normal weight while the kicker above it is the thin wordmark', async ({ page }) => {
  await completeOnboarding(page);
  await page.goto('/diary');
  await expect(page.locator('header h1').first()).toBeVisible();

  const family = (selector: string): Promise<string> =>
    page
      .locator(selector)
      .first()
      .evaluate((element) => getComputedStyle(element).fontFamily);

  const title = page.locator('header h1').first();
  await expect.poll(() => family('header h1'), { message: 'the header title face' }).toMatch(familyStartsWith(VICTOR_MONO));
  expect((await readFace(title)).weight, 'the header title must not be the wordmark\'s weight').not.toBe(WORDMARK_WEIGHT);

  const kicker = page.locator('header').getByText(WORDMARK_TEXT, { exact: true }).first();
  await expect
    .poll(async () => (await readFace(kicker)).weight, { message: 'the header kicker weight' })
    .toBe(WORDMARK_WEIGHT);
  expect((await readFace(kicker)).family, 'the header kicker face').toMatch(familyStartsWith(VICTOR_MONO));
});
