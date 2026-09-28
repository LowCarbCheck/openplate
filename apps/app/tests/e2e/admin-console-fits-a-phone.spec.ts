/**
 * The administration console fits the screen it is drawn on, in every language.
 *
 * ── WHAT THE OPERATOR SAW ────────────────────────────────────────────────
 *
 * On a phone, "the menu is shooting over the layout, breaking it" (2026-09-24).
 * The tab bar was one row of five underlined links that never wrapped. In the
 * body font (Victor Mono, 0.6em a character, `text-sm`, `px-3`, `gap-1`) that
 * row is about 472 px in English and 556 px in German. A 390 px phone gives the
 * bar 358 px and a 360 px phone 328, so the last two or three tabs ran past
 * the right edge and dragged the whole page sideways with them. The same bar
 * got about 464 px on a 768 px tablet with the sidebar open, which German
 * does not fit either.
 *
 * Walking every console page found four more, all fixed with the bar:
 *
 * - The activity tab drew 30 or 90 squares at row size, 418 and 1258 px, on
 *   one line.
 * - A labelled cell in a people or activity row could not wrap: "Último
 *   inicio de sesión" beside "Nunca inició sesión" is 321 px against a 294 px
 *   row at 360.
 * - The report queue's date lines could not wrap: 328 px in Italian at 360.
 * - At 768 px every language scrolled sideways by 33 to 60 px. The shell's
 *   `main` will not shrink below the widest unbreakable line inside it, a
 *   `truncate` line counts at full length, and a 51 character address held it
 *   at 558 px beside the 256 px sidebar. The console is now contained
 *   (`admin.tsx`), so no line in it can widen the shell. The shell itself is
 *   unchanged, and no page outside the console showed this at 768.
 *
 * ── WHAT THIS PROVES ─────────────────────────────────────────────────────
 *
 * For every console page, in all six languages, at 360, 390, 768 and 1280 px:
 * the document does not scroll sideways, nothing inside the console passes
 * either edge, every tab is drawn, visible, inside the viewport and not clipped
 * by a scroller, exactly the right tab is lit, a wrapped tab is at least 44 px
 * tall, and a bar wide enough for one row draws the underlined row it drew
 * before. A second spec proves that nothing in the frame moves once it is
 * drawn: the tabs arrive all at once, and the counts arrive into a box that
 * was already there.
 *
 * ── WHAT IT DOES NOT PROVE ───────────────────────────────────────────────
 *
 * That a real `openplate-core` authorises an administrator. The role and every
 * admin read are routed (`admin-console-stub.ts` says why and how), so this is
 * the real app, the real build and real Chromium laying out realistic wire
 * bodies, and nothing about the service side of the console.
 *
 * ── EVERY CHECK IS SHOWN ABLE TO FAIL ────────────────────────────────────
 *
 * The last spec breaks the fixed bar three ways in a live page, and the same
 * reader must name each break: the old one-row bar, the rejected sideways
 * scroller, and a tab squeezed under the tap floor. On the code before this
 * fix, the walk fails at its first reading, on geometry: at 360 px in English
 * the fifth tab ends at about 488 px. It can, because every element is found
 * by what it holds and never by a hook this fix added.
 *
 * ── GEOMETRY, NEVER A PICTURE ────────────────────────────────────────────
 *
 * Headless Chrome hides scrollbars and a fontless one reads every text as
 * hidden, so every assertion here is a number read from the layout.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

import { SUPPORTED_LANGUAGES } from '../../app/i18n/language-prefs';
import {
  LONG_INVITE_EMAIL,
  LONG_PERSON_EMAIL,
  LONG_PERSON_ID,
  adminConsoleStub,
  routeAdminConsole,
  type AdminConsoleStub,
} from './admin-console-stub';
import { completeOnboarding, signInFixtureAccount, useLanguage } from './helpers';
import { createGate } from './plans-stub';
import {
  installShiftObserver,
  movedBetween,
  readShiftEntries,
  readTops,
  settleFrames,
  shiftScoreAfter,
} from './layout-shift';

// A cross-origin read the service worker made would never reach `page.route`.
test.use({ serviceWorkers: 'block' });

/** The two phones the app promises to fit, a tablet with the sidebar open, and a laptop. */
const WALK_WIDTHS = [360, 390, 768, 1280] as const;

