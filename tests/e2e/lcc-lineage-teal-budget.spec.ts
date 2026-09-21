/**
 * How many things on a screen are painted in the brand colour, counted (M243 spec 05b).
 *
 * WHY COUNT INSTEAD OF ARGUE. "Less teal" is a taste sentence, and a taste sentence loses every
 * argument with the next feature: one more teal icon is never the one that ruins the page. What
 * stops the creep is a NUMBER per screen, measured on the build that shipped and frozen as a
 * ceiling. LowCarbCheck spends its accent about three times on a page: the active tab, the one
 * primary action, and the links. openplate spends more, and the ceilings below say exactly how
 * much more, so the next feature has to argue against a figure rather than against an opinion.
 *
 * WHAT COUNTS AS TEAL. Not a class name: the `--primary` token is resolved IN THE PAGE by giving
 * a probe `color: hsl(var(--primary))` and reading the rgb back, so the check follows the token
 * through a theme change and through a brand-repository edit instead of pinning a literal. An
 * element is teal when its own computed text colour, its background colour, or a border it
 * actually draws resolves to those three channels at any alpha above zero. Alpha is READ, never
 * assumed: `border-primary/25` is a teal hairline a person sees, and it counts.
 *
 * THREE RULES KEEP THE COUNT FROM LYING:
 *
 * - TEXT COUNTS ONCE, at the element that holds the words. `color` inherits, so a `text-primary`
 *   card would otherwise count itself and all fourteen of its descendants. An element scores on
 *   colour only when it holds a direct non-empty text node, or when it IS an `svg`, because an
 *   icon drawn in `currentColor` is exactly the decorative teal this budget is about.
 * - A BORDER COUNTS ONLY WHERE IT IS DRAWN. A border colour is set on every element whether or
 *   not a border exists, so a side scores only with a width above zero and a style that paints.
 * - AN ELEMENT SCORES ONCE. Teal text inside a teal-bordered pill is one thing on the screen, not
 *   two, so the ceiling is a count of THINGS, and the inventory beside it names which aspect each
 *   one spends.
 *
 * WHAT IS NOT COUNTED, and deliberately: pseudo-element fills (`::before`, `::after`), and any
 * colour that needs a state to appear (hover, focus ring, selection). Those are not on the screen
 * when a person looks at it. A decorative `::before` wash would be a real gap; nothing draws one
 * today, and the inventory is printed on every run so a new one is visible to a reader.
 *
 * THE PAGE IS BLURRED BEFORE IT IS READ, for one reason worth knowing: `--ring` and `--primary`
 * are the SAME hsl triple in both themes, so a focused field's `border-ring` is indistinguishable
 * from a teal border by any reader that works in resolved colours. `/add` puts the cursor in its
 * search box on arrival, which added a phantom entry to that screen's inventory. A focus ring is
 * a state, and states are out of scope here, so the read starts by blurring whatever holds focus.
 *
 * VISIBILITY IS THE BROWSER'S ANSWER, not three property reads. The global progress bar keeps a
 * solid teal block in the DOM at all times and hides it by putting `opacity: 0` on its PARENT, so
 * an element that checks only its own three properties counts a bar nobody can see, on every
 * screen. `checkVisibility` asks the browser, which walks the ancestors.
 *
 * THE CONTROL INJECTS ONE. Each ceiling is the number the screen measured, exactly, so adding a
 * single teal element must break it. The control does that on `/settings` and requires the reader
 * to report one more and the ceiling to be exceeded, which is the only thing that separates this
 * spec from one whose reader silently returns zero.
 */
import { expect, test, type Page } from '@playwright/test';

import { TEAL_BUDGET_CEILING, type TealBudgetScreen } from '../design-contract';
import { completeOnboarding, logFoodManually } from './helpers';

/** The design width. One width: this is a colour count, and colour does not reflow. */
const PHONE_WIDTH = 390;
const PHONE_HEIGHT = 844;

/** One food, so the diary and the dashboard paint a day rather than an empty state. */
const SEEDED_FOOD = { name: 'Teal budget cheddar', grams: '40', carbs: '1.2' } as const;

