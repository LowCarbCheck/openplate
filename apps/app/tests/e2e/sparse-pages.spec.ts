/**
 * Four pages that ended a third of the way down a phone screen.
 *
 * WHAT THE AUDIT FOUND. A walk over every route at 390 x 844, dark, German,
 * with a seeded diary, turned up four otherwise unrelated screens with the
 * same shape: a short block of content at the top and bare background for the
 * rest of the viewport. Measured on the production build before the fix:
 * `/settings/notifications` drew 166 px into a content area of 735, `/meals`
 * with three saved meals drew 306, `/add/describe` stopped at 506 because it
 * asked for 60vh of a window rather than the room it was given, and `/welcome`
 * carried no mark or name at all.
 *
 * WHY GEOMETRY AND NOT A SCREENSHOT. A picture of a short page and a picture
 * of a broken one are the same picture, which is exactly why this reached
 * production: the pages render, nothing overflows, no test could tell. The
 * reads below are `getBoundingClientRect` against the fixed bottom bar and
 * against the viewport, which is what says where a page actually ends.
 *
 * ── EVERY CLAIM HERE HAS A CONTROL ──
 *
 * "The page reaches the bottom of the screen" is a claim a tall page satisfies
 * for free, so each of the three fill checks re-reads the SAME element with
 * `min-height` forced back to `auto` inline, which is the markup as it stood
 * before this change, and requires that reading to come back short. A reader
 * that returned "reaches the bottom" for both would prove nothing.
 *
 * And the fills are self-limiting by design, not by luck, so that is measured
 * too: `/meals` is read a second time with fifteen saved meals on disk, where
 * the column is taller than the area and must behave exactly as it always did
 * — top-aligned under the header, scrolling, nothing centred and nothing cut.
 *
 * THE COPY IS NEVER ASSERTED. `meals.howTo` and the cap line are read by their
 * `data-slot` and by having a non-empty box, never by their words, which are
 * wordsmith's and change without this spec's permission.
 */
import { expect, test, type Page } from '@playwright/test';

import { EN } from './copy';
import { completeOnboarding } from './helpers';

/** The phone this tier emulates. */
const PHONE = { width: 390, height: 844 } as const;

/**
 * How far above the bottom bar a filled page may stop.
 *
 * The shell reserves 6rem plus the safe-area inset under its content
 * (`app-wrapper.tsx`), and the bar itself is shorter than that reservation, so
 * a page that fills its area still ends a few dozen pixels clear of the bar.
 * What is being refused is the 400-plus px of nothing the audit measured, so
 * the budget is generous on purpose: anything under it is "this is the page",
 * anything over it is "the page ends here and the rest is a bug".
 */
const MAX_TRAILING_GAP_PX = 120;

/** The least trailing space the unfixed markup must leave, for the control to count as a control. */
const CONTROL_MIN_GAP_PX = 250;

/** Enough saved meals to outgrow the screen, which is the other end of the range. */
const CROWDED_MEAL_COUNT = 15;

/** A CSS pixel of rounding either side of an exact fit still counts as a fit. */
const TOLERANCE_PX = 1;

/** One reading of where a page's own column sits against the screen it is on. */
interface ColumnFit {
  /** The column's top edge in viewport pixels. */
  top: number;
  /** The column's bottom edge in viewport pixels. */
  bottom: number;
  /** The height of the shell's content area, which is the room the column was given. */
  paneHeight: number;
  /** The top edge of everything the fixed bottom bar draws. */
  barTop: number;
  /** The document's full height, so a fill that grew the page shows up. */
  documentHeight: number;
  /** The viewport's own height. */
  viewportHeight: number;
}

/**
 * Where a route's own column ends, with the `min-height` optionally forced off.
 *
 * THE BAR IS FOUND BY ITS POSITION, the same read `mobile-add-meals.spec.ts`
 * makes: "the one `nav` that does not scroll" is what clearance is about, and
 * a class name is not.
 *
 * @param page - a page wearing the app shell.
 * @param options.slot - the `data-slot` the route puts on its own column.
 * @param options.filled - false to put `min-height: auto` back, which is the markup this
 *   change replaced and the control every claim below is measured against.
 * @returns the reading.
 */
