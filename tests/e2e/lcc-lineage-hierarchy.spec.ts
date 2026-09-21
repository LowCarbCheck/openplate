/**
 * A card reads in tiers (2026-09-21), measured on a device that has data.
 *
 * THE REPORT. The operator opened the weight card and called it poorly designed: same font size
 * everywhere, no visual hierarchy. It was true, and three things made it true.
 *
 * 1. NO TITLE STOOD CLEAR OF THE TEXT UNDER IT. M243 set the default card title to 16 px, but
 *    fourteen Insights cards kept an explicit `text-lg`, so one screen drew 16 px and 18 px titles
 *    over the same 14 px body. The title was 1.14 times its own description, which in one
 *    monospace face reads as more of the same.
 * 2. A STAT LABEL LOOKED LIKE PROSE. It was 12 px sentence case in the same grey as the sentences
 *    around it. It is the section label recipe now, grey capitals, so the two kinds of small text
 *    can be told apart.
 * 3. A SENTENCE SAT WHERE A FIGURE BELONGS. With one weigh-in the middle tile held five lines of
 *    explanation at the size of a label and stretched its two neighbours to match. A tile holds a
 *    figure now, and the explanation is one line under the row.
 *
 * WHY THIS IS A NEW SPEC AND NOT A LINE IN `lcc-lineage-labels.spec.ts`. That spec reads card
 * titles on a fresh device, on purpose, and a fresh device has no weight card, no range summary
 * and no streak. It could not see any of this. Here the device is given a weigh-in with a target
 * and three logged days, so the cards the report is about are on the screen.
 *
 * ── EVERY CHECK IS SHOWN ABLE TO FAIL ──
 * A title forced back to 16 px must fail the size read and the ratio. A sentence pushed into a stat
 * tile must be found by the reader that says "a tile holds a figure". A filter group with only its
 * screen-reader legend must read as unlabelled to the reader that looks for the visible name.
 */
import { expect, test, type Page } from '@playwright/test';

import { CARD_TITLE_OVER_BODY_MIN_RATIO, CARD_TITLE_PX } from '../design-contract';
import { EN } from './copy';
import { completeOnboarding, expectPhoneLayout, logFoodManually } from './helpers';

/** The stat figure's size, `text-xl`, and the label's, `text-xs`. */
const STAT_FIGURE_PX = 20;
const STAT_LABEL_PX = 12;

/** Screens that draw cards a device with data can see. */
const CARD_ROUTES = [
  '/dashboard',
  '/trends?tab=overview',
  '/trends?tab=nutrition',
  '/trends?tab=meals',
  '/trends?tab=goals',
  '/fasting',
  '/nutrients',
  '/awards',
] as const;

const pad = (value: number): string => String(value).padStart(2, '0');