/** Any height: nothing here depends on it. */
const WALK_HEIGHT = 844;

/**
 * The narrowest bar that draws one underlined row. `WIDE_BAR_MIN_PX` in
 * `app/components/admin/admin-tabs.tsx`, repeated because importing that
 * component into the runner would load its whole React and i18n graph.
 */
const WIDE_BAR_MIN_PX = 672;

/** The floor for anything a finger aims at (M242). */
const TAP_FLOOR_PX = 44;

/** Sub-pixel slack for a box edge that sits exactly on the viewport edge. */
const EDGE_TOLERANCE_PX = 0.5;

/** Six languages, one sign-in each, and seven pages at four widths. */
const WALK_TIMEOUT_MS = 120_000;

/** How long the no-shift spec holds the handshake when nothing has drawn the bar yet. */
const HANDSHAKE_HOLD_MS = 3_000;

/** How long that spec waits for the bar: the hold, plus a session reopening behind it. */
const HELD_HANDSHAKE_TIMEOUT_MS = 15_000;

/** The reports tab is drawn, because the routed handshake advertises a window. */
const TAB_COUNT = 5;

/**
 * The tab bar, found by what it holds. NOT a `data-slot`, on purpose: the bar
 * before this fix carried none, and a check that reproduces the bug has to be
 * able to find the bar that had it.
 */
const BAR_SELECTOR = 'nav:has(> a[href="/admin/invitations"])';

/**
 * The console: the one box whose own header carries the page title, and which
 * holds a tab. Two flat `:has()`, because CSS does not allow one inside another
 * and this string also goes to the page's own `querySelector`.
 */
const CONSOLE_SELECTOR = 'div:has(> header h1):has(a[href="/admin/invitations"])';

/** The four counts: the console's one direct `dl`. A person's page has another, further down. */
const STATS_SELECTOR = ':scope > dl';

/** One console page: where it is, which tab it lights, and what on it says it has loaded. */
interface ConsolePage {
  path: string;
  litHref: string;
  ready: (root: Locator) => Locator;
}

/** The people list, the page `/admin` opens on. */
const PEOPLE_PAGE: ConsolePage = {
  path: '/admin',
  litHref: '/admin',
  ready: (root) => root.getByText(LONG_PERSON_EMAIL).first(),
};

/** The activity page, whose window buttons the walk presses. */
const ACTIVITY_PAGE: ConsolePage = {
  path: '/admin/activity',
  litHref: '/admin/activity',
  ready: (root) => root.locator('a[href^="/admin/people/"] ul').first(),
};

/**
 * Every console page a tab or a row leads to, except one report, whose page
 * reads a photograph. A text anchor is `.first()` because a long address can
 * also sit in a dialog title once that dialog is open.
 */
const CONSOLE_PAGES: readonly ConsolePage[] = [
  PEOPLE_PAGE,
  {
    path: '/admin/invitations',
    litHref: '/admin/invitations',
    ready: (root) => root.getByText(LONG_INVITE_EMAIL).first(),
  },
  ACTIVITY_PAGE,
  {
    path: '/admin/feedback',
    litHref: '/admin/feedback',
    ready: (root) => root.locator('a[href^="/admin/feedback/"]').first(),
  },
  {
    path: '/admin/settings',
    litHref: '/admin/settings',
    ready: (root) => root.locator('input[name="nutrientReferenceBasis"]').first(),
  },
  { path: '/admin/invite', litHref: '/admin/invitations', ready: (root) => root.locator('input[name="email"]') },
  {
    path: `/admin/people/${LONG_PERSON_ID}`,
    litHref: '/admin',
    ready: (root) => root.getByText(LONG_PERSON_EMAIL).first(),
  },
];