async function readColumn(page: Page, { slot, filled }: { slot: string; filled: boolean }): Promise<ColumnFit> {
  return page.evaluate(
    ({ slot: wanted, filled: isFilled }) => {
      // Typed through the selector rather than asserted after it: every route
      // column this spec names is a `div` written by that route's own JSX.
      const column = document.querySelector<HTMLElement>(`[data-slot="${wanted}"]`);
      if (column === null) throw new Error(`no element carries data-slot="${wanted}"`);
      if (!isFilled) column.style.minHeight = 'auto';

      // The shell's content area is the column's own offset parent chain: its
      // parent is the padded pane `app-wrapper.tsx` draws around every route.
      const pane = column.parentElement;
      if (pane === null) throw new Error(`the ${wanted} column has no parent to measure against`);

      let barTop = Number.POSITIVE_INFINITY;
      for (const bar of document.querySelectorAll('nav')) {
        if (getComputedStyle(bar).position !== 'fixed') continue;
        barTop = Math.min(barTop, bar.getBoundingClientRect().top);
        for (const child of bar.querySelectorAll('*')) {
          const rect = child.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) barTop = Math.min(barTop, rect.top);
        }
      }

      const rect = column.getBoundingClientRect();
      return {
        top: Math.round(rect.top),
        bottom: Math.round(rect.bottom),
        paneHeight: Math.round(pane.getBoundingClientRect().height),
        barTop: Math.round(barTop),
        documentHeight: document.documentElement.scrollHeight,
        viewportHeight: document.documentElement.clientHeight,
      };
    },
    { slot, filled },
  );
}

/**
 * Asserts that a route's column reaches the bottom of the screen, and that the
 * same reader says it did not before this change.
 *
 * @param page - a page already on the route.
 * @param slot - the `data-slot` the route puts on its own column.
 * @param label - what to call the page in a failure message.
 */
async function expectFillsTheScreen(page: Page, slot: string, label: string): Promise<void> {
  const filled = await readColumn(page, { slot, filled: true });

  //////////////////////////////////////////////////////////////////////////
  // The room really is there to fill. Without this, a page rendered into a
  // 200 px area would "fill the screen" and say nothing.
  //////////////////////////////////////////////////////////////////////////
  expect(filled.viewportHeight, `${label}: the viewport must be the phone this tier emulates`).toBe(PHONE.height);
  expect(filled.paneHeight, `${label}: the content area must be most of the screen to be worth filling`).toBeGreaterThan(
    PHONE.height / 2,
  );
  expect(filled.barTop, `${label}: the fixed bottom bar must be drawn to measure against`).toBeGreaterThan(0);
  expect(filled.barTop, `${label}: and must be on the screen`).toBeLessThan(PHONE.height);

  //////////////////////////////////////////////////////////////////////////
  // THE CLAIM: the column ends near the bottom of the screen, and above
  // everything the bar draws.
  //////////////////////////////////////////////////////////////////////////
  const gap = filled.barTop - filled.bottom;
  expect(gap, `${label}: the page stopped ${gap} px above the bottom bar`).toBeLessThanOrEqual(MAX_TRAILING_GAP_PX);
  expect(gap, `${label}: and must not run under the bar`).toBeGreaterThanOrEqual(-TOLERANCE_PX);
  expect(
    filled.documentHeight,
    `${label}: filling the area must not grow the document past the screen`,
  ).toBeLessThanOrEqual(PHONE.height + TOLERANCE_PX);

  //////////////////////////////////////////////////////////////////////////
  // THE CONTROL: the same read, against the markup this change replaced.
  //////////////////////////////////////////////////////////////////////////
  const unfilled = await readColumn(page, { slot, filled: false });
  const controlGap = unfilled.barTop - unfilled.bottom;
  expect(
    controlGap,
    `${label}: with min-height off the page left ${controlGap} px empty, which is not enough for this to be a control`,
  ).toBeGreaterThanOrEqual(CONTROL_MIN_GAP_PX);
}

/**
 * Writes `count` saved meals straight into the primary store's `savedMeals`
 * table, the same IndexedDB layout `mobile-add-meals.spec.ts` writes its logs
 * into.
 *
 * SEEDED AND NOT DRIVEN, for this one case only. Fifteen saved meals through
 * the real diary flow is fifteen round trips for a claim that is purely about
 * how tall a column of rows is; the three-meal case a few lines up is the one
 * that matters and the app's own read draws both.
 *
 * @param page - a page on the app's origin.
 * @param count - how many meals to write.
 */
async function writeSavedMealsToDisk(page: Page, count: number): Promise<void> {
  await page.evaluate(
    (howMany) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('openplate-primary');
        request.addEventListener('error', () => reject(new Error('the primary database could not be opened')));
        request.addEventListener('success', () => {
          const db = request.result;
          const cells: Record<string, { entity: string }> = {};
          for (let index = 0; index < howMany; index += 1) {
            const id = `sparse-seed-meal-${index}`;
            cells[id] = {
              entity: JSON.stringify({
                id,
                name: `Seeded meal ${index + 1}`,
                createdAt: Date.now() - index * 1_000,
                items: [
                  {
                    name: `Seeded food ${index + 1}`,
                    quantityGrams: 100,
                    macros: { carbs: 20, fiber: 5, sugars: null, polyols: 0, protein: 15, fat: 10, kcal: 300 },
                    source: 'manual',
                    aiEstimated: false,
                    curatedSource: null,
                    foodId: null,
                  },
                ],
              }),
            };
          }
          const transaction = db.transaction('t', 'readwrite');
          transaction.objectStore('t').put({ k: 'savedMeals', v: cells });
          transaction.addEventListener('complete', () => {
            db.close();
            resolve();
          });
          transaction.addEventListener('error', () => {
            db.close();
            reject(new Error('the seeded meals could not be written'));
          });
        });
      }),
    count,
  );
}