/** Today's local day, shifted by whole days, as `YYYY-MM-DD`. */
function localDay(daysAgo: number): string {
  const day = new Date();
  day.setDate(day.getDate() - daysAgo);
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

/**
 * A device with a weigh-in of 85 kg and a target of 80, and three logged days.
 *
 * Three days is `MIN_TREND_DAYS`, the floor under which the Overview draws a sparse-data notice
 * and not the range summary. The weigh-in is ONE on purpose: it is the state the operator was
 * looking at, the one where a trend needs more entries and the change tile has nothing to say.
 */
async function seedDevice(page: Page): Promise<void> {
  await completeOnboarding(page, { current: '85', target: '80' });
  const foods = ['Hierarchy porridge', 'Hierarchy salmon', 'Hierarchy eggs'];
  for (const [index, name] of foods.entries()) {
    await logFoodManually(page, {
      name,
      grams: '200',
      carbs: '8',
      mealType: 'breakfast',
      date: localDay(index),
    });
  }
}

/** One card title, and how big the text under it is. */
interface TitleRead {
  text: string;
  px: number;
  describedPx: number | null;
}

/**
 * Every card title in `main`, except the three door cards on the Overview.
 *
 * The doors are navigation rows whose title is a deliberate `text-sm` label (`data-slot`
 * `insights-door-card`), and the design contract lets a caller override the default. Naming the
 * exemption by its slot keeps this claim about the DEFAULT without guessing which titles were set
 * by hand.
 */
async function readTitles(page: Page): Promise<TitleRead[]> {
  return page.locator('main [data-slot="card-title"]').evaluateAll((titles) =>
    titles
      .filter((title) => title.closest('[data-slot="insights-door-card"]') === null)
      .map((title) => {
        const next = title.nextElementSibling;
        const described =
          next !== null && (next.textContent ?? '').trim() !== '' ? parseFloat(getComputedStyle(next).fontSize) : null;
        return {
          text: (title.textContent ?? '').trim().slice(0, 30),
          px: parseFloat(getComputedStyle(title).fontSize),
          describedPx: described,
        };
      }),
  );
}

/** A title that fails either claim, with the reason. */
function flawed(read: TitleRead): string | null {
  if (read.px !== CARD_TITLE_PX) return `"${read.text}" is ${read.px}px, not ${CARD_TITLE_PX}px`;
  if (read.describedPx !== null && read.px / read.describedPx < CARD_TITLE_OVER_BODY_MIN_RATIO) {
    return `"${read.text}" is ${read.px}px over ${read.describedPx}px text, under ${CARD_TITLE_OVER_BODY_MIN_RATIO}x`;
  }
  return null;
}

test('every card title is one size and stands clear of the text under it, on a device with data', async ({ page }) => {
  await seedDevice(page);

  let seen = 0;
  for (const route of CARD_ROUTES) {
    await page.goto(route);
    await expect(page.locator('main').first(), `${route}: the screen is up`).toBeVisible();
    await expect
      .poll(() => page.locator('main [data-slot="card-title"]').count(), {
        message: `${route}: the screen must draw a card title`,
      })
      .toBeGreaterThan(0);
    const reads = await readTitles(page);
    seen += reads.length;
    expect(
      reads.map(flawed).filter((reason) => reason !== null),
      `${route}: card titles`,
    ).toEqual([]);
  }
  expect(seen, 'the walk must have read card titles on every screen').toBeGreaterThanOrEqual(CARD_ROUTES.length);

  // CONTROL: a title forced back to the M243 size, with a description under it, fails both reads.
  await page.evaluate(() => {
    const card = document.createElement('div');
    card.dataset.slot = 'card';
    card.innerHTML =
      '<div><div data-slot="card-title" style="font-size:16px">Old title</div><div style="font-size:14px">Body</div></div>';
    document.querySelector('main')?.append(card);
  });
  const forced = (await readTitles(page)).find((read) => read.text === 'Old title');
  expect(forced, 'the control title must be found by the same reader').toBeDefined();
  expect(forced === undefined ? null : flawed(forced), 'a 16px title over 14px text must be flagged').not.toBeNull();
});

/** What a stat tile shows, read from the page. */
interface TileRead {
  labelTransform: string;
  labelPx: number;
  figurePx: number;
  text: string;
}

async function readTiles(page: Page): Promise<TileRead[]> {
  return page.locator('main [data-slot="stat-tile"]').evaluateAll((tiles) =>
    tiles.map((tile) => {
      const label = tile.children[0];
      const figure = tile.children[1]?.querySelector('p');
      const labelStyle = label === undefined ? null : getComputedStyle(label);
      const figureStyle = figure === null || figure === undefined ? null : getComputedStyle(figure);
      return {
        labelTransform: labelStyle?.textTransform ?? '',
        labelPx: parseFloat(labelStyle?.fontSize ?? '0'),
        figurePx: parseFloat(figureStyle?.fontSize ?? '0'),
        text: tile.textContent ?? '',
      };
    }),
  );
}

test('the weight card is a title, a label over a figure, and one line of explanation', async ({ page }) => {
  await seedDevice(page);
  await page.goto('/trends?tab=overview');

  const card = page.locator('main [data-slot="card"]').filter({ hasText: EN.trends.weight.title }).first();
  await expect(card, 'the weight card is on the Overview').toBeVisible();

  // ONE WEIGH-IN AND A TARGET: two figures, the latest and the distance. There is no change to show.
  const tiles = card.locator('[data-slot="stat-tile"]');
  await expect(tiles, 'a tile is drawn for a figure and for nothing else').toHaveCount(2);

  const reads = await readTiles(page);
  for (const read of reads) {
    expect(read.labelTransform, 'a stat label is a section label, in capitals').toBe('uppercase');
    expect(read.labelPx, 'a stat label is 12px').toBe(STAT_LABEL_PX);
    expect(read.figurePx, 'a stat figure is 20px').toBe(STAT_FIGURE_PX);
    expect(read.figurePx / read.labelPx, 'the figure is clearly the loudest thing in its tile').toBeGreaterThan(1.5);
  }

  // The explanation is on the card, once, and in no tile.
  await expect(card.getByText(EN.trends.weight.singleEntry), 'the reason is one line under the row').toBeVisible();
  expect(
    reads.filter((read) => read.text.includes(EN.trends.weight.singleEntry)),
    'no tile holds the sentence',
  ).toEqual([]);

  // CONTROL: push the sentence into a tile and the same read must find it there.
  await tiles.first().evaluate((tile, sentence) => {
    const stray = document.createElement('p');
    stray.textContent = sentence;
    tile.append(stray);
  }, EN.trends.weight.singleEntry);
  const after = await readTiles(page);
  expect(
    after.filter((read) => read.text.includes(EN.trends.weight.singleEntry)),
    'the reader must see a sentence that is in a tile',
  ).toHaveLength(1);
});

test('the stat row is one row per figure on a phone and side by side from 560px, and never overflows', async ({
  page,
}) => {
  await seedDevice(page);
  await page.goto('/trends?tab=overview');
  const tiles = page.locator('main [data-slot="stat-tile"]');
  await expect(tiles).toHaveCount(2);
  await expectPhoneLayout(page);

  const boxes = async (): Promise<{ top: number; left: number; overflow: number }[]> =>
    tiles.evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        const figure = element.querySelector('div p');
        return {
          top: Math.round(rect.top),
          left: Math.round(rect.left),
          overflow: figure === null ? 0 : Math.max(0, figure.scrollWidth - figure.clientWidth),
        };
      }),
    );

  const phone = await boxes();
  expect(phone[0]?.top, 'on a phone the second tile is under the first').toBeLessThan(phone[1]?.top ?? 0);
  expect(
    phone.map((box) => box.overflow),
    'no figure overflows its tile on a phone',
  ).toEqual([0, 0]);

  await page.setViewportSize({ width: 800, height: 900 });
  await expect
    .poll(
      async () => {
        const wide = await boxes();
        return wide[0]?.top === wide[1]?.top && (wide[1]?.left ?? 0) > (wide[0]?.left ?? 0);
      },
      { message: 'from 560px the tiles stand side by side' },
    )
    .toBe(true);
  expect(
    (await boxes()).map((box) => box.overflow),
    'no figure overflows its tile at 800px',
  ).toEqual([0, 0]);
});

