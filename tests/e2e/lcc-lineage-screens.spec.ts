/**
 * The restyled screens still fit a phone, still draw their charts at full size, and still offer a
 * finger something to hit (M243 spec 05).
 *
 * WHY ONE SPEC FOR THREE CLAIMS. They are three ways of asking the same question about the same
 * change: the data rows got shorter and denser, the hero got shorter, and the body face draws 13
 * percent wider than the one the layout was written against. A row that compacts too far breaks
 * the tap floor; a hero that compacts by squeezing its neighbours breaks a chart; a row that keeps
 * its content on one line breaks the width. Reading all three on one page load is also what keeps
 * the walk cheap enough to run at two widths.
 *
 * ── SIX SCREENS ──
 * `/diary` and `/dashboard` are spec 05a's; `/trends`, `/add`, `/scan` and `/settings` are spec
 * 05b's, and they were added by extending `ROUTES` and `FROZEN_CHART_PX`, exactly as this header
 * said they would be. Four of the six draw no plot at all, and each of those carries an EMPTY
 * frozen record rather than no record: the `satisfies` below turns adding a route into a decision
 * about its charts instead of a silent skip.
 *
 * ── THE CHART HEIGHTS ARE A FROZEN SET, FAILING IN BOTH DIRECTIONS ──
 * "Unchanged" needs a number to be unchanged FROM, so each plot's drawn height is frozen here,
 * measured on the production build at both widths. A plot that shrinks fails, a plot that grows
 * fails, and a plot that stops being drawn at all fails too, because every frozen entry must be
 * found. Without that last part a spec that silently matched nothing would be the greenest thing
 * in the tier.
 *
 * ── THE EMPTY STATES ARE ROWS, NOT POSTERS ──
 * The fourth claim, and the one with nothing else guarding it: an empty state states the missing
 * figure at a data row's size, left, with its primary action inline, rather than as a centred
 * column under an oversized title. It is read as COMPUTED text alignment and font size, so a poster
 * rebuilt out of different classes still fails. Two screens are read this way: the diary's
 * first-ever state (spec 05a) and the Insights page's own (spec 05b), each on the device state
 * that produces it.
 *
 * ── EVERY READER IS SHOWN ABLE TO FAIL ──
 * A control injects a 900 px element into `main` and requires the width reader to report the
 * document; a second injects a 30 px button and a 44 px button and requires the tap reader to
 * list the first and not the second; a third centres the empty state by hand and requires the
 * alignment claim to go red. No claim here can be satisfied by a reader that returns nothing.
 */
import { expect, test, type Page } from '@playwright/test';

import { CARD_TITLE_PX } from '../design-contract';
import { completeOnboarding, logFoodManually } from './helpers';

/** The two widths: the narrowest the app promises to fit, and the design width. */
const WIDTHS = [360, 390] as const;

/** The phone's height. Tall enough that the whole page is one scroll. */
const PHONE_HEIGHT = 844;

/** The floor no tappable row may sit under, the app's own (M242). */
const TAP_FLOOR_PX = 44;

/** A box this small is visually hidden and its label is the target instead. */
const HIDDEN_CONTROL_PX = 1;

/** The six screens the restyle touched: two from spec 05a, four from spec 05b. */
const ROUTES = ['/diary', '/dashboard', '/trends', '/add/search', '/add/photo', '/settings'] as const;

/** One food, so both screens draw a day rather than an empty state. */
const SEEDED_FOOD = { name: 'Screen walk cheddar', grams: '40', carbs: '1.2' } as const;

/**
 * The largest an empty state's opening line may be drawn.
 *
 * It was an 18 px `h3` on the diary and a default `CardTitle` on the Insights page, both inside
 * the centred-poster template. A row states its opening line at a card title's size or smaller,
 * so the ceiling is the card title size and anything above it is a poster again, whatever classes
 * built it. The diary's own line is 14 px and the Insights one is the card title, which is why the ceiling
 * is a ceiling and not an equality. It is read from the design contract, so a change to the card
 * title moves it too. It was a literal 16 until the card title went back to 18 on 2026-09-21.
 */
const EMPTY_STATE_TITLE_CEILING_PX = CARD_TITLE_PX;