/** One tab, as the layout drew it. */
interface TabReading {
  label: string;
  href: string;
  isCurrent: boolean;
  left: number;
  right: number;
  top: number;
  height: number;
  isVisible: boolean;
  /** The nearest ancestor that clips this tab, or `null` when nothing does. */
  clippedBy: string | null;
  borderBottomPx: number;
}

/** Everything one reading of the console knows. */
interface FitReading {
  /** The LAYOUT width, `documentElement.clientWidth`. Never `innerWidth`: see {@link readFit}. */
  viewportWidth: number;
  documentScrollWidth: number;
  documentClientWidth: number;
  /**
   * The innermost elements anywhere on the page whose box passes the left or
   * the right edge, each marked as in the console or in the shell. Innermost,
   * so a line names the element that is too wide rather than every ancestor it
   * dragged along.
   */
  overflowing: string[];
  barScrollWidth: number;
  barClientWidth: number;
  /** The width of the box the bar's container query measures. */
  barContainerWidth: number;
  /** Whether the bar drew its underlined row, which is the only form with a hairline of its own. */
  isWideForm: boolean;
  tabs: TabReading[];
}

/**
 * Reads the console's geometry in one pass.
 *
 * @param page - a page showing a loaded console page.
 * @returns the reading.
 */
async function readFit(page: Page): Promise<FitReading> {
  // THE CALLBACK IS SERIALISED INTO THE PAGE, so its helpers live inside it.
  // oxlint-disable unicorn/consistent-function-scoping
  return page.evaluate(
    ({ tolerance, barSelector, consoleSelector }) => {
      const consoleElement = document.querySelector(consoleSelector);
      const bar = document.querySelector(barSelector);
      if (consoleElement === null || bar === null || bar.parentElement === null) {
        throw new Error('the console and its tab bar must be on the page');
      }
      const describe = (element: Element): string => {
        const slot = element.getAttribute('data-slot');
        const text = (element.textContent ?? '').trim().slice(0, 30);
        return `${element.tagName.toLowerCase()}${slot === null ? '' : `[${slot}]`} "${text}"`;
      };
      const isOutside = (inner: DOMRect, outer: DOMRect): boolean =>
        inner.left < outer.left - tolerance ||
        inner.right > outer.right + tolerance ||
        inner.top < outer.top - tolerance ||
        inner.bottom > outer.bottom + tolerance;
      const clipper = (element: Element): string | null => {
        const box = element.getBoundingClientRect();
        for (let node = element.parentElement; node !== null; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
          if (isOutside(box, node.getBoundingClientRect())) return describe(node);
        }
        return null;
      };

      // THE LAYOUT WIDTH, NOT `innerWidth`. This project emulates a phone
      // (`isMobile`), and a phone browser zooms out until overflowing content
      // fits, so `innerWidth` grows with the very overflow being measured: 814
      // on a 768 px layout. Against it, nothing could ever pass the edge.
      const viewportWidth = document.documentElement.clientWidth;
      // A fixed box is pinned to the viewport and stretches with the zoom
      // above, so it is a symptom of an overflow and never its cause.
      const pinned = [...document.body.querySelectorAll('*')].filter(
        (element) => getComputedStyle(element).position === 'fixed',
      );
      const offenders = [...document.body.querySelectorAll('*')].filter((element) => {
        if (pinned.some((fixed) => fixed.contains(element))) return false;
        const box = element.getBoundingClientRect();
        // A box a pixel or less on a side is `sr-only` text or a collapsed
        // node, which nobody sees wherever it sits.
        if (box.width <= 1 && box.height <= 1) return false;
        return box.left < -tolerance || box.right > viewportWidth + tolerance;
      });
      const overflowing = offenders
        .filter((element) => !offenders.some((other) => other !== element && element.contains(other)))
        .map((element) => {
          const box = element.getBoundingClientRect();
          const where = consoleElement.contains(element) ? 'console' : 'shell';
          return `${where}: ${describe(element)} spans ${Math.round(box.left)} to ${Math.round(box.right)} px`;
        });

      const tabs = [...bar.querySelectorAll('a')].map((tab) => {
        const box = tab.getBoundingClientRect();
        return {
          label: (tab.textContent ?? '').trim(),
          href: tab.getAttribute('href') ?? '',
          isCurrent: tab.getAttribute('aria-current') === 'page',
          left: box.left,
          right: box.right,
          top: box.top,
          height: box.height,
          isVisible: tab.checkVisibility({ opacityProperty: true, visibilityProperty: true }),
          clippedBy: clipper(tab),
          borderBottomPx: Number.parseFloat(getComputedStyle(tab).borderBottomWidth),
        };
      });

      return {
        viewportWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        documentClientWidth: document.documentElement.clientWidth,
        overflowing,
        barScrollWidth: bar.scrollWidth,
        barClientWidth: bar.clientWidth,
        barContainerWidth: bar.parentElement.getBoundingClientRect().width,
        isWideForm: Number.parseFloat(getComputedStyle(bar).borderBottomWidth) > 0,
        tabs,
      };
    },
    { tolerance: EDGE_TOLERANCE_PX, barSelector: BAR_SELECTOR, consoleSelector: CONSOLE_SELECTOR },
  );
  // oxlint-enable unicorn/consistent-function-scoping
}

