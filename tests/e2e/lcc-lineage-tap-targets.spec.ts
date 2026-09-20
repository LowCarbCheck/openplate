/**
 * Every tappable row on the four screens a person uses first is at least 44 px tall (M243 spec 08).
 *
 * WHY HERE. The restyle changes what a row is made of: a font that reads 13 percent larger at the
 * same size, a card recipe, a shape ladder. A row that was 44 px because its text sat inside a
 * `min-h-11` box stays 44; a row that was 44 px only because its Inter line height happened to
 * fill it would shrink or grow with the face. The floor is the app's own (M242), and this is the
 * check that the new face did not move anything under it. It reads GEOMETRY, never a class name:
 * `h-11` on a control inside a flex row that squeezes it is still 32 px on screen.
 *
 * WHAT COUNTS AS TAPPABLE, AND WHAT DOES NOT. Inside `main`, a link, a button, a combobox, a tab, a
 * summary, a select or a text field. Four kinds of control are measured by what a finger lands on
 * and not by their own box, each for a reason a reader can check (the same four
 * `mobile-settings.spec.ts` names):
 *
 * - A box a pixel or less on a side is visually hidden on purpose (a `sr-only` radio, a file input
 *   behind a button). Its label is the target and is measured instead.
 * - A radio or checkbox is a 16 px mark inside a label that is the real target, so the label is
 *   measured instead.
 * - A switch is a 32 px track at the end of a row, and the row is the target, so the row is
 *   measured instead.
 * - A link drawn `display: inline` is a word inside a sentence. Growing it would push it out of
 *   its own line box and over the text above it, which is the inline exception WCAG 2.5.8 names.
 *
 * ONLY THE PAGE, NOT THE SHELL. `main` also wraps the app header, and the update ribbon and the
 * bottom bar sit beside it. Those are the shell's, and the specs that own the shell measure them
 * (`mobile-shell.spec.ts`, `lcc-lineage-update-ribbon.spec.ts`), so they are left out here.
 *
 * ── FOUR KNOWN TARGETS ARE UNDER THE FLOOR AT M243, AND ARE FROZEN, NOT FIXED ──
 * The first run of this check found four targets whose DRAWN box is under 44 px: three real ones (two
 * `inline-block text-xs` links and a `text-sm` text button, 16 to 20 px tall) and "Save as meal",
 * which draws 28 px and buys its 44 from an `after:` box. None was caused by the new face and none
 * is in a file spec 08 may edit, so they are named in `KNOWN_UNDER_FLOOR` with what each one is. The list is a FROZEN SET, like the colour literals in
 * `brand-colors.test.ts`: it fails in both directions. A NEW small target fails the check, and an
 * entry that no longer matches a small target fails it too, which is how a fix gets noticed and
 * the entry deleted. It is the operator's list to work down.
 *
 * ── EVERY CHECK IS SHOWN ABLE TO FAIL ──
 * The reader is pointed at a real 30 px button and a real 44 px button it is handed. It must list
 * the first and not the second, or a reader that returned nothing would pass every screen.
 */
import { expect, test, type Page } from '@playwright/test';

import type { LanguageCode } from '../../app/i18n/language-prefs';
import { completeOnboarding, logFoodManually, useLanguage } from './helpers';

/** The floor: nothing a finger aims at is shorter than this. */
const TAP_FLOOR_PX = 44;

/** A box this small is visually hidden, and its label is the target instead. */
const HIDDEN_CONTROL_PX = 1;

/** The narrowest screen the app promises to fit. */
const PHONE_WIDTH = 360;
const PHONE_HEIGHT = 844;

/** The source language, the widest one and the one whose glyphs differ most. */
const LOCALES = ['en', 'de', 'tr'] as const satisfies readonly LanguageCode[];

/** The four screens. `/diary` and `/add` carry a logged food so their rows exist. */
const ROUTES = ['/diary', '/settings', '/add', '/scan'] as const;

/** What a finger aims at in the page, which is `main` less the shell that shares it. */
const TARGETS =
  'main :is(a[href], button, [role="button"], [role="link"], [role="tab"], [role="combobox"], [role="menuitem"], [role="switch"], summary, select, textarea, input:not([type="hidden"])):not(header.sticky *, [data-slot="bottom-nav-shell"] *, output *)';

/** One target that is shorter than the floor. */
interface SmallTarget {
  route: string;
  what: string;
  height: number;
}

/** A small target that is known, why it is small, and where it lives. */
interface KnownSmallTarget {
  route: string;
  /** Matches the element itself, never its text, so it reads the same in every language. */
  selector: string;
  reason: string;
}

/**
 * The targets under the floor on the four screens today. See the header for why they are frozen.
 *
 * Each `selector` names the element by what it IS (a data slot, a link target, a class pair), never
 * by its words, so the same entry matches in English, German and Turkish.
 */
const KNOWN_UNDER_FLOOR: readonly KnownSmallTarget[] = [
  {
    route: '/diary',
    selector: 'a[href="/settings/nutrition"]',
    reason: '"Set your own targets" is an `inline-block text-xs` link under the hero, 16 px tall. The diary sweep in mobile-diary.spec.ts does not read it.',
  },
  {
    route: '/diary',
    selector: '[data-slot="day-summary-insights-link"]',
    reason: '"Open Insights" is an `inline-block text-xs` link at the foot of the day summary, 16 px tall.',
  },
  {
    route: '/diary',
    selector: '[data-slot="save-meal-trigger"]',
    reason: '"Save as meal" draws 28 px of ink and buys its 44 px from an `after:` box; mobile-diary.spec.ts proves the box by hit test, which a drawn-box reader cannot.',
  },
  {
    route: '/add',
    selector: 'button.text-muted-foreground.underline-offset-4',
    reason: '"Add manually" is a `text-sm` text button under the search field, about 20 px tall.',
  },
];