/**
 * Every plot on those screens, and the height it draws, per width.
 *
 * `day-ridge-plot` is the seven-day ridge in the dashboard's week tile, sized in JS from
 * `DRAW_HEIGHT_PX`. `macro-ratio-bar` is the composition bar, at the top of the diary's "what you
 * ate" block and again in the Insights range summary, which the hero passes its own height class.
 * Both are read at both widths because a chart that only collapses on the narrow phone is the
 * interesting failure.
 *
 * FOUR ROUTES CARRY AN EMPTY RECORD, and that is a statement, not an omission: `/add/search`,
 * `/add/photo` and `/settings` draw no plot at any width, and on a device with one logged food the
 * Insights page draws the composition bar and nothing else, because the trend chart is below its
 * own three-day threshold (`SparseTrendNotice`). If one of them grows a plot, the line to change
 * is here.
 */
const FROZEN_CHART_PX = {
  '/diary': { 'macro-ratio-bar': 10 },
  '/dashboard': { 'day-ridge-plot': 62 },
  '/trends': { 'macro-ratio-bar': 10 },
  '/add/search': {},
  '/add/photo': {},
  '/settings': {},
} as const satisfies Record<(typeof ROUTES)[number], Record<string, number>>;

/** What a finger aims at in the page, which is `main` less the shell that shares it. */
const TARGETS =
  'main :is(a[href], button, [role="button"], [role="link"], [role="tab"], [role="combobox"], [role="menuitem"], [role="switch"], summary, select, textarea, input:not([type="hidden"])):not(header.sticky *, [data-slot="bottom-nav-shell"] *, output *)';

/** One target that is shorter than the floor. */
interface SmallTarget {
  /** Its words, or its tag, trimmed for a failure message. */
  what: string;
  /** Its drawn height, rounded. */
  height: number;
}

/** A control whose DRAWN box is under the floor while the surface a finger lands on is not. */
interface HitAreaTarget {
  /** Matches the element itself, never its words, so it reads the same in every language. */
  selector: string;
  /** Why a drawn-box reader cannot see the real target, and who proves it instead. */
  reason: string;
}

/**
 * The controls that reach the floor by a hit area a drawn box cannot see, per route.
 *
 * ONE ENTRY TODAY, and it fails in both directions like every other frozen set here: an entry
 * that stops matching a short target is reported as stale, so the day "Save as meal" grows a real
 * 44 px box this line is deleted rather than left to rot. The other five routes carry an empty
 * list, which is the claim that every tappable row on them reaches the floor by its own box.
 */
const KNOWN_HIT_AREA = {
  '/diary': [
    {
      selector: '[data-slot="save-meal-trigger"]',
      reason:
        '"Save as meal" draws 28 px of ink and buys its 44 px from an `after:` box; mobile-diary.spec.ts proves that box by hit test, which a drawn-box reader cannot.',
    },
  ],
  '/dashboard': [],
  '/trends': [],
  '/add/search': [],
  '/add/photo': [],
  '/settings': [],
} as const satisfies Record<(typeof ROUTES)[number], readonly HitAreaTarget[]>;

/** What one read of a page found: the unexplained offenders, and which known entries were seen. */
interface TargetReading {
  offenders: SmallTarget[];
  matched: string[];
}

/** The document's own two widths. */
interface DocumentWidth {
  scrollWidth: number;
  clientWidth: number;
}

/**
 * The document's scroll width against the width it was given.
 *
 * THE DOCUMENT ELEMENT, not a container: the document IS this app's scroll container, so anything
 * wider than the viewport shows up here and nowhere else.
 *
 * @param page - the page to measure.
 * @returns both widths.
 */
async function documentWidth(page: Page): Promise<DocumentWidth> {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}

/**
 * Every tappable thing in the page that is drawn under the floor.
 *
 * The four exceptions are the ones `mobile-settings.spec.ts` and `lcc-lineage-tap-targets.spec.ts`
 * already name: a box a pixel or less on a side is visually hidden and its label is the target, a
 * radio or a checkbox is a mark inside a label, a switch is a track at the end of a row, and a
 * link drawn `display: inline` is a word inside a sentence that cannot grow without covering the
 * line above it.
 *
 * @param page - the page to measure.
 * @param known - the hit-area entries for this route.
 * @returns the unexplained offenders, and the known entries that matched one.
 */
