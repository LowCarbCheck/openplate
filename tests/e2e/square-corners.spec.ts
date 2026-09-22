/**
 * Every corner in the app is square, and the ONLY exception is a shape that is a circle by
 * design (operator decision, 2026-09-22, which retires the five-step radius ladder
 * `tests/unit/radius-tiers.test.ts` and `tests/e2e/lcc-lineage-shape.spec.ts` used to defend;
 * see `tests/design-contract.ts` and DESIGN.md section 5).
 *
 * WHY A COMPUTED READ, AND NOT A SOURCE GREP. `app/app.css`'s `--radius` and every token derived
 * from it are `0`, so most `rounded-*` classes already draw nothing even where source hygiene
 * missed one; the app-wide sweep that shipped alongside this spec removed the classes anyway, but
 * a source grep could not have proven the PAGE draws no corner, only that no class asked for one.
 * This reads `getComputedStyle(element).border*Radius` on a real, built page, the same discipline
 * `tests/e2e/lcc-lineage-teal-budget.spec.ts` and the retired shape spec used.
 *
 * WHAT COUNTS AS A CIRCLE. An element with ANY nonzero corner whose bounding box is square (width
 * equal to height, within 1px) AND whose radius is at least half its width: an avatar, a dot, a
 * round icon button, a switch's thumb, a spinner. A pill-shaped chip, a segmented control, a
 * progress bar's track, a search field, none of them pass this test, and none of them are allowed
 * to any more.
 *
 * THE ONE ALLOWLIST ENTRY. The switch/toggle TRACK is wider than it is tall (`h-[1.15rem] w-8`),
 * so the width-equals-height half of the circle test fails it on shape alone even though the
 * operator explicitly kept it round. `ALLOWED_SELECTORS` names it, with a reason, rather than
 * loosening the circle test itself, which would then also excuse an ordinary pill.
 *
 * THE WALK. The diary with a day of seeded data (cards, rows, chips, the bottom nav), two
 * settings pages, and the confirm dialog. No page this device can reach without a granted push
 * permission draws a real switch track, so the CONTROL test below proves the one allowlist entry
 * both ways instead: a shape built to the track's own proportions is excused only while it carries
 * `data-slot="switch"`, and the identical shape without that slot is reported. The CONTROL also
 * injects a plain non-circular radius and proves the reader reports it, and an honest circle and
 * proves it does not.
 *
 * A separate, one-time check put a radius back on `Card` and confirmed this spec goes red for it.
 * The plain named `card` step class did not: `app/app.css` zeroes every radius token that class
 * reads, so the class is a genuine no-op now and re-adding it changed nothing a browser could
 * draw. An 8px value written as a literal, bypassing the theme token the way a careless future
 * regression might (do not spell that literal out here, `tailwindcss`'s content scan would pick
 * it up and generate the dead rule this sentence is explaining why to avoid), did: both cards on
 * `/diary` came back with `radii=[8,8,8,8]` and the test failed. That is the real backstop this
 * spec is for, the token zeroing is one layer and this is the other, and the failing run is
 * recorded in the commit that added this file, not left in the suite.
 *
 * TWO MORE TESTS BELOW ARE NOT ABOUT CORNERS. A bug report grows the browser suite (the house
 * rule): an operator screenshot showed `/settings/plan` at 360px with content pushed right and a
 * card clipped past the right edge, which this file diagnosed as a stale Vite dependency-optimiser
 * cache on a remote preview host, not a corner regression, but the shape of the damage (a
 * pushed-right, overflowing `main`) is worth a permanent guard regardless of its cause that day.
 */
import { expect, test, type Page } from '@playwright/test';

import { completeOnboarding, logFoodManually } from './helpers';

/** The design width this tier is written against. */
const PHONE_WIDTH = 390;
const PHONE_HEIGHT = 844;

/** One food, so the diary draws a day of cards, rows and chips rather than an empty state. */
const SEEDED_FOOD = { name: 'Square corner cheddar', grams: '40', carbs: '1.2' } as const;

/** A corner radius no legitimate shape here uses, so an injected probe can never pass by accident. */
const PROBE_RADIUS_PX = 6;

/** One visible element the reader found drawing a corner it should not. */
interface CornerViolation {
  /** A short name a person can find it by: the tag, its data slot, and its first classes. */
  what: string;
  /** The four corners, in CSS pixels, top-left/top-right/bottom-right/bottom-left. */
  radii: number[];
  width: number;
  height: number;
}