/** The problems with the tabs themselves: count, place, visibility, and which one is lit. */
function tabProblems(reading: FitReading, litHref: string): string[] {
  const problems: string[] = [];
  if (reading.tabs.length !== TAB_COUNT) problems.push(`${reading.tabs.length} tabs drawn, ${TAB_COUNT} expected`);
  if (reading.barScrollWidth > reading.barClientWidth) {
    problems.push(`the tab bar holds ${reading.barScrollWidth} px of tabs in ${reading.barClientWidth} px`);
  }
  for (const tab of reading.tabs) {
    if (tab.left < -EDGE_TOLERANCE_PX || tab.right > reading.viewportWidth + EDGE_TOLERANCE_PX) {
      problems.push(
        `tab "${tab.label}" spans ${Math.round(tab.left)} to ${Math.round(tab.right)} px of ${reading.viewportWidth}`,
      );
    }
    if (!tab.isVisible) problems.push(`tab "${tab.label}" is not visible`);
    if (tab.clippedBy !== null) problems.push(`tab "${tab.label}" is clipped by ${tab.clippedBy}`);
  }
  const lit = reading.tabs.filter((tab) => tab.isCurrent);
  if (lit.length !== 1 || lit[0]?.href !== litHref) {
    problems.push(`lit: ${JSON.stringify(lit.map((tab) => tab.href))}, expected exactly ${litHref}`);
  }
  return problems;
}

/** The problems with the bar's form: a wrapped tab under the floor, or an underlined row that is not one row. */
function formProblems(reading: FitReading): string[] {
  const problems: string[] = [];
  const shouldBeWide = reading.barContainerWidth >= WIDE_BAR_MIN_PX;
  if (reading.isWideForm !== shouldBeWide) {
    problems.push(
      `a ${Math.round(reading.barContainerWidth)} px bar drew the ${reading.isWideForm ? 'underlined row' : 'wrapped form'}`,
    );
  }
  if (!reading.isWideForm) {
    for (const tab of reading.tabs) {
      if (tab.height < TAP_FLOOR_PX - EDGE_TOLERANCE_PX) problems.push(`tab "${tab.label}" is ${tab.height} px tall`);
    }
    return problems;
  }
  const tops = new Set(reading.tabs.map((tab) => Math.round(tab.top)));
  if (tops.size !== 1) problems.push(`the underlined row broke onto ${tops.size} lines`);
  for (const tab of reading.tabs) {
    if (tab.borderBottomPx !== 2)
      problems.push(`tab "${tab.label}" carries a ${tab.borderBottomPx} px rule, not the row's 2 px`);
  }
  return problems;
}

/**
 * Everything wrong with one reading, one line each. Empty is a console that fits.
 *
 * A LIST, never a boolean, so a failure names every broken box at once and the
 * control spec can require the specific line a break must produce.
 */