/**
 * The screens the ceiling is frozen for, in the order the operator reads them.
 *
 * SAFETY: `TEAL_BUDGET_CEILING` is a `const` object literal, so its own keys are exactly its key
 * type; `Object.keys` is typed `string[]` only because a wider object could carry more.
 */
const SCREENS = Object.keys(TEAL_BUDGET_CEILING) as TealBudgetScreen[];

/** One element that spends the accent, and what it spends it on. */
interface TealElement {
  /** A short name a person can find it by: the tag, its data slot, and its first classes. */
  what: string;
  /** Its words, trimmed, so an inventory line is readable. */
  text: string;
  /**
   * Where it sits and what it is for: the nearest labelled ancestor and that ancestor's words.
   * An icon has no text of its own, and "one more teal `svg`" is not a fact anybody can act on.
   */
  owner: string;
  /** Which of the three aspects resolved to the token. */
  aspects: string[];
}

/** What one read of a screen found. */
interface TealReading {
  /** The token's three channels as the page resolved them, so a failure can be checked by hand. */
  token: string;
  elements: TealElement[];
}

/**
 * Every element in the page that paints itself in the `--primary` token.
 *
 * @param page - a loaded page.
 * @returns the resolved token and one entry per element that spends it.
 */
async function readTealElements(page: Page): Promise<TealReading> {
  // THE CALLBACK BELOW IS SERIALISED INTO THE PAGE. It cannot see this module's scope, so a
  // helper that captures nothing from the callback still cannot be moved out of it, which is
  // exactly what `consistent-function-scoping` asks for.
  // oxlint-disable unicorn/consistent-function-scoping
  const reading = await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();

    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;color:hsl(var(--primary))';
    document.body.append(probe);
    const token = getComputedStyle(probe).color;
    probe.remove();

    // `rgb(r, g, b)` from the probe against `rgba(r, g, b, a)` on a real element: the three
    // channels are the identity, the alpha only has to be above zero for the paint to exist.
    const channels = token.match(/\d+/gu)?.slice(0, 3).join(',') ?? '';
    const isToken = (value: string): boolean => {
      const parts = value.match(/[\d.]+/gu);
      if (parts === null || parts.length < 3) return false;
      if (parts.slice(0, 3).join(',') !== channels) return false;
      return parts.length < 4 || Number.parseFloat(parts[3]) > 0;
    };

    const holdsOwnText = (element: Element): boolean => {
      for (const node of element.childNodes) {
        if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '') return true;
      }
      return false;
    };

    const elements: TealElement[] = [];
    const host = document.querySelector('main');
    if (host === null) throw new Error('the page has no main');
    for (const element of host.querySelectorAll('*')) {
      if (!element.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true })) {
        continue;
      }
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) continue;

      const aspects: string[] = [];
      const isIcon = element.tagName.toLowerCase() === 'svg';
      if ((isIcon || holdsOwnText(element)) && isToken(style.color)) aspects.push('text');
      if (isToken(style.backgroundColor)) aspects.push('background');
      const sides = [
        ['top', style.borderTopWidth, style.borderTopStyle, style.borderTopColor],
        ['right', style.borderRightWidth, style.borderRightStyle, style.borderRightColor],
        ['bottom', style.borderBottomWidth, style.borderBottomStyle, style.borderBottomColor],
        ['left', style.borderLeftWidth, style.borderLeftStyle, style.borderLeftColor],
      ] as const;
      for (const [side, width, lineStyle, colour] of sides) {
        if (Number.parseFloat(width) <= 0) continue;
        if (lineStyle === 'none' || lineStyle === 'hidden') continue;
        if (!isToken(colour)) continue;
        aspects.push(`border-${side}`);
      }
      if (aspects.length === 0) continue;

      const slot = element.getAttribute('data-slot');
      const classes = element.className.toString().split(/\s+/u).slice(0, 3).join('.');
      const label = element.getAttribute('aria-label');
      const owner = element.parentElement?.closest('[data-slot], a, button, li, section') ?? null;
      elements.push({
        what: `${element.tagName.toLowerCase()}${slot === null ? '' : `[${slot}]`}${classes === '' ? '' : `.${classes}`}`,
        text: (label ?? element.textContent ?? '').trim().replaceAll(/\s+/gu, ' ').slice(0, 40),
        owner:
          owner === null ? '(page)' : (
            `${owner.tagName.toLowerCase()}${owner.getAttribute('data-slot') === null ? '' : `[${owner.getAttribute('data-slot') ?? ''}]`} "${(owner.getAttribute('aria-label') ?? owner.textContent ?? '').trim().replaceAll(/\s+/gu, ' ').slice(0, 40)}"`
          ),
        aspects,
      });
    }
    return { token, elements };
  });
  // oxlint-enable unicorn/consistent-function-scoping
  return reading;
}