////////////////////////////////////////////////////////////////////////////////
// /welcome: the first screen, which carried no mark and no name
////////////////////////////////////////////////////////////////////////////////

test('the first screen says whose app it is, above the card and inside the centring', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('/welcome');
  await expect(page.getByRole('link', { name: EN.welcome.start, exact: true })).toBeVisible();

  const lockup = page.locator('[data-slot="welcome-brand"]');
  await expect(lockup, 'the first screen must carry the brand lockup').toBeVisible();

  //////////////////////////////////////////////////////////////////////////////
  // IT IS THE REAL ASSET AND THE REAL WORD, not a substitute drawn here. The
  // mark is the icon every other lockup in this app uses, and the word is
  // `Wordmark`'s own two-part rendering, which is why "openplate" is read out
  // of the element rather than typed into this file as a string to compare.
  //////////////////////////////////////////////////////////////////////////////
  const read = await page.evaluate(() => {
    const brand = document.querySelector('[data-slot="welcome-brand"]');
    const main = document.querySelector('main');
    const card = main?.querySelector('[data-slot="card"], .bg-card') ?? null;
    if (brand === null || main === null || card === null) return null;
    const image = brand.querySelector('img');
    const brandRect = brand.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    return {
      source: image?.getAttribute('src') ?? '',
      alt: image?.getAttribute('alt') ?? null,
      word: (brand.textContent ?? '').trim(),
      wordParts: [...brand.querySelectorAll('span')].length,
      brandTop: Math.round(brandRect.top),
      brandBottom: Math.round(brandRect.bottom),
      brandHeight: Math.round(brandRect.height),
      cardTop: Math.round(cardRect.top),
      cardBottom: Math.round(cardRect.bottom),
      viewportHeight: document.documentElement.clientHeight,
      documentHeight: document.documentElement.scrollHeight,
    };
  });
  expect(read, 'the welcome screen must offer a brand lockup and a card to measure').not.toBeNull();
  if (read === null) return;

  expect(read.source, 'the mark must be the app icon every other lockup uses').toContain('/icons/icon-192.png');
  expect(read.alt, 'the mark is decorative: the word beside it already says the name').toBe('');
  expect(read.word, 'the lockup must draw the product name').toBe('openplate');
  expect(read.brandHeight, 'the lockup must have been drawn, not collapsed to nothing').toBeGreaterThan(0);

  //////////////////////////////////////////////////////////////////////////////
  // THE CLAIM ABOUT PLACEMENT, and its own control. The lockup sits above the
  // card, and the pair is centred as ONE group: a lockup pinned to the top of
  // the screen would satisfy "above the card" perfectly well, and is exactly
  // the other thing somebody might have written here.
  //////////////////////////////////////////////////////////////////////////////
  expect(read.brandBottom, 'the lockup must sit above the card').toBeLessThanOrEqual(read.cardTop);
  const above = read.brandTop;
  const below = read.viewportHeight - read.cardBottom;
  expect(
    Math.abs(above - below),
    `the lockup and the card must be centred as one group: ${above} px above, ${below} px below`,
  ).toBeLessThanOrEqual(MAX_TRAILING_GAP_PX / 2);
  expect(read.documentHeight, 'and the pair must still fit one screen').toBeLessThanOrEqual(
    read.viewportHeight + TOLERANCE_PX,
  );
});

////////////////////////////////////////////////////////////////////////////////
// /meals: three saved meals, and then fifteen
////////////////////////////////////////////////////////////////////////////////