function fitProblems(reading: FitReading, litHref: string): string[] {
  const page: string[] = [];
  if (reading.documentScrollWidth > reading.documentClientWidth) {
    page.push(
      `the page scrolls sideways: ${reading.documentScrollWidth} px of content in ${reading.documentClientWidth} px`,
    );
  }
  for (const line of reading.overflowing) page.push(`past an edge: ${line}`);
  return [...page, ...tabProblems(reading, litHref), ...formProblems(reading)];
}

/** The console root. */
function consoleRoot(page: Page): Locator {
  return page.locator(CONSOLE_SELECTOR);
}

/** Waits for a console page to finish loading: its own content drawn, and no spinner left in the console. */
async function waitForConsolePage(page: Page, consolePage: ConsolePage): Promise<void> {
  await expect(consolePage.ready(consoleRoot(page))).toBeVisible();
  await expect(consoleRoot(page).locator(STATS_SELECTOR)).toBeVisible();
  // After a positive anchor above, so an empty console cannot pass it.
  await expect(consoleRoot(page).locator('.animate-spin')).toHaveCount(0);
}

/** Reads the loaded page at every walk width and requires it to fit each one. */
async function expectFitsEveryWidth(page: Page, input: { what: string; litHref: string }): Promise<void> {
  for (const width of WALK_WIDTHS) {
    await page.setViewportSize({ width, height: WALK_HEIGHT });
    await settleFrames(page);
    const reading = await readFit(page);
    expect(fitProblems(reading, input.litHref), `${input.what} at ${width} px`).toEqual([]);
  }
}

/** Signs the device in as an administrator, through the real sign-in, with every admin read routed. */
async function signInAsAdministrator(page: Page, stub: AdminConsoleStub): Promise<void> {
  await routeAdminConsole(page, stub);
  await completeOnboarding(page);
  await signInFixtureAccount(page);
  expect(stub.selfId, 'the sign-in answer must have named the account').not.toBeNull();
}

/** The three window buttons on the activity page, in the order they are offered: 7, 30 and 90 days. */
const ACTIVITY_WINDOWS = [7, 30, 90] as const;

for (const language of SUPPORTED_LANGUAGES) {
  test(`every console page fits a phone, a tablet and a laptop in ${language}`, async ({ page }) => {
    test.setTimeout(WALK_TIMEOUT_MS);
    const stub = adminConsoleStub();
    await signInAsAdministrator(page, stub);
    await useLanguage(page, language);

    for (const consolePage of CONSOLE_PAGES) {
      await page.setViewportSize({ width: WALK_WIDTHS[0], height: WALK_HEIGHT });
      await page.goto(consolePage.path);
      // THE CONTROL FOR THE LANGUAGE: a walk that stayed in English would
      // pass in every language for the wrong reason.
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      await waitForConsolePage(page, consolePage);
      await expectFitsEveryWidth(page, { what: `${consolePage.path} in ${language}`, litHref: consolePage.litHref });
    }

    // Every window the activity page offers, because the strip is as wide as
    // the window: 7 squares fit anywhere and 90 fit nowhere on one line.
    await page.setViewportSize({ width: WALK_WIDTHS[0], height: WALK_HEIGHT });
    await page.goto('/admin/activity');
    await waitForConsolePage(page, ACTIVITY_PAGE);
    const windowButtons = consoleRoot(page).locator('button[aria-pressed]');
    await expect(windowButtons).toHaveCount(ACTIVITY_WINDOWS.length);
    for (const [index, days] of ACTIVITY_WINDOWS.entries()) {
      await windowButtons.nth(index).click();
      await expect(windowButtons.nth(index)).toHaveAttribute('aria-pressed', 'true');
      await expect(consoleRoot(page).locator('a[href^="/admin/people/"] ul').first().locator('li')).toHaveCount(days);
      await expectFitsEveryWidth(page, {
        what: `/admin/activity over ${days} days in ${language}`,
        litHref: '/admin/activity',
      });
    }

    expect(stub.unanswered, 'every admin read the console made must have been answered').toEqual([]);
  });
}