/**
 * One line per teal element, for the operator to read in the run output.
 *
 * @param reading - what {@link readTealElements} found.
 * @returns the inventory, one string per element.
 */
function inventory(reading: TealReading): string[] {
  return reading.elements.map(
    (element) => `${element.aspects.join('+')} ${element.what} "${element.text}" in ${element.owner}`,
  );
}

for (const screen of SCREENS) {
  test(`${screen} spends the accent at most ${TEAL_BUDGET_CEILING[screen]} times`, async ({ page }) => {
    await completeOnboarding(page);
    await logFoodManually(page, SEEDED_FOOD);
    await page.setViewportSize({ width: PHONE_WIDTH, height: PHONE_HEIGHT });
    await page.goto(screen);
    await expect(page.locator('main').first(), `${screen}: the page must render`).toBeVisible();
    await page.waitForLoadState('load');

    const reading = await readTealElements(page);

    // NON-VACUITY: a reader that resolved the token to nothing would find nothing on every
    // screen and pass every ceiling. The token must be a real colour, and the page must spend it
    // at least once: every screen in this app has an active tab in the bottom bar.
    expect(reading.token, `${screen}: the --primary token must resolve to a colour`).toMatch(/^rgba?\(/u);
    expect(reading.elements.length, `${screen}: a screen with no teal at all means the reader is blind`).toBeGreaterThan(
      0,
    );

    // PRINTED, always. The ceiling is a number somebody has to be able to argue with, and the
    // argument is about which elements it is made of.
    console.log(`\n${screen}: ${reading.elements.length} teal elements (${reading.token})`);
    for (const line of inventory(reading)) console.log(`  ${line}`);

    expect(
      reading.elements.length,
      `${screen}: the accent is spent more than the frozen ceiling. What spends it:\n${inventory(reading).join('\n')}`,
    ).toBeLessThanOrEqual(TEAL_BUDGET_CEILING[screen]);
  });
}

test('CONTROL: one injected teal element breaks the ceiling', async ({ page }) => {
  await completeOnboarding(page);
  await page.setViewportSize({ width: PHONE_WIDTH, height: PHONE_HEIGHT });
  await page.goto('/settings');
  await expect(page.locator('main').first()).toBeVisible();

  const before = await readTealElements(page);

  // A plain filled block in the token's own colour, appended to the page. Nothing about it is a
  // class name: it is `hsl(var(--primary))` straight from the stylesheet, which is what a new
  // feature's teal chip would resolve to as well.
  await page.evaluate(() => {
    const host = document.querySelector('main');
    if (host === null) throw new Error('the page has no main');
    const block = document.createElement('div');
    block.textContent = 'CONTROL teal';
    block.style.cssText = 'display:block;height:20px;background:hsl(var(--primary));transition:none';
    host.append(block);
  });

  const after = await readTealElements(page);
  expect(
    after.elements.length,
    'CONTROL: the reader must see exactly one more element than before',
  ).toBe(before.elements.length + 1);
  expect(
    after.elements.map((element) => element.text),
    'CONTROL: and must name the injected block',
  ).toContain('CONTROL teal');

  // The ceiling is the measured number exactly, so one more element must break it. Read against
  // the SAME ceiling the screen test uses, not a local copy.
  expect(
    after.elements.length,
    'CONTROL: one more teal element must exceed the frozen ceiling',
  ).toBeGreaterThan(TEAL_BUDGET_CEILING['/settings']);

  // And the other direction: a screen with nothing injected must still be inside it, or the
  // control proves only that the ceiling is small.
  expect(before.elements.length, 'CONTROL: and the screen as shipped must be inside it').toBeLessThanOrEqual(
    TEAL_BUDGET_CEILING['/settings'],
  );
});