test('saved meals fills the screen with a short list and gets out of the way with a long one', async ({ page }) => {
  await completeOnboarding(page);
  await page.setViewportSize(PHONE);

  ////////////////////////////////////////////////////////////////////////////
  // THREE, which is the realistic small number the audit measured.
  ////////////////////////////////////////////////////////////////////////////
  await writeSavedMealsToDisk(page, 3);
  await page.goto('/meals');
  await expect(page.locator('[data-slot="saved-meal-row"]')).toHaveCount(3);

  const hint = page.locator('[data-slot="meals-how-to"]');
  await expect(hint, 'a person with saved meals must still be told where the next one comes from').toBeVisible();
  expect((await hint.innerText()).trim().length, 'the hint must carry a sentence').toBeGreaterThan(0);

  await expectFillsTheScreen(page, 'meals-page', '/meals with three saved meals');

  ////////////////////////////////////////////////////////////////////////////
  // FIFTEEN. The fill must be self-limiting: a column taller than the area
  // behaves as it always did, and nothing about it is centred or clipped.
  ////////////////////////////////////////////////////////////////////////////
  await writeSavedMealsToDisk(page, CROWDED_MEAL_COUNT);
  await page.goto('/meals');
  await expect(page.locator('[data-slot="saved-meal-row"]')).toHaveCount(CROWDED_MEAL_COUNT);

  const crowded = await readColumn(page, { slot: 'meals-page', filled: true });
  expect(
    crowded.documentHeight,
    `fifteen saved meals must outgrow one screen, or this is not the crowded case at all`,
  ).toBeGreaterThan(PHONE.height);
  expect(
    crowded.top,
    `the crowded list must start under the header, not be pushed down by a centring: it started at ${crowded.top}`,
  ).toBeLessThanOrEqual(PHONE.height / 2);
  await expect(page.locator('[data-slot="meals-how-to"]')).toBeVisible();

  // Nothing above the fold is cut off at the top, which is the failure a
  // centred column in a too-small box produces.
  const firstRow = await page.locator('[data-slot="saved-meal-row"]').first().boundingBox();
  expect(Math.round(firstRow?.y ?? -1), 'the first row must be on the screen, not above it').toBeGreaterThanOrEqual(0);
});

////////////////////////////////////////////////////////////////////////////////
// /add/describe: a composer pinned to 60vh of a window instead of to its page
////////////////////////////////////////////////////////////////////////////////

test('the describe composer sits at the bottom of the page and not at 60 percent of the window', async ({ page }) => {
  await completeOnboarding(page);
  await page.setViewportSize(PHONE);
  await page.goto('/add/describe');

  const field = page.locator('textarea#describe-meal');
  await expect(field).toBeVisible();

  await expectFillsTheScreen(page, 'describe-page', '/add/describe');

  ////////////////////////////////////////////////////////////////////////////
  // AND THE COMPOSER IS WHAT REACHED THE BOTTOM, not a tall empty box with
  // the message field still stranded in the middle of it. `mt-auto` is what
  // ties the two together and this is the read that proves it did.
  ////////////////////////////////////////////////////////////////////////////
  const column = await readColumn(page, { slot: 'describe-page', filled: true });
  const box = await field.boundingBox();
  expect(box, 'the message field must have a box to measure').not.toBeNull();
  const fieldToBottom = column.bottom - ((box?.y ?? 0) + (box?.height ?? 0));
  expect(
    fieldToBottom,
    `the message field ended ${fieldToBottom} px above the end of the page, so it is not pinned to it`,
  ).toBeLessThanOrEqual(MAX_TRAILING_GAP_PX);
});

////////////////////////////////////////////////////////////////////////////////
// /settings/notifications: four of five states had one sentence and nothing else
////////////////////////////////////////////////////////////////////////////////

test('the notifications page says what would arrive and closes at the bottom of the screen', async ({ page }) => {
  await completeOnboarding(page);
  await page.setViewportSize(PHONE);
  await page.goto('/settings/notifications');

  ////////////////////////////////////////////////////////////////////////////
  // THE STATE IS NAMED, not assumed: everything below is about the states
  // with no kinds panel, and a run that happened to land on "ready and on"
  // would be measuring a different page.
  ////////////////////////////////////////////////////////////////////////////
  await expect(page.locator('[data-slot="push-availability"]')).toBeVisible();
  await expect(
    page.locator('#catch-up-enabled'),
    'this check is about the states with no kinds panel',
  ).toHaveCount(0);

  //////////////////////////////////////////////////////////////////////////////
  // THE PREVIEW: this page's whole argument is that a person reads the
  // notification before agreeing to it, and it used to be shown only to
  // somebody who had already agreed. Exactly one on screen, ever.
  //////////////////////////////////////////////////////////////////////////////
  const preview = page.locator('[data-slot="catch-up-preview"]');
  await expect(preview, 'a reader who cannot turn notifications on must still see what one says').toHaveCount(1);
  await expect(preview).toBeVisible();

  const cap = page.locator('[data-slot="notifications-cap"]');
  await expect(cap, 'the page must close with the promise it makes in every state').toBeVisible();
  expect((await cap.innerText()).trim().length, 'the closing line must carry a sentence').toBeGreaterThan(0);

  await expectFillsTheScreen(page, 'notifications-page', '/settings/notifications');
});