async function smallTargets(page: Page, known: readonly HitAreaTarget[] = []): Promise<TargetReading> {
  return page.locator(TARGETS).evaluateAll(
    (elements, { floor, hidden, entries }) => {
      const offenders: SmallTarget[] = [];
      const matched = new Set<string>();
      for (const element of elements) {
        const own = element.getBoundingClientRect();
        if (own.width <= hidden || own.height <= hidden) continue;
        if (element.tagName === 'A' && globalThis.getComputedStyle(element).display === 'inline') continue;
        const type = element.getAttribute('type');
        const role = element.getAttribute('role');
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
          what: (element.getAttribute('aria-label') ?? element.textContent ?? element.tagName).trim().slice(0, 50),
          height: Math.round(box.height),
        });
      }
      return { offenders, matched: [...matched] };
    },
    { floor: TAP_FLOOR_PX, hidden: HIDDEN_CONTROL_PX, entries: [...known] },
  );
}

/**
 * The drawn height of every frozen plot on the page.
 *
 * A slot that is not on the page comes back as `null` rather than being skipped, so a frozen
 * entry whose plot stopped rendering fails instead of quietly passing.
 *
 * @param page - the page to measure.
 * @param slots - the `data-slot` values to read.
 * @returns one height per slot, or null where the slot drew nothing.
 */
async function chartHeights(page: Page, slots: readonly string[]): Promise<Record<string, number | null>> {
  return page.evaluate((names) => {
    const heights: Record<string, number | null> = {};
    for (const name of names) {
      const node = document.querySelector(`[data-slot="${name}"]`);
      heights[name] = node === null ? null : Math.round(node.getBoundingClientRect().height);
    }
    return heights;
  }, [...slots]);
}

test('CONTROL: the width reader sees an injected overflow and the tap reader sees a short button', async ({
  page,
}) => {
  await completeOnboarding(page);
  await page.setViewportSize({ width: WIDTHS[0], height: PHONE_HEIGHT });
  await page.goto('/dashboard');
  await expect(page.locator('main').first()).toBeVisible();

  const before = await documentWidth(page);
  expect(before.scrollWidth, 'the page must fit before anything is injected').toBeLessThanOrEqual(before.clientWidth);
  expect(
    (await smallTargets(page)).offenders,
    'and must offer no short row before anything is injected',
  ).toEqual([]);

  await page.evaluate((floor) => {
    const main = document.querySelector('main');
    if (main === null) throw new Error('the page has no main');
    const wide = document.createElement('div');
    wide.style.cssText = 'width:900px;height:8px;background:#888';
    main.append(wide);
    for (const [label, height] of [
      ['CONTROL thirty', 30],
      ['CONTROL forty four', floor],
    ] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.style.cssText = `display:block;height:${height}px;transition:none`;
      main.append(button);
    }
  }, TAP_FLOOR_PX);

  const after = await documentWidth(page);
  expect(after.scrollWidth, 'CONTROL: a 900 px child must push the document past the phone').toBeGreaterThan(
    after.clientWidth,
  );

  const reading = await smallTargets(page);
  const found = reading.offenders.map((target) => target.what);
  expect(found, 'CONTROL: the 30 px button must be listed').toContain('CONTROL thirty');
  expect(found, 'CONTROL: the 44 px button must not be listed').not.toContain('CONTROL forty four');

  // The hit-area list fails in the other direction too: handed the diary's entry on a page that
  // has no such control, nothing matches, which is what the stale-entry check reports.
  const stale = await smallTargets(page, KNOWN_HIT_AREA['/diary']);
  expect(stale.matched, 'CONTROL: an entry for another screen must match nothing here').toEqual([]);

  // And the chart reader answers null for a plot that is not drawn, which is what makes a stale
  // frozen entry fail rather than pass.
  expect(await chartHeights(page, ['a-slot-that-is-not-on-this-page'])).toEqual({
    'a-slot-that-is-not-on-this-page': null,
  });
});

/** The two empty states that were posters, and the door each one must offer inline. */
const EMPTY_STATES = [
  { route: '/diary', slot: 'diary-empty-first-ever', door: 'a[href^="/add/describe"]', what: 'the composer' },
  { route: '/trends', slot: 'trends-empty', door: 'a[href="/add/search"]', what: 'the add door' },
] as const;