/** What one read of a page found. */
interface TargetReading {
  /** Targets under the floor that no known entry accounts for. */
  offenders: SmallTarget[];
  /** The known entries that matched at least one small target, so a fixed one can be told from a live one. */
  matched: string[];
}

/**
 * Every target in the page that is under the floor, split into the known ones and the rest.
 *
 * @param page - a loaded page.
 * @param route - the URL being read, so a failure names it.
 * @param known - the frozen entries for this route.
 * @returns the unexplained offenders, and which known entries were seen.
 */
async function readTargets(page: Page, route: string, known: readonly KnownSmallTarget[]): Promise<TargetReading> {
  return page.locator(TARGETS).evaluateAll(
    (elements, { floor, hidden, where, entries }) => {
      const offenders: SmallTarget[] = [];
      const matched = new Set<string>();
      for (const element of elements) {
        const own = element.getBoundingClientRect();
        if (own.width <= hidden || own.height <= hidden) continue;
        const type = element.getAttribute('type');
        const role = element.getAttribute('role');
        if (element.tagName === 'A' && getComputedStyle(element).display === 'inline') continue;
        // A mark or a track is measured by the surface a finger lands on: its label, or its row.
        const isMark = type === 'radio' || type === 'checkbox' || role === 'switch';
        const target = isMark ? (element.closest('label') ?? element.parentElement ?? element) : element;
        const box = target.getBoundingClientRect();
        if (box.height <= 0 || box.height + 0.5 >= floor) continue;
        const entry = entries.find((candidate) => element.matches(candidate.selector));
        if (entry !== undefined) {
          matched.add(entry.selector);
          continue;
        }
        offenders.push({
          route: where,
          what: (element.getAttribute('aria-label') ?? element.textContent ?? element.tagName).trim().slice(0, 50),
          height: Math.round(box.height),
        });
      }
      return { offenders, matched: [...matched] };
    },
    { floor: TAP_FLOOR_PX, hidden: HIDDEN_CONTROL_PX, where: route, entries: [...known] },
  );
}

test('CONTROL: the reader lists a 30 px button and does not list a 44 px one', async ({ page }) => {
  await completeOnboarding(page);
  await page.setViewportSize({ width: PHONE_WIDTH, height: PHONE_HEIGHT });
  await page.goto('/settings');
  await expect(page.locator('main').first()).toBeVisible();

  await page.evaluate(() => {
    const main = document.querySelector('main');
    if (main === null) throw new Error('the page has no main');
    for (const [label, height] of [
      ['CONTROL thirty', 30],
      ['CONTROL forty four', 44],
    ] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.style.cssText = `display:block;height:${height}px;`;
      main.append(button);
    }
  });

  const reading = await readTargets(page, '/settings', []);
  const found = reading.offenders.map((target) => target.what);
  expect(found, 'the 30 px button must be listed').toContain('CONTROL thirty');
  expect(found, 'the 44 px button must not be listed').not.toContain('CONTROL forty four');

  // The frozen set can fail in the OTHER direction too: handed the diary's entries on a page that
  // has none of those targets, no entry matches, and that is what the stale-entry check reports.
  const diaryEntries = KNOWN_UNDER_FLOOR.filter((entry) => entry.route === '/diary');
  const stale = await readTargets(page, '/settings', diaryEntries);
  expect(stale.matched, 'entries for another screen must match nothing here').toEqual([]);
});

for (const locale of LOCALES) {
  test(`every tappable row in main is at least ${TAP_FLOOR_PX} px tall on the four first screens, ${locale}`, async ({
    page,
  }) => {
    await completeOnboarding(page);
    // A food, so the diary and the add screen carry rows a finger can hit.
    await logFoodManually(page, { name: 'Tap floor porridge', grams: '200', carbs: '10', mealType: 'breakfast' });
    await logFoodManually(page, { name: 'Tap floor porridge', grams: '200', carbs: '10', mealType: 'breakfast' });
    await useLanguage(page, locale);
    await page.setViewportSize({ width: PHONE_WIDTH, height: PHONE_HEIGHT });

    const offenders: SmallTarget[] = [];
    const stale: string[] = [];
    for (const route of ROUTES) {
      await page.goto(route);
      await expect(page.locator('main').first()).toBeVisible();
      // Non-vacuity: a page that drew no tappable thing at all would pass the claim by drawing nothing.
      await expect
        .poll(() => page.locator(TARGETS).count(), { message: `${locale} ${route}: the page must have tappable rows` })
        .toBeGreaterThan(2);
      await page.waitForLoadState('load');
      const known = KNOWN_UNDER_FLOOR.filter((entry) => entry.route === route);
      const reading = await readTargets(page, route, known);
      offenders.push(...reading.offenders);
      for (const entry of known) {
        if (!reading.matched.includes(entry.selector)) stale.push(`${route} ${entry.selector}: ${entry.reason}`);
      }
    }

    expect(
      offenders.map((offender) => `${locale} ${offender.route}: "${offender.what}" is ${offender.height} px tall`),
      `${locale}: a tappable row is under ${TAP_FLOOR_PX} px`,
    ).toEqual([]);
    expect(stale, `${locale}: a known small target is no longer small, so delete its entry from KNOWN_UNDER_FLOOR`).toEqual(
      [],
    );
  });
}