/**
 * Elements allowed to keep a rounded corner though the circle test alone would not clear them,
 * each with the reason a reviewer can argue with.
 */
const ALLOWED_SELECTORS: readonly string[] = [
  // The switch/toggle track: an operator-approved round shape, but wider than it is tall
  // (`h-[1.15rem] w-8`), so it fails the strict circle test on its box alone.
  '[data-slot="switch"]',
];

/**
 * Every visible element on the page whose computed corner radius is nonzero and is neither a
 * circle nor on the allowlist.
 *
 * @param page - a loaded page.
 * @returns one entry per offending element, empty when the page is clean.
 */
async function cornerViolations(page: Page): Promise<CornerViolation[]> {
  // THE CALLBACK BELOW IS SERIALISED INTO THE PAGE, same discipline as the teal-budget reader:
  // it cannot see this module's scope, so a helper that captures nothing still cannot move out.
  // oxlint-disable unicorn/consistent-function-scoping
  return page.evaluate<CornerViolation[], readonly string[]>((allowedSelectors) => {
    const CIRCLE_BOX_TOLERANCE_PX = 1;

    const isAllowed = (element: Element): boolean =>
      allowedSelectors.some((selector) => element.matches(selector));

    const isCircle = (radii: number[], width: number, height: number): boolean => {
      if (Math.abs(width - height) > CIRCLE_BOX_TOLERANCE_PX) return false;
      const half = Math.min(width, height) / 2;
      return radii.every((radius) => radius >= half - CIRCLE_BOX_TOLERANCE_PX);
    };

    const found: { what: string; radii: number[]; width: number; height: number }[] = [];
    for (const element of document.body.querySelectorAll('*')) {
      if (!element.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true })) {
        continue;
      }
      const box = element.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) continue;

      const style = getComputedStyle(element);
      const radii = [
        style.borderTopLeftRadius,
        style.borderTopRightRadius,
        style.borderBottomRightRadius,
        style.borderBottomLeftRadius,
      ].map((value) => Number.parseFloat(value));
      if (radii.every((radius) => radius <= 0)) continue;
      if (isCircle(radii, box.width, box.height)) continue;
      if (isAllowed(element)) continue;

      const slot = element.getAttribute('data-slot');
      const classes = element.className.toString().split(/\s+/u).slice(0, 3).join('.');
      found.push({
        what: `${element.tagName.toLowerCase()}${element.id === '' ? '' : `#${element.id}`}${slot === null ? '' : `[data-slot=${slot}]`}${classes === '' ? '' : `.${classes}`}`,
        radii,
        width: box.width,
        height: box.height,
      });
    }
    return found;
  }, ALLOWED_SELECTORS);
  // oxlint-enable unicorn/consistent-function-scoping
}

/**
 * One line per violation, for the operator to read in the run output.
 *
 * @param violations - what {@link cornerViolations} found.
 * @returns the inventory, one string per element.
 */
function inventory(violations: readonly CornerViolation[]): string[] {
  return violations.map(
    (violation) =>
      `${violation.what} ${violation.width}x${violation.height} radii=[${violation.radii.join(',')}]`,
  );
}

test('every corner on the diary is square, except the circles', async ({ page }) => {
  await completeOnboarding(page);
  await logFoodManually(page, SEEDED_FOOD);
  await page.setViewportSize({ width: PHONE_WIDTH, height: PHONE_HEIGHT });
  await page.goto('/diary');
  await expect(page.locator('main').first(), 'the diary must render').toBeVisible();
  await page.waitForLoadState('load');

  const violations = await cornerViolations(page);
  expect(violations, `square-corner violations on /diary:\n${inventory(violations).join('\n')}`).toEqual([]);
});

test('every corner on settings is square, except the circles', async ({ page }) => {
  await completeOnboarding(page);
  await page.setViewportSize({ width: PHONE_WIDTH, height: PHONE_HEIGHT });

  // Two pages: the hub itself, and `/settings/notifications`, whose master toggle only draws once
  // push is `ready` (a permission this fresh device never has), so the one `Switch` this walk can
  // reach without fighting the Notification API is the disabled state before that.
  for (const screen of ['/settings', '/settings/notifications']) {
    await page.goto(screen);
    await expect(page.locator('main').first(), `${screen} must render`).toBeVisible();
    await page.waitForLoadState('load');

    const violations = await cornerViolations(page);
    expect(violations, `square-corner violations on ${screen}:\n${inventory(violations).join('\n')}`).toEqual([]);
  }
});