test('the console is drawn once, and nothing in it moves when the counts arrive', async ({ page }) => {
  const stub = adminConsoleStub();
  await installShiftObserver(page);
  await signInAsAdministrator(page, stub);
  await page.setViewportSize({ width: 390, height: WALK_HEIGHT });

  // THE HANDSHAKE IS HELD until the tab bar is seen or three seconds pass,
  // whichever comes first. A console that drew its bar before knowing about
  // the reports tab is caught holding four tabs; one that waits for the
  // answer draws nothing until the timer lets the handshake through.
  const barSeen = createGate();
  stub.healthGate = Promise.race([
    barSeen.promise,
    new Promise<void>((resolve) => setTimeout(resolve, HANDSHAKE_HOLD_MS)),
  ]);
  // THE COUNTS ARE HELD until the frame has been measured once.
  const counts = createGate();
  stub.statsGate = counts.promise;

  await page.goto('/admin');
  const bar = page.locator(BAR_SELECTOR);
  // Past the three second hold, which a console that waits for the handshake sits out.
  await expect(bar).toBeVisible({ timeout: HELD_HANDSHAKE_TIMEOUT_MS });
  const tabsAtFirstSight = await bar.locator('a').count();
  barSeen.open();
  expect(tabsAtFirstSight, 'the bar is drawn once, with every tab it will ever hold').toBe(TAB_COUNT);

  await settleFrames(page);
  const entriesBefore = (await readShiftEntries(page)).length;
  const topsBefore = await readTops(page);

  counts.open();
  await waitForConsolePage(page, PEOPLE_PAGE);
  await settleFrames(page);

  const moved = movedBetween(topsBefore, await readTops(page));
  expect(moved, 'nothing on screen may move once the console is drawn').toEqual([]);
  const entries = await readShiftEntries(page);
  expect(shiftScoreAfter(entries, entriesBefore), JSON.stringify(entries.slice(entriesBefore))).toBe(0);
});

test('control: the fit reader names a one-row bar, a scrolled bar and a squeezed tab', async ({ page }) => {
  const stub = adminConsoleStub();
  await signInAsAdministrator(page, stub);
  await page.setViewportSize({ width: 390, height: WALK_HEIGHT });
  await page.goto('/admin');
  await waitForConsolePage(page, PEOPLE_PAGE);
  const bar = page.locator(BAR_SELECTOR);

  // The fixed bar passes, so each break below is the break's doing.
  expect(fitProblems(await readFit(page), '/admin')).toEqual([]);

  // 1. The bar as it was: one row that never wraps.
  await bar.evaluate((element) => {
    if (element instanceof HTMLElement) element.style.flexWrap = 'nowrap';
  });
  await settleFrames(page);
  const oneRow = fitProblems(await readFit(page), '/admin');
  expect(oneRow.some((line) => line.startsWith('tab "') && line.includes(' spans '))).toBe(true);

  // 2. The rejected fix: the same row in a sideways scroller. The page no
  // longer scrolls, so only the clip reading can see the hidden tabs.
  await bar.evaluate((element) => {
    if (element instanceof HTMLElement) element.style.overflowX = 'auto';
  });
  await settleFrames(page);
  const scrolled = fitProblems(await readFit(page), '/admin');
  expect(scrolled.some((line) => line.includes('is clipped by nav "'))).toBe(true);
  expect(scrolled.some((line) => line.startsWith('the page scrolls sideways'))).toBe(false);

  // 3. A wrapped tab squeezed under the tap floor.
  await bar.evaluate((element) => {
    if (!(element instanceof HTMLElement)) return;
    element.style.flexWrap = '';
    element.style.overflowX = '';
    for (const tab of element.querySelectorAll('a')) tab.style.minHeight = '0';
  });
  await settleFrames(page);
  const squeezed = fitProblems(await readFit(page), '/admin');
  expect(squeezed.some((line) => /^tab ".+" is \d+(\.\d+)? px tall$/u.test(line))).toBe(true);
});