/** The visible name above a filter group, or null when the group has only its screen-reader legend. */
async function visibleGroupName(page: Page, name: string): Promise<{ upper: boolean; before: boolean } | null> {
  return page.evaluate((groupName) => {
    const label = [...document.querySelectorAll('main p[aria-hidden="true"]')].find(
      (element) => (element.textContent ?? '').trim() === groupName,
    );
    if (label === undefined) return null;
    return {
      upper: getComputedStyle(label).textTransform === 'uppercase',
      before: label.nextElementSibling?.tagName === 'FIELDSET',
    };
  }, name);
}

test('the three filter groups on the Nutrition tab are named above their chips', async ({ page }) => {
  await seedDevice(page);
  await page.goto('/trends?tab=nutrition');
  await expect(page.locator('[data-slot="trend-metric-controls"]')).toBeVisible();

  for (const name of [EN.trends.controls.metricGroup, EN.trends.controls.rangeGroup, EN.trends.controls.slotGroup]) {
    expect(await visibleGroupName(page, name), `"${name}" is named above its chips, in capitals`).toEqual({
      upper: true,
      before: true,
    });
  }

  // CONTROL: a group with only its legend has no visible name, and the reader says so.
  await page.evaluate(() => {
    const group = document.createElement('fieldset');
    group.innerHTML = '<legend class="sr-only">Unlabelled control group</legend>';
    document.querySelector('main')?.append(group);
  });
  expect(await visibleGroupName(page, 'Unlabelled control group'), 'a legend alone is not a visible name').toBeNull();
});