/** The narrow phone width the horizontal-layout check below is written against. */
const NARROW_PHONE_WIDTH = 360;

/** How far `main`'s left edge may sit from the viewport's own left edge before a gutter counts as damage. */
const MAIN_LEFT_EDGE_BUDGET_PX = 24;

/** The document's overall width health, and where `main` starts. */
interface LayoutHealth {
  scrollWidth: number;
  clientWidth: number;
  mainLeft: number | null;
}

/**
 * Reads whether the document overflows its own viewport, and how far `main` sits from the left
 * edge. Not a corner concern, but the coordinator's own report (an operator screenshot of
 * `/settings/plan` at ~363 CSS px: content starting ~108px in, an empty column to its left, the
 * card clipped on the right) was diagnosed as a stale Vite dependency-optimiser cache on the
 * remote preview host (`504 Outdated Optimize Dep` on `@radix-ui/react-collapsible`,
 * `-switch` and `-select`, reproduced on `/settings`, `/settings/plan` and `/trends` alike, and
 * NOT present in the production build this spec drives, verified with the real, mocked-signed-out
 * `/settings/plan` render at 363px in German and dark mode). Since the mechanism a broken
 * hydration leaves behind is exactly a pushed-right, overflowing main column, this reader stays as
 * the regression guard for it, per the house rule that a bug report grows the browser suite.
 *
 * @param page - a loaded page.
 * @returns the document's scroll/client width and `main`'s left edge, in CSS pixels.
 */
async function layoutHealth(page: Page): Promise<LayoutHealth> {
  return page.evaluate(() => {
    const main = document.querySelector('main');
    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      mainLeft: main === null ? null : main.getBoundingClientRect().left,
    };
  });
}

test('the settings hub and the plan page keep their horizontal layout at 360px', async ({ page }) => {
  await completeOnboarding(page);
  await page.setViewportSize({ width: NARROW_PHONE_WIDTH, height: PHONE_HEIGHT });

  for (const screen of ['/settings', '/settings/plan']) {
    await page.goto(screen);
    // `/settings/plan` 404s on a build with no sync server configured, exactly as it does here;
    // the layout claim holds for that page too, an app-wide 404 is still an app page.
    await expect(page.locator('main').first(), `${screen} must render a <main>`).toBeVisible();
    const health = await layoutHealth(page);
    expect(health.mainLeft, `${screen}: no <main> to measure`).not.toBeNull();
    expect(health.scrollWidth, `${screen}: the document must not overflow its own viewport`).toBe(
      health.clientWidth,
    );
    expect(
      health.mainLeft ?? Number.POSITIVE_INFINITY,
      `${screen}: main's left edge sits ${health.mainLeft}px from the viewport's own left edge`,
    ).toBeLessThanOrEqual(MAIN_LEFT_EDGE_BUDGET_PX);
  }
});

test('CONTROL: a pushed-right, overflowing main is reported', async ({ page }) => {
  await completeOnboarding(page);
  await page.setViewportSize({ width: NARROW_PHONE_WIDTH, height: PHONE_HEIGHT });
  await page.goto('/settings');
  await expect(page.locator('main').first(), 'settings must render a <main>').toBeVisible();

  const before = await layoutHealth(page);
  expect(before.mainLeft, 'the page as shipped must already have a <main> to measure').not.toBeNull();
  expect(before.scrollWidth, 'the page as shipped must not already overflow').toBe(before.clientWidth);
  expect(before.mainLeft ?? Number.POSITIVE_INFINITY, 'the page as shipped must already sit at the left edge').toBeLessThanOrEqual(
    MAIN_LEFT_EDGE_BUDGET_PX,
  );

  // The shape of the reported damage: an empty column pushing `main` right, and its content
  // wide enough to run past the right edge, so both halves of the read are exercised at once.
  await page.evaluate(() => {
    const main = document.querySelector('main');
    if (main instanceof HTMLElement) {
      main.style.marginLeft = '108px';
      main.style.minWidth = '600px';
    }
  });

  const after = await layoutHealth(page);
  expect(after.mainLeft, 'a pushed-right main must be reported').toBeGreaterThan(MAIN_LEFT_EDGE_BUDGET_PX);
  expect(after.scrollWidth, 'an overflowing main must be reported').toBeGreaterThan(after.clientWidth);
});