for (const state of EMPTY_STATES) {
  test(`${state.route} states its missing figure as a row, not as a centred poster`, async ({ page }) => {
    await completeOnboarding(page);
    await page.setViewportSize({ width: WIDTHS[1], height: PHONE_HEIGHT });
    await page.goto(state.route);

    const empty = page.locator(`[data-slot="${state.slot}"]`);
    await expect(empty, 'a device with no food must show the empty state').toBeVisible();

    // THE FIRST TEXT ELEMENT IN THE STATE, in DOM order, whether the screen wrote it as a
    // paragraph or as a card title. A reader fixed on `p` would have quietly skipped past the
    // Insights page's card title to the caption under it and measured the wrong thing.
    const title = empty.locator('p, [data-slot="card-title"]').first();
    const read = async (): Promise<{ align: string; size: number }> =>
      title.evaluate((node) => {
        const style = globalThis.getComputedStyle(node);
        return { align: style.textAlign, size: Number.parseFloat(style.fontSize) };
      });

    const asShipped = await read();
    expect(asShipped.align, 'the statement reads from the left, as a row does').not.toBe('center');
    expect(asShipped.size, 'and at a data row label size, not at a poster title size').toBeLessThanOrEqual(
      EMPTY_STATE_TITLE_CEILING_PX,
    );

    // The primary action is INLINE: the screen's own way out is inside the empty state, not in a
    // block below it. Containment rather than a coordinate keeps this true at both widths, where
    // the row wraps on a phone and sits side by side from `sm`.
    await expect(empty.locator(state.door).first(), `${state.what} must sit inside the empty state`).toBeVisible();

    // CONTROL: centre it and enlarge it by hand, and both claims go red, so neither is a sentence
    // this reader would answer the same way whatever it was pointed at.
    await empty.evaluate((node) => {
      node.style.textAlign = 'center';
    });
    await title.evaluate((node) => {
      node.style.fontSize = '24px';
    });
    const centred = await read();
    expect(centred.align, 'CONTROL: a centred empty state must read as centred').toBe('center');
    expect(centred.size, 'CONTROL: a poster title must break the size ceiling').toBeGreaterThan(
      EMPTY_STATE_TITLE_CEILING_PX,
    );
  });
}

for (const width of WIDTHS) {
  test(`the restyled screens fit, keep their charts and clear the tap floor at ${width} px`, async ({ page }) => {
    await completeOnboarding(page);
    await logFoodManually(page, SEEDED_FOOD);
    await page.setViewportSize({ width, height: PHONE_HEIGHT });

    for (const route of ROUTES) {
      await page.goto(route);
      await expect(page.locator('main').first(), `${route}: the page must render`).toBeVisible();
      await page.waitForLoadState('load');

      // Non-vacuity: a page that drew nothing tappable would clear the floor by drawing nothing.
      await expect
        .poll(() => page.locator(TARGETS).count(), { message: `${route}: the page must have tappable rows` })
        .toBeGreaterThan(2);

      const widths = await documentWidth(page);
      expect(widths.scrollWidth, `${route} at ${width} px: the document must not scroll sideways`).toBeLessThanOrEqual(
        widths.clientWidth,
      );

      // Every route in `ROUTES` has an entry, by the `satisfies` above: a screen with no chart
      // carries an empty one, so adding a route forces a decision rather than a silent skip.
      const frozen: Record<string, number> = FROZEN_CHART_PX[route];
      expect(
        await chartHeights(page, Object.keys(frozen)),
        `${route} at ${width} px: a chart changed height, or stopped being drawn`,
      ).toEqual(frozen);

      const known: readonly HitAreaTarget[] = KNOWN_HIT_AREA[route];
      const reading = await smallTargets(page, known);
      expect(
        reading.offenders.map((target) => `"${target.what}" is ${target.height} px`),
        `${route} at ${width} px: a tappable row is under ${TAP_FLOOR_PX} px`,
      ).toEqual([]);
      expect(
        known.filter((entry) => !reading.matched.includes(entry.selector)).map((entry) => entry.reason),
        `${route} at ${width} px: a hit-area entry matched no short control, so delete it from KNOWN_HIT_AREA`,
      ).toEqual([]);
    }
  });
}