test('every corner in the confirm dialog is square, except the circles', async ({ page }) => {
  await completeOnboarding(page);
  await logFoodManually(page, SEEDED_FOOD);
  await page.setViewportSize({ width: PHONE_WIDTH, height: PHONE_HEIGHT });
  await page.goto('/foods');

  const row = page.locator('[data-slot="custom-food-row"]').first();
  await expect(row, 'the saved food must be listed').toBeVisible();
  await row.getByRole('button', { name: /remove/iu }).click();

  const dialog = page.locator('[data-slot="alert-dialog-content"]');
  await expect(dialog, 'the confirm dialog must open').toBeVisible();

  const violations = await cornerViolations(page);
  expect(violations, `square-corner violations with the dialog open:\n${inventory(violations).join('\n')}`).toEqual(
    [],
  );
});

test('CONTROL: an injected non-circular radius is reported, and a real circle is not', async ({ page }) => {
  await completeOnboarding(page);
  await page.setViewportSize({ width: PHONE_WIDTH, height: PHONE_HEIGHT });
  await page.goto('/settings');
  await expect(page.locator('main').first()).toBeVisible();

  const before = await cornerViolations(page);
  expect(before, `the page as shipped must already be clean:\n${inventory(before).join('\n')}`).toEqual([]);

  // A plain wide box with a real corner radius, appended to the page: the shape a reintroduced
  // `rounded-lg` chip would draw. Not a circle: 80x20, and a 6px radius clears none of the
  // "width equals height" half of the test.
  await page.evaluate((radius) => {
    const probe = document.createElement('div');
    probe.id = 'square-corner-probe';
    probe.style.cssText = `position:fixed;top:0;left:0;width:80px;height:20px;background:#888;border-radius:${radius}px;z-index:9999`;
    document.body.append(probe);
  }, PROBE_RADIUS_PX);

  const withProbe = await cornerViolations(page);
  expect(withProbe.length, 'the reader must report exactly one more element than before').toBe(before.length + 1);
  expect(
    withProbe.some((violation) => violation.what.includes('square-corner-probe')),
    'and it must be the injected probe',
  ).toBe(true);

  // The other direction: a probe drawn as an honest circle (40x40, a 20px radius) must NOT be
  // reported, or the circle exception is not being applied at all and every avatar would fail too.
  await page.evaluate(() => {
    document.getElementById('square-corner-probe')?.remove();
    const circle = document.createElement('div');
    circle.id = 'circle-probe';
    circle.style.cssText = 'position:fixed;top:0;left:0;width:40px;height:40px;background:#888;border-radius:20px;z-index:9999';
    document.body.append(circle);
  });

  const withCircle = await cornerViolations(page);
  expect(
    withCircle.length,
    `an honest circle must not be reported:\n${inventory(withCircle).join('\n')}`,
  ).toBe(before.length);

  // THE ALLOWLIST ITSELF, proven both ways. A real switch track is never on the two settings
  // pages the walk above reaches (its page needs a granted push permission), so this is the only
  // place `[data-slot="switch"]` is exercised: a shape drawn to the track's own proportions
  // (h-[1.15rem] w-8, `rounded-full`) must clear the reader ONLY when it carries the slot the
  // allowlist matches on.
  await page.evaluate(() => {
    document.getElementById('circle-probe')?.remove();
    const track = document.createElement('div');
    track.style.cssText =
      'position:fixed;top:0;left:0;width:32px;height:18.4px;background:#888;border-radius:9999px;z-index:9999';
    track.dataset.slot = 'switch';
    document.body.append(track);
  });
  const withAllowedTrack = await cornerViolations(page);
  expect(
    withAllowedTrack.length,
    `a switch-shaped track carrying data-slot="switch" must be excused:\n${inventory(withAllowedTrack).join('\n')}`,
  ).toBe(before.length);

  await page.evaluate(() => {
    const track = document.querySelector('[data-slot="switch"]');
    if (track instanceof HTMLElement) track.dataset.slot = 'not-a-switch';
  });
  const withoutTheSlot = await cornerViolations(page);
  expect(
    withoutTheSlot.length,
    'the SAME shape without the slot must be reported, or the allowlist is not doing anything',
  ).toBe(before.length + 1);
});
